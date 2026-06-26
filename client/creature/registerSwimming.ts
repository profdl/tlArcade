/**
 * FISHTANK SWIMMING  (creature roaming)
 * =====================================
 * "Drop a creature on a native geo shape → it swims around inside it, as if the
 * geo shape were a fishtank." A creature NOT over a geo shape just undulates in
 * place (the in-shape animation in CreatureShape.tsx); this file only adds the
 * roaming.
 *
 * NATIVE-FIRST, and consistent with client/physics/registerPhysics.ts:
 *   • We ride tldraw's own per-frame `editor.on('tick', elapsedMs => …)` — no
 *     separate rAF (the creature CLOCK already rides this too).
 *   • We move a creature by writing `shape.x/y` (+ `rotation` so it faces where
 *     it's going) DIRECTLY, client-local, inside `editor.run(fn, { history:
 *     'ignore' })`. Sync replicates the positions to every other client for free,
 *     exactly like a drag or the throw-physics loop — so we do NOT sync any
 *     per-frame velocity ourselves (CLAUDE.md gotchas #5 & #7).
 *   • The "tank" is found with `editor.getShapeAtPoint(center, { filter, hitInside
 *     })`, the same native hit-test registerSnapping/isThrowable use to find the
 *     grid under a piece.
 *
 * TANK = NATIVE GEO SHAPES ONLY. A geo shape is tldraw's built-in rectangle/
 * ellipse/etc. (`type === 'geo'`). Hand-drawn shapes from the draw tool are
 * `type === 'draw'` and are deliberately NOT tanks — a creature ignores them.
 *
 * MOTION = gentle wander + wall AVOIDANCE (steering, not bounce) + propulsion.
 * Each creature carries a slow drifting heading that meanders (seeded per
 * creature) and steers away from the tank walls before reaching them; forward
 * speed is modulated by the shared tailBeat thrust. Speed is its `props.speed` knob.
 *
 * OWNERSHIP: like physics, this is client-local. Every client runs the loop, but
 * to keep clients from fighting over shared x/y we elect ONE driver per page —
 * the connected client with the lowest user id (see ownsSwimmingLead). That one
 * client drives every creature on the page; the rest just render the synced
 * positions. Simpler than per-creature assignment and good enough for a demo.
 *
 * Mount once from <Tldraw onMount> alongside the other behaviours; returns a
 * disposer.
 */
import { Box, Editor, TLShapeId, Vec } from 'tldraw'
import { creatureClock, jellyfishPropulsion, jellyfishTilt, positionWriteHz, tailBeat } from './clock'
import { CreatureShape } from '../shapes/CreatureShape'
import type { CreatureKind } from '../../shared/shape-schemas'

/**
 * How each creature kind ORIENTS itself relative to its travel direction. All
 * variants are drawn head-LEFT (forward = −x), so the default rotation that points
 * the head along the heading is `heading + π`. Per-kind tweaks:
 *   facingOffset — extra radians added to that, so a crab leads with its SIDE
 *                  (carapace sideways, classic crab scuttle) rather than head-first.
 *   upright      — ignore heading for facing and keep the creature roughly UPRIGHT
 *                  (jellyfish drift but the bell stays up); it still translates.
 */
const FACING: Record<CreatureKind, { facingOffset: number; upright: boolean }> = {
	fish: { facingOffset: 0, upright: false },
	snake: { facingOffset: 0, upright: false },
	crab: { facingOffset: Math.PI / 2, upright: false }, // lead with the side → sideways
	jellyfish: { facingOffset: 0, upright: true }, // bell stays up; drifts, doesn't aim
}

/** Base swim speed in page px/ms at speed:1 (a calm drift). */
const BASE_SPEED = 0.05
/**
 * Fraction of base speed kept between tail-beats, so it coasts (never stalls).
 * Higher = more momentum carried through the coast → smoother glide, less lurch.
 */
const GLIDE_FLOOR = 0.62
/**
 * How fast the actual forward speed EASES toward its target each ms. The target
 * surges/eases with the tail-beat thrust; easing the real velocity toward it (a
 * low-pass) turns the abrupt per-beat surge into a smooth swell, so the glide
 * doesn't visibly jerk on every stroke. ~0.008/ms ≈ a ~125ms smoothing window.
 */
const SPEED_EASE = 0.008
// ── Jellyfish-specific propulsion (jet up on each pump, sink between) ──────────
/** Peak-speed multiplier for the jelly's brief, sharp jet impulse (vs. a fish's
 *  sustained thrust) so each lurch still covers ground. */
const JELLY_THRUST = 3.0
/** The jelly eases speed faster than a fish (shorter low-pass) so the impulse stays
 *  a crisp lurch instead of smearing into a steady glide. */
const JELLY_SPEED_EASE = 0.02
/** Steady downward drift (page px/ms at speed 1) between pumps — the bell sinks as it
 *  refills. Tuned to ~85% of the jet's AVERAGE speed so each cycle bobs up then settles
 *  with only a slight net rise: it roams vertically instead of pinning the ceiling. */
const JELLY_SINK = 0.054
/** How sharply the heading meanders, in radians/ms. Gentle — barely curving. */
const TURN_RATE = 0.0004
/** How firmly the creature steers away from a wall, in radians/ms at full depth. */
const AVOID_RATE = 0.004
/** Start steering away once the body is within this fraction of the tank from a wall. */
const AVOID_MARGIN = 0.22
/**
 * Cap dt so a tab-switch stall can't teleport a creature across its tank. Must be
 * ≥ the longest position-write THROTTLE interval (1000 / slowest positionWriteHz =
 * 1000/20 = 50ms), or a throttled write at a big fleet would integrate less time
 * than actually elapsed and the swim would run slow. 64 covers it with headroom.
 */
const MAX_DT = 64
/**
 * If the shape's stored centre jumps further than this from where we last left
 * it, treat it as a USER DRAG and resync to it (rather than our own integration).
 * Must exceed the largest single-WRITE swim step so our own writes never trip it:
 * one step ≈ BASE_SPEED · MAX_DT · speed; at speed 1 that's ~3.2px, so 8px leaves
 * headroom up to speed ~2.5 before a fast creature could false-trigger.
 */
const DRAG_RESYNC_DIST = 8

/**
 * Per-creature live swim state, kept LOCAL (never synced):
 *   heading  — current travel direction (radians); the body's HEAD leads it
 *   wander   — phase of the slow meander that steers `heading`
 *   cx, cy   — the body's CENTRE in page space. We integrate motion on the centre
 *              and derive the shape's top-left from it each tick, so translation
 *              and rotation stay consistent (no fighting between a manual move and
 *              a centre-pivot rotate).
 *   speed    — the EASED forward speed (px/ms), low-passed toward the tail-beat
 *              target so the per-stroke surge reads as a smooth swell, not a jerk.
 *   tankId / tankBounds — CACHED tank membership. The tank a creature is in almost
 *              never changes frame-to-frame, but the hit-test to find it
 *              (getShapeAtPoint) is the swim loop's dominant per-tick cost at scale
 *              (~50ms/frame at 200 creatures — see the stress test). So we cache it
 *              and only re-run the hit-test when the creature leaves the cached
 *              tank's bounds (a cheap AABB check) or the tank disappears.
 */
type SwimState = {
	heading: number
	wander: number
	cx: number
	cy: number
	speed: number
	tankId: TLShapeId | null
	tankBounds: Box | null
}

/**
 * TEMP dev escape hatch: set `window.__SWIM_OFF = true` (or via the stress test)
 * to disable the swim loop entirely, so a profiling run measures ONLY the render
 * cost. Lets us tell whether the per-tick O(N) hit-tests in this loop, or the
 * rendering, is the scaling bottleneck. Remove with the stress harness.
 */
declare global {
	interface Window {
		__SWIM_OFF?: boolean
	}
}

export function registerSwimming(editor: Editor): () => void {
	let busy = false
	const state = new Map<TLShapeId, SwimState>()
	// Time (ms) accumulated since we last WROTE positions. We integrate over the
	// whole accumulated dt in one write, then reset — so throttling the write rate
	// down (for big fleets) doesn't slow the swim, it just makes it coarser.
	let sinceWrite = 0

	const onTick = (elapsedMs: number) => {
		if (busy || elapsedMs <= 0) return
		if (typeof window !== 'undefined' && window.__SWIM_OFF) return // profiling: render-only
		// Never integrate while the pointer is down — writing positions under a live
		// drag breaks hit-testing and the pointer-up release (same gate as physics).
		if (editor.inputs.getIsPointing()) return

		// Only the elected lead client drives motion (avoids clients fighting over
		// the synced x/y). Checked once per tick — it's a per-page election, not
		// per creature.
		if (!ownsSwimmingLead(editor)) return

		const creatures = editor
			.getCurrentPageShapes()
			.filter((s): s is CreatureShape => s.type === 'creature')
		if (creatures.length === 0) return

		// THROTTLE position writes ONLY for big fleets. Translation through space
		// (unlike the body's cyclic undulation) looks visibly STEPPED if written at
		// less than frame rate, so small fleets — where smoothness matters and the
		// sync-diff cost is negligible — write EVERY tick (writeHz = 0 → per-frame).
		// Large fleets throttle to cut the x/y/rotation sync broadcast: a 300-fish
		// tank at 30 writes/s emits a fraction of the diffs it would per-frame. We
		// bank elapsed time and integrate the whole accrued dt in one write, so the
		// motion covers the same ground regardless of write rate.
		const writeHz = positionWriteHz(creatures.length)
		sinceWrite += elapsedMs
		if (writeHz > 0) {
			const stepMs = 1000 / writeHz
			if (sinceWrite < stepMs) return
		}
		const dt = Math.min(sinceWrite, MAX_DT)
		sinceWrite = 0

		busy = true
		try {
			editor.run(
				() => {
					for (const creature of creatures) swimOne(editor, creature, state, dt)
				},
				{ history: 'ignore' }
			)
		} finally {
			busy = false
		}

		// Forget state for creatures that left the page (deleted / undone).
		if (state.size > creatures.length) {
			const live = new Set(creatures.map((c) => c.id))
			for (const id of state.keys()) if (!live.has(id)) state.delete(id)
		}
	}
	editor.on('tick', onTick)

	return () => {
		editor.off('tick', onTick)
		state.clear()
	}
}

/** Move one creature one tick within its tank (or leave it still if tankless). */
function swimOne(editor: Editor, creature: CreatureShape, all: Map<TLShapeId, SwimState>, dt: number) {
	const bounds = editor.getShapePageBounds(creature.id)
	if (!bounds) return

	// Lazily seed this creature's heading + centre from its current synced state,
	// so we begin integrating from where (and how) the shape actually is. CRUCIAL:
	// the heading must come from the creature's CURRENT rotation, not from its
	// seed — else the first tick after a drop would snap the body from its resting
	// angle to seed*2π, the visible "instant 90° rotation on drop" bug. The body
	// draws head-LEFT (forward = −x) and the loop writes rotation = heading + π, so
	// the inverse is heading = rotation − π. The seed only diversifies the MEANDER
	// (wander phase), so different creatures still wander differently.
	let s = all.get(creature.id)
	if (!s) {
		s = {
			heading: creature.rotation - Math.PI,
			wander: creature.props.seed * 10,
			cx: bounds.center.x,
			cy: bounds.center.y,
			speed: 0, // eases up from rest on the first strokes
			tankId: null,
			tankBounds: null,
		}
		all.set(creature.id, s)
	} else {
		// If a user dragged (or rotated) the creature, the store moved out from
		// under us — resync to it so we swim from where/how it was placed, not where
		// we left off. Small drifts are our own writes; a jump past DRAG_RESYNC_DIST
		// (well above one swim step) is a user move.
		if (Math.hypot(bounds.center.x - s.cx, bounds.center.y - s.cy) > DRAG_RESYNC_DIST) {
			s.cx = bounds.center.x
			s.cy = bounds.center.y
			s.heading = creature.rotation - Math.PI
		}
	}

	// RESOLVE THE TANK, cached. The expensive part — getShapeAtPoint — is the swim
	// loop's dominant per-tick cost at scale, but the tank rarely changes. So: if the
	// centre is still inside the cached tank's bounds AND that tank still exists,
	// reuse the cached bounds (a cheap AABB check). Only fall back to the hit-test on
	// a cache miss (first run, or the creature swam/was dragged out of its tank).
	let tank = s.tankBounds
	const inCached =
		tank !== null && s.tankId !== null && tank.containsPoint(bounds.center) && !!editor.getShape(s.tankId)
	if (!inCached) {
		const found = tankUnderWithId(editor, creature.id)
		if (!found) {
			// Left every tank → drop the cache and stop roaming (still undulates).
			s.tankId = null
			s.tankBounds = null
			return
		}
		s.tankId = found.id
		s.tankBounds = found.bounds
		tank = found.bounds
	}
	if (!tank) return // not in a tank → no roaming (it still undulates in place)

	// Meander: nudge the heading by a smooth, slowly-varying amount. Using the
	// wander phase (advanced each tick) keeps turns gentle and frame-rate-stable.
	s.wander += dt * 0.002
	s.heading += Math.sin(s.wander) * TURN_RATE * dt

	// WALL AVOIDANCE (not bounce): as the body's centre nears a wall, steer the
	// heading toward the tank interior — gently when just inside the margin, more
	// firmly the closer it gets. The creature curves away before reaching the edge.
	const margin = Math.min(tank.width, tank.height) * AVOID_MARGIN
	let ax = 0
	let ay = 0
	if (margin > 0) {
		const dxL = s.cx - tank.minX // distance to each wall
		const dxR = tank.maxX - s.cx
		const dyT = s.cy - tank.minY
		const dyB = tank.maxY - s.cy
		if (dxL < margin) ax += 1 - dxL / margin // too close to LEFT → push right
		if (dxR < margin) ax -= 1 - dxR / margin // too close to RIGHT → push left
		if (dyT < margin) ay += 1 - dyT / margin // too close to TOP → push down
		if (dyB < margin) ay -= 1 - dyB / margin // too close to BOTTOM → push up
	}
	if (ax !== 0 || ay !== 0) {
		// Rotate `heading` toward the away-direction by an amount scaled to depth.
		const depth = Math.min(1, Math.hypot(ax, ay))
		const want = Math.atan2(ay, ax)
		let diff = want - s.heading
		diff = Math.atan2(Math.sin(diff), Math.cos(diff)) // shortest angular path
		s.heading += diff * Math.min(1, AVOID_RATE * dt * depth)
	}

	// PROPULSION: modulate forward speed, read from the same clock+seed+speed the body
	// renders with — so the canvas surge lines up with the VISIBLE animation on every
	// client. The envelope is KIND-SPECIFIC:
	//   • jellyfish — the JET IMPULSE (jellyfishPropulsion): ≈0 while the tentacles
	//     reach out (it barely moves), spiking the instant they snap straight, then
	//     ramping down — so the shape lurches forward exactly when the body visibly
	//     jets. It surges from a dead glide (no GLIDE_FLOOR), pulse-and-coast.
	//   • everything else — the tail-beat thrust (two smooth power strokes/cycle) with
	//     a high GLIDE_FLOOR so a fish coasts between flicks instead of stalling.
	const isJelly = creature.props.kind === 'jellyfish'
	const drive = isJelly
		? jellyfishPropulsion(creatureClock.get(), creature.props.seed, creature.props.speed)
		: GLIDE_FLOOR +
			(1 - GLIDE_FLOOR) * tailBeat(creatureClock.get(), creature.props.seed, creature.props.speed).thrust
	// The jelly's impulse is sharp + brief, so give it more peak speed to cover ground.
	const speedScale = isJelly ? JELLY_THRUST : 1
	const targetSpeed = BASE_SPEED * Math.max(0, creature.props.speed) * speedScale * drive
	// EASE the real speed toward the target (frame-rate-independent low-pass), so the
	// per-stroke surge becomes a smooth swell instead of an abrupt jerk each beat. The
	// jelly eases faster (shorter window) so its impulse stays a crisp lurch, not a smear.
	const ease = isJelly ? JELLY_SPEED_EASE : SPEED_EASE
	s.speed += (targetSpeed - s.speed) * Math.min(1, ease * dt)

	// Integrate the CENTRE. A jellyfish is `upright` (bell up) and JETS ALONG ITS BELL
	// AXIS on each pump — and that axis is TILTED by the stroke lean (jellyfishTilt),
	// so it pumps up-AND-to-the-side in whichever way it's leaning, then leans the OTHER
	// way next stroke: a zig-zag climb, not a twitch in place. The jet direction and the
	// shape's rotation use the SAME tilt, so the body always points where it's going.
	// Between pumps it SINKS gently straight down (the bell refilling). The up-jet is
	// stronger than the sink, so each cycle nets headway; every other kind moves where
	// its HEAD points. Wall avoidance + the clamp keep it in the tank (no ceiling-pin).
	const jellyTilt = isJelly ? jellyfishTilt(creatureClock.get(), creature.props.seed, creature.props.speed) : 0
	if (isJelly) {
		// Bell "up" is local −y; rotating it by the lean θ gives jet dir (sin θ, −cos θ).
		s.cx += Math.sin(jellyTilt) * s.speed * dt // sideways component of the tilted jet
		s.cy -= Math.cos(jellyTilt) * s.speed * dt // upward component of the tilted jet
		s.cy += JELLY_SINK * Math.max(0, creature.props.speed) * dt // steady drift back down
	} else {
		s.cx += Math.cos(s.heading) * s.speed * dt
		s.cy += Math.sin(s.heading) * s.speed * dt
	}
	const halfW = creature.props.w / 2
	const halfH = creature.props.h / 2
	s.cx = clamp(s.cx, tank.minX + halfW, Math.max(tank.minX + halfW, tank.maxX - halfW))
	s.cy = clamp(s.cy, tank.minY + halfH, Math.max(tank.minY + halfH, tank.maxY - halfH))

	// FACE THE HEADING (per-kind). The body is drawn head-LEFT in local space
	// (forward = −x), so heading + π points the head along travel. A crab adds a
	// 90° facingOffset so its SIDE leads (sideways scuttle); a jellyfish is `upright`
	// — it stays bell-up but leans by the STROKE TILT (jellyTilt, computed above) so the
	// bell points along its tilted jet and zig-zags as it climbs. Derive the top-left
	// from the desired CENTRE + rotation in ONE write so position and rotation never
	// disagree. NOTE: tldraw rotates about the top-left ORIGIN, so the centre→top-left
	// offset is (halfW, halfH) ROTATED by the angle.
	const face = FACING[creature.props.kind] ?? FACING.fish
	const rotation = face.upright ? jellyTilt : s.heading + Math.PI + face.facingOffset
	const half = new Vec(halfW, halfH).rot(rotation) // centre→top-left offset, rotated
	editor.updateShape<CreatureShape>({
		id: creature.id,
		type: 'creature',
		x: s.cx - half.x,
		y: s.cy - half.y,
		rotation,
	})
}

function clamp(n: number, lo: number, hi: number): number {
	return n < lo ? lo : n > hi ? hi : n
}

/**
 * The native geo shape under a creature's centre, if any — its tank. Mirrors the
 * grid hit-test in registerSnapping/isThrowable, but filtered to `type === 'geo'`
 * so ONLY tldraw's built-in geo shapes count (draw/frame/our shapes are skipped).
 *
 * Returns the tank's page-space AABB. Wall avoidance + clamping use this axis-
 * aligned box, so a ROTATED tank contains the creature in its bounding box, not
 * its true rotated outline — fine for the expected case (axis-aligned rectangles).
 *
 * Also imported by CreatureShape.tsx, which only needs the truthiness (in a tank
 * → animate; alone on the canvas → freeze).
 */
export function tankUnder(editor: Editor, id: TLShapeId) {
	return tankUnderWithId(editor, id)?.bounds
}

/** A mutable per-consumer cache of a creature's current tank. */
export type TankCache = { id: TLShapeId; bounds: Box } | null

/**
 * Truthy "is this creature in a tank?" with the expensive getShapeAtPoint CACHED.
 * The renderer's per-frame freeze check used to call tankUnder (→ getShapeAtPoint)
 * every animation frame per creature — the same uncached hit-test the swim loop
 * went to lengths to cache. This mirrors that: keep the last tank in `cache`, and
 * while the creature's centre stays inside the cached tank's bounds (a cheap AABB)
 * AND that tank still exists, reuse it; only re-run the hit-test on a miss. Still
 * reads getShapePageBounds(id) — reactive — so the caller's reactor re-subscribes
 * as the creature moves and self-heals when it enters/leaves a tank.
 */
export function tankUnderCached(editor: Editor, id: TLShapeId, cache: { current: TankCache }): boolean {
	const bounds = editor.getShapePageBounds(id)
	if (!bounds) return false
	const c = cache.current
	if (c && c.bounds.containsPoint(bounds.center) && editor.getShape(c.id)) return true
	const found = tankUnderWithId(editor, id)
	cache.current = found ? { id: found.id, bounds: found.bounds } : null
	return !!found
}

/**
 * Like tankUnder but also returns the tank's id, so the swim loop can CACHE which
 * tank a creature is in and skip this hit-test on subsequent ticks (see SwimState).
 */
function tankUnderWithId(editor: Editor, id: TLShapeId): { id: TLShapeId; bounds: Box } | undefined {
	const bounds = editor.getShapePageBounds(id)
	if (!bounds) return undefined
	const tank = editor.getShapeAtPoint(bounds.center, {
		filter: (s) => s.type === 'geo',
		hitInside: true,
	})
	if (!tank) return undefined
	const tankBounds = editor.getShapePageBounds(tank.id)
	if (!tankBounds) return undefined
	return { id: tank.id, bounds: tankBounds }
}

/**
 * Is THIS client the swim lead for the current page? To stop every client writing
 * the same positions (and fighting over them in sync), exactly one client drives
 * motion: the connected peer whose user id sorts first. We use
 * `getCollaboratorsOnCurrentPage()` (NOT `getCollaborators()`) so a peer viewing a
 * DIFFERENT page can't win the election and then drive nothing — which would
 * freeze every creature for the clients actually watching. Solo client → that's us.
 */
function ownsSwimmingLead(editor: Editor): boolean {
	const me = editor.user.getId()
	const others = editor.getCollaboratorsOnCurrentPage().map((c) => c.userId)
	if (others.length === 0) return true
	const all = [me, ...others].sort()
	return all[0] === me
}

/*
 * WHERE THIS GOES NEXT (known limitations, not bugs):
 *   • Single global lead: ONE client drives every creature on the page. If that
 *     client closes its tab, motion pauses until presence updates elect the next
 *     lead (a short gap). To load-share, assign each creature to a driver by
 *     hashing its id against the sorted collaborator list, so the fleet survives
 *     any one client leaving and the work spreads across tabs.
 *   • Server authority (SPEC §1): like the physics prototype, the loop could move
 *     into worker/Referee.ts so the Durable Object owns positions — removes the
 *     client-lead election and per-client drift entirely, at the cost of a server
 *     tick + protocol messages.
 *   • Rotated tanks: avoidance uses the tank's axis-aligned bounds (see tankUnder),
 *     so a rotated geo tank contains the creature in its bounding box, not its true
 *     outline. Transform the centre into tank-local space to fix.
 */
