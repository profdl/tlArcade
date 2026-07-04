// Run lifecycle + per-substep stepping for the sled, extracted from Rider's rAF
// loop so the gameplay state machine is one cohesive, testable unit (the loop
// itself is DOM-bound and untestable in node; this is pure of React/tldraw).
//
// It owns the cross-frame gameplay state that used to be loose vars in the tick
// closure: the sled body, the frozen-at-run-start collision snapshot, the set of
// checkpoints collected this run, the facing sign, and the run/reset edge
// tracking. The Rider feeds it a `TrackSource` (the editor-bound reactive views)
// and the current input atoms each frame; the controller decides when to re-seat
// the body, snapshots the track at run start, and advances the physics.
//
// Pure of React/tldraw so the lifecycle (begin / reset / score / facing) can be
// unit-tested with a stub TrackSource — see runController.test.ts.

import {
	makeBody,
	stepBody,
	bodyCenter,
	bodyFacing,
	PHYSICS,
	type Body,
	type ContactEvent,
} from './physics'
import { collectCheckpointHits, type Checkpoint } from './checkpoints'
import { pointInMouth, teleportBody, splitBody, type Portal, type Multiplier } from './portals'
import type { TrackSegment } from './geometry'
import type { Vec2 } from './physics'

/**
 * The track the controller rides, as the reactive views the Rider already builds
 * (makeSegmentsComputed / makeCheckpointsComputed / makePortalsComputed /
 * makeMultipliersComputed). Abstracted to this minimal shape so the controller
 * never imports tldraw and can be driven by a stub in tests. `.get()` recomputes
 * only when shapes change.
 */
export interface TrackSource {
	segments(): TrackSegment[]
	checkpoints(): Checkpoint[]
	portals(): Portal[]
	multipliers(): Multiplier[]
}

/**
 * Hard cap on simultaneous riders. A multiplier past this cap is inert (its mouth
 * isn't solid track, so a rider just passes over it, same as any other
 * non-collidable shape) rather than splitting further — a backstop against a
 * level design that chains/loops multipliers into runaway growth. Exported so
 * Rider.tsx can size its snail render pool to match exactly.
 */
export const MAX_RIDERS = 8

/** One simulated rider: its physics body plus its own held horizontal facing
 * (bodyFacing applies a dead-band per body, so each rider needs its own). */
interface RiderSlot {
	body: Body
	facingX: 1 | -1
}

/** Inputs the rAF loop reads from atoms and hands to the controller each frame. */
export interface RunInputs {
	playing: boolean
	start: Vec2
	/** Reset nonce; a change re-seats the body even if `start` didn't move. */
	resetNonce: number
}

/** What a fixed substep produced, for the loop's audio / scoring wiring. */
export interface SubstepResult {
	/** Contacts the sim reported this substep (the same array the loop passed in). */
	contacts: ContactEvent[]
	/** True when at least one new checkpoint scored this substep. */
	scored: boolean
}

/**
 * Owns the sled body and run lifecycle. Construct once per Rider mount with the
 * editor-bound TrackSource; the loop calls sync() once per frame, then beginRun()
 * fires implicitly inside it on the play edge. The body and collision snapshot
 * are exposed via getters for the loop's rendering / audio.
 */
export class RunController {
	private readonly track: TrackSource
	// One or more simulated riders. Almost always length 1; a multiplier split
	// (see stepFixed) grows it, up to MAX_RIDERS. `currentBody`/`facing` below
	// expose riders[0] — the "primary" rider — so every pre-multiplier caller
	// (tests, stats, the start marker) keeps working unchanged.
	private riders: RiderSlot[]
	// Collision snapshot frozen at run start so a mid-run edit can't change what
	// the sled hits (the track is read-only while playing; this defends it anyway).
	private segments: TrackSegment[] = []
	private checkpoints: Checkpoint[] = []
	private portals: Portal[] = []
	private multipliers: Multiplier[] = []
	// Checkpoint ids scored this run; reset when a run begins so flags re-arm.
	// Shared across every rider so a flag scores once per run no matter which
	// rider reaches it first.
	private collected = new Set<string>()

	// Edge tracking so we only re-seat / snapshot on a transition, not every frame.
	private wasPlaying = false
	private lastStart: Vec2
	private lastReset: number
	// True once a run has begun and not yet been reset. Distinguishes the first
	// play (start fresh from the spawn point) from resuming after a pause (continue
	// the existing body). A reset / start-move clears it so the next play begins anew.
	private runActive = false

	constructor(track: TrackSource, inputs: RunInputs) {
		this.track = track
		this.riders = [{ body: makeBody(inputs.start), facingX: 1 }]
		this.lastStart = inputs.start
		this.lastReset = inputs.resetNonce
	}

	/** The primary rider's body — the original single-rider API. Use `bodies` to
	 * see every active rider (after a multiplier split). */
	get currentBody(): Body {
		return this.riders[0].body
	}

	/** Every active rider's body, in split order (index 0 is always the primary
	 * rider `currentBody` also points to). */
	get bodies(): Body[] {
		return this.riders.map((r) => r.body)
	}

	/** The collision snapshot the sim is (or last) running against. */
	get currentSegments(): TrackSegment[] {
		return this.segments
	}

	get currentCheckpoints(): Checkpoint[] {
		return this.checkpoints
	}

	/** The portals the sim is (or last) running against. For the debug overlay. */
	get currentPortals(): Portal[] {
		return this.portals
	}

	/** The multipliers the sim is (or last) running against. For the debug overlay. */
	get currentMultipliers(): Multiplier[] {
		return this.multipliers
	}

	get collectedCount(): number {
		return this.collected.size
	}

	/** The primary rider's held facing. See `facings` for every rider's. */
	get facing(): 1 | -1 {
		return this.riders[0].facingX
	}

	/** Every active rider's held horizontal facing, aligned index-for-index with
	 * `bodies`. */
	get facings(): (1 | -1)[] {
		return this.riders.map((r) => r.facingX)
	}

	/**
	 * Reconcile against this frame's inputs BEFORE stepping. Re-seats the body when
	 * the start point moves or the reset nonce bumps (immediate feedback even while
	 * stopped, and it ends any active run so the next play starts fresh). Snapshots
	 * the track + clears run state only on the FIRST play of a run; a play edge while
	 * a run is already active is a resume (pause -> continue) and leaves the body be.
	 * Returns a discriminated outcome so the loop can react (clear telemetry on a
	 * re-seat; resume audio + publish the fresh score on a run start).
	 */
	sync(inputs: RunInputs): { reseated: boolean; runStarted: boolean } {
		let reseated = false
		if (inputs.start !== this.lastStart || inputs.resetNonce !== this.lastReset) {
			this.lastStart = inputs.start
			this.lastReset = inputs.resetNonce
			this.reseat(inputs.start)
			this.runActive = false
			reseated = true
		}

		// Begin a run only on the first play after a reset/start-move. Toggling play
		// off then on while a run is active resumes it — no re-seat.
		let runStarted = false
		if (inputs.playing && !this.wasPlaying && !this.runActive) {
			this.beginRun(inputs.start)
			this.runActive = true
			runStarted = true
		} else if (inputs.playing && !this.wasPlaying) {
			// Resume after a pause: the body continues where it left off, but the
			// track is editable while paused (App drops read-only on pause), so a
			// shape moved/rotated/recolored mid-pause would leave the frozen snapshot
			// stale — the sled would collide against the OLD geometry (the rotated-
			// shape glitch). Re-freeze the snapshot from the live track on every play
			// edge so resume picks up any edits, without disturbing the body.
			this.snapshotTrack()
		}
		this.wasPlaying = inputs.playing

		return { reseated, runStarted }
	}

	/** Rebuild to a single fresh rider at `start`, facing +x — collapses any
	 * multiplier splits from a prior run. Does not touch the track snapshot. */
	private reseat(start: Vec2): void {
		this.riders = [{ body: makeBody(start), facingX: 1 }]
	}

	/**
	 * A run begins: re-seat at the start and freeze the current track as this run's
	 * collision + checkpoint snapshot, re-arming all flags.
	 */
	private beginRun(start: Vec2): void {
		this.reseat(start)
		this.snapshotTrack()
		this.collected = new Set<string>()
	}

	/**
	 * Freeze the live track as this run's collision + checkpoint snapshot. The sim
	 * runs against this frozen copy (the canvas is read-only while playing). Called
	 * at run start AND on resume after a pause, so edits made while paused (e.g.
	 * rotating a shape) take effect rather than leaving the sled colliding against
	 * stale geometry. Does not touch `collected`, so a resume keeps scored flags.
	 */
	private snapshotTrack(): void {
		this.segments = this.track.segments()
		this.checkpoints = this.track.checkpoints()
		this.portals = this.track.portals()
		this.multipliers = this.track.multipliers()
	}

	/**
	 * Advance every active rider one fixed substep against the frozen snapshot,
	 * then test each rider's center against the checkpoints (per substep so a fast
	 * sled can't tunnel past a flag between rendered frames). `contacts` is the
	 * caller's reused buffer (cleared here, then appended to by every rider) so the
	 * loop stays allocation-free; the sim fills it and it's returned for the loop's
	 * audio diffing.
	 */
	stepFixed(dt: number, contacts: ContactEvent[]): SubstepResult {
		contacts.length = 0

		// Snapshot the rider count before stepping: a multiplier split this substep
		// appends a new rider to `this.riders` at the end of the loop below, so it
		// starts fresh next substep rather than also getting stepped (and possibly
		// re-triggering) in the same pass it was created — the same one-teleport-
		// per-substep discipline a normal portal exit already gets for free by
		// running once per rider per call.
		const n = this.riders.length
		const spawned: RiderSlot[] = []
		for (let i = 0; i < n; i++) {
			const slot = this.riders[i]
			stepBody(slot.body, this.segments, dt, contacts)

			// Portal teleport / multiplier split: once the cooldown clears, if the
			// rider's center has entered a portal's entrance region, jump it to the
			// exit (velocity re-aimed by the mouths' rotation difference, speed
			// preserved); if it's entered a multiplier's entrance instead, split it
			// into two riders exiting both mouths, each carrying the entry velocity.
			// Re-arm the cooldown on every body that just teleported/split so it can't
			// immediately re-enter the mouth it just left/emerged from. Runs after the
			// physics substep so it acts on the settled pose, and before scoring so a
			// portal/multiplier that drops a rider onto a checkpoint still scores this
			// substep.
			if (slot.body.portalCooldown > 0) {
				slot.body.portalCooldown--
				continue
			}
			const c = bodyCenter(slot.body)
			let teleported = false
			for (const portal of this.portals) {
				if (pointInMouth(c, portal.entrance)) {
					teleportBody(slot.body, portal, c)
					slot.body.portalCooldown = PHYSICS.portalCooldownSubsteps
					teleported = true
					break
				}
			}
			if (teleported) continue
			if (n + spawned.length >= MAX_RIDERS) continue
			for (const multiplier of this.multipliers) {
				if (pointInMouth(c, multiplier.entrance)) {
					const [, clone] = splitBody(slot.body, multiplier, c)
					slot.body.portalCooldown = PHYSICS.portalCooldownSubsteps
					clone.portalCooldown = PHYSICS.portalCooldownSubsteps
					spawned.push({ body: clone, facingX: slot.facingX })
					break
				}
			}
		}
		this.riders.push(...spawned)

		let scored = false
		if (this.checkpoints.length > 0) {
			for (const slot of this.riders) {
				const hits = collectCheckpointHits(bodyCenter(slot.body), this.checkpoints, this.collected)
				if (hits.length > 0) scored = true
			}
		}
		return { contacts, scored }
	}

	/**
	 * Update every rider's horizontal facing from its own motion (held while
	 * crashed — a ragdoll has no meaningful "forward" — and inside the speed
	 * dead-band, so a slow/stationary snail doesn't strobe), then return the
	 * primary rider's. See `facings` for every rider's updated value.
	 */
	updateFacing(dt: number, deadband: number): 1 | -1 {
		for (const slot of this.riders) {
			if (!slot.body.crashed) {
				slot.facingX = bodyFacing(slot.body, dt, deadband, slot.facingX)
			}
		}
		return this.riders[0].facingX
	}
}
