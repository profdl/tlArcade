/**
 * CREATURE CLOCK  (the local animation tick)
 * ==========================================
 * A single, room-wide animation clock for every CreatureShape on this client.
 *
 * WHY THIS EXISTS (and why it is NOT in the store):
 * The creature's swim is a per-frame animation. If we wrote the phase into
 * `shape.props` every frame we would flood @tldraw/sync with writes (the
 * anti-pattern CLAUDE.md gotcha #7 warns about) and desync nothing useful —
 * the motion is purely cosmetic. So the clock lives LOCALLY, on each client,
 * and only the creature's `seed` is synced. Every client therefore draws the
 * SAME creature (deterministic from seed) but animates it on its own clock.
 *
 * WHY AN ATOM:
 * It is a tldraw `atom`, so a creature component reads it with `useValue` and
 * re-renders reactively each tick — the idiomatic reactive path (same pattern
 * as client/referee/privateReveals.ts). One atom serves N creatures: 10
 * creatures share one clock, not ten.
 *
 * NATIVE-FIRST — WHY NO requestAnimationFrame:
 * tldraw already runs a per-frame loop and emits `editor.on('tick', elapsedMs
 * => …)` (see client/physics/registerPhysics.ts, which rides the same event).
 * We listen to THAT instead of spinning our own rAF, so the whole client has a
 * single animation loop. The tick gives us elapsed milliseconds directly, so
 * we no longer track wall-clock timestamps ourselves.
 *
 * REF-COUNTING:
 * The listener attaches when the first creature mounts and detaches when the
 * last one unmounts, so an empty board never advances the clock.
 */
import { Editor, atom } from 'tldraw'

/**
 * Elapsed animation time in seconds. Reactive: read via
 * `useValue('creatureClock', () => creatureClock.get(), [])`.
 */
export const creatureClock = atom('creatureClock', 0)

/**
 * How many times/sec the swim loop WRITES creature positions, as a function of
 * fleet size. The body ANIMATION no longer needs a matching throttle — since the
 * render rewrite, undulation is transform-driven off the React path (see
 * CreatureShape.tsx), so it costs ~nothing per tick and runs at refresh rate.
 * Position writes still throttle at scale because each one is a sync-diff
 * broadcast: small fleets write EVERY frame (0 = no throttle, smoothest gliding),
 * and only large fleets throttle to cut the x/y/rotation broadcast volume.
 *
 *   ≤ 150 creatures → 0  (write every tick — fully smooth gliding)
 *   ≤ 300          → 30 writes/s
 *   > 300          → 20 writes/s
 */
export function positionWriteHz(count: number): number {
	if (count <= 150) return 0
	if (count <= 300) return 30
	return 20
}

/**
 * THE SHARED SWIM WAVE — the single source of "where in the tail-beat are we?".
 *
 * Both the body renderer (CreatureShape) and the movement loop (registerSwimming)
 * call this, so the forward THRUST lines up with the visible tail-FLICK and the
 * creature looks self-propelled. It is a PURE function of values every client
 * already shares — the clock (same on all clients), and the creature's synced
 * `seed`/`speed` — so the two systems stay coupled WITHOUT syncing anything new
 * (no per-frame phase in the store; CLAUDE.md gotchas #5 & #7). The movement
 * owner and a passive viewer compute the identical wave.
 *
 *   phase  — the tail-beat argument (radians). Beat rate scales with `speed`, so
 *            a faster fish beats faster. Feed into the body's travelling sine.
 *   thrust — 0..1 power-stroke envelope: ~1 mid-sweep (tail at full speed), ~0 at
 *            the turnaround. The swim loop multiplies forward motion by this, so
 *            the fish surges on each beat and glides between.
 */
export function tailBeat(clock: number, seed: number, speed: number): { phase: number; thrust: number } {
	// Beat frequency rises with speed (clamped so a still fish still idles a tail).
	const rate = 2 * (0.5 + Math.max(0, speed))
	const phase = clock * rate + seed * Math.PI * 2
	// |sin| gives two power strokes per cycle (tail sweeps both ways); square-ish
	// it slightly so thrust concentrates into the mid-sweep and eases at the ends.
	const s = Math.abs(Math.sin(phase))
	const thrust = s * s
	return { phase, thrust }
}

/**
 * THE JELLYFISH PROPULSION ENVELOPE — the SINGLE source of "how hard is the bell
 * jetting right now?", shared by the BODY animation (CreatureShape's bodyLift) and
 * the swim loop (registerSwimming) so the visible up-surge and the shape's actual
 * forward lurch are the SAME impulse, in lockstep, on every client.
 *
 * It's an asymmetric pump (fast contraction, slow recovery) shaped into a one-sided
 * IMPULSE that's ≈0 while the tentacles reach outward and spikes to 1 the instant
 * they snap STRAIGHT — then ramps down fast. Phased (JELLY_DRIVE_LAG) to the visible
 * lower-tentacle straightening, so the lurch lands exactly when they look straight.
 *
 *   clock/seed/speed — same shared inputs as tailBeat, so it's deterministic and
 *                      every client computes the identical impulse with no sync.
 *   returns 0..1 — the propulsion power this instant (1 = peak jet at straightening).
 *
 * NOTE: keep `beatScale` here in sync with jellyfishVariant.motion.beatScale, and the
 * pump SHAPE constants in sync with CreatureShape's pumpEnvelope — they describe the
 * same physical pump from the propulsion side. (Small, stable; not worth a shared import.)
 */
export function jellyfishPropulsion(clock: number, seed: number, speed: number): number {
	const beat = tailBeat(clock, seed, speed).phase * JELLY_BEAT_SCALE
	// Asymmetric pump ∈ [0,1]: 0 = bell relaxed (tentacles out), 1 = contracted (straight).
	const pump = Math.pow((1 - Math.cos(beat - JELLY_DRIVE_LAG)) * 0.5, JELLY_PUMP_SKEW)
	const straight = 1 - pump // 1 = tentacles straight, 0 = reached out
	return Math.pow(straight, JELLY_IMPULSE) // sharp pulse at straightening; ≈0 otherwise
}

/**
 * THE JELLYFISH STROKE LEAN — the bell's tilt (radians from upright) for the current
 * pump. Unlike a brief twitch, this is HELD across the whole stroke and the swim loop
 * JETS ALONG IT, so the animal pumps up-and-to-the-side in the direction it's leaning
 * (then the next stroke leans the OTHER way) — a zig-zag climb, not a twitch in place.
 *
 * Deterministic in the shared clock/seed/speed (no sync) and locked to the SAME pump
 * phase as jellyfishPropulsion, so the lean is fullest exactly WHILE it jets and eases
 * back toward upright between strokes (it rests vertical, leans as it pumps).
 *
 *   sign — ALTERNATES every pump cycle (left stroke, right stroke, …); `seed` picks
 *          which way the first stroke goes, so jellies aren't all in sync.
 *   amount — rides the propulsion envelope (≈0 at rest → JELLY_TILT at the jet peak).
 *   returns the signed lean in radians; pair it with jellyfishPropulsion (same phase)
 *   so the rotation and the jet direction always agree.
 */
export function jellyfishTilt(clock: number, seed: number, speed: number): number {
	const beat = tailBeat(clock, seed, speed).phase * JELLY_BEAT_SCALE
	const p = beat - JELLY_DRIVE_LAG
	// Lean amount follows the SAME impulse the jet uses, so the tilt is held through the
	// stroke and fades between — body + travel point the same way exactly while jetting.
	const pump = Math.pow((1 - Math.cos(p)) * 0.5, JELLY_PUMP_SKEW)
	const amount = Math.pow(1 - pump, JELLY_IMPULSE) // 1 at the jet peak, ≈0 at rest
	// Alternate the lean direction each pump cycle (parity of the cycle index, +seed).
	const cycle = Math.floor(p / (2 * Math.PI) + seed)
	const sign = cycle % 2 === 0 ? 1 : -1
	return sign * amount * JELLY_TILT
}

/** Peak stroke lean in radians (~12°): enough that the jet visibly angles sideways. */
const JELLY_TILT = 0.21

/** Tempo of the jellyfish pump — MUST match jellyfishVariant.motion.beatScale. */
const JELLY_BEAT_SCALE = 0.75
/** >1 skews the pump toward relaxed (slow recover, fast squeeze). Matches pumpEnvelope. */
const JELLY_PUMP_SKEW = 1.8
/** Phase so the lurch lands with the visible (lower) tentacle straightening. */
const JELLY_DRIVE_LAG = 1.9 // = PUMP_LAG (0.9) + BODY_TIP_LAG (1.0) from CreatureShape
/** Exponent shaping the surge into a sharp impulse (matches BODY_IMPULSE). */
const JELLY_IMPULSE = 4

let mountCount = 0
let off: (() => void) | null = null

/** tldraw's tick gives elapsed ms; advance the clock in seconds. */
function tick(elapsedMs: number) {
	if (elapsedMs > 0) creatureClock.set(creatureClock.get() + elapsedMs / 1000)
}

/**
 * Call from a creature's mount effect (it has the editor via `useEditor()`);
 * returns the matching unsubscribe. The tick listener is attached only while at
 * least one creature is mounted.
 */
export function subscribeCreatureClock(editor: Editor): () => void {
	mountCount++
	if (off === null) {
		editor.on('tick', tick)
		off = () => editor.off('tick', tick)
	}
	return () => {
		mountCount--
		if (mountCount <= 0 && off !== null) {
			off()
			off = null
			mountCount = 0
		}
	}
}
