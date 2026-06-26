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
	ant: { facingOffset: 0, upright: false }, // walks head-first along its heading
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
/**
 * How firmly the creature steers away from a wall, in radians/ms at full depth. Tuned
 * UP from the original gentle 0.004: at the old rate a creature aimed straight at a wall
 * turned only ~7°/write, so it could reach the wall and sit pinned by the confinement
 * clamp (heading still into the wall) for many ticks before curving off — the "stuck on
 * walls" symptom. At 0.012 a fully-cornered creature reverses course in a few writes,
 * so it peels off the wall promptly instead of grinding along it.
 */
const AVOID_RATE = 0.012
/**
 * Start steering away once the body is within this fraction of the LOCAL room from a wall.
 * Widened from 0.22 so the curve-away begins earlier and the creature rarely reaches the
 * wall at all — the steering has more runway to bend the heading before contact.
 */
const AVOID_MARGIN = 0.32
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
 *   tank — CACHED tank membership. The tank a creature is in almost never changes
 *              frame-to-frame, but the hit-test to find it (getShapeAtPoint) is the
 *              swim loop's dominant per-tick cost at scale (~50ms/frame at 200
 *              creatures — see the stress test). So we cache the whole CLUSTER and
 *              only re-run the hit-test when the creature leaves the cluster (a cheap
 *              per-box AABB check) or its seed shape disappears.
 *
 * A "tank" is no longer a single geo shape: it's a CLUSTER — the connected set of
 * touching native geo shapes (see resolveCluster). Touching shapes share their
 * navigation space, so a creature roams freely from one into the next and users can
 * build multi-room levels by abutting rectangles. The cluster is modelled as the
 * list of its members' page-space AABBs (`boxes`) plus their combined outer AABB
 * (`union`, used only for the cheap cache check). Confinement and wall-avoidance run
 * against the box LIST, so the creature is held inside the non-convex union and the
 * seams where boxes meet are NOT treated as walls.
 */
type SwimState = {
	heading: number
	wander: number
	cx: number
	cy: number
	speed: number
	tank: Cluster | null
}

/**
 * A tank cluster: the connected component of touching geo shapes a creature lives in.
 *   seedId — one member's id, used only to revalidate the cache (still exists?).
 *   boxes  — every member's page-space AABB. Confinement + avoidance iterate these.
 *   union  — the combined outer AABB of all boxes; a fast pre-filter for the cache
 *            check (a point outside the union is outside every box).
 */
type Cluster = {
	seedId: TLShapeId
	boxes: Box[]
	union: Box
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
			tank: null,
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

	// RESOLVE THE TANK CLUSTER, cached. The expensive part — getShapeAtPoint plus the
	// connected-component walk — is the swim loop's dominant per-tick cost at scale, but
	// the cluster rarely changes. So: if the centre is still inside the cached cluster
	// (any member box) AND its seed shape still exists, reuse it (a cheap per-box AABB
	// check). Only fall back to the hit-test + cluster walk on a miss (first run, or the
	// creature swam/was dragged out of the cluster).
	let tank = s.tank
	const inCached = tank !== null && clusterContains(tank, bounds.center) && !!editor.getShape(tank.seedId)
	if (!inCached) {
		const found = resolveCluster(editor, creature.id)
		if (!found) {
			// Left every tank → drop the cache and stop roaming (still undulates).
			s.tank = null
			return
		}
		s.tank = found
		tank = found
	}
	if (!tank) return // not in a tank → no roaming (it still undulates in place)

	// Meander: nudge the heading by a smooth, slowly-varying amount. Using the
	// wander phase (advanced each tick) keeps turns gentle and frame-rate-stable.
	s.wander += dt * 0.002
	s.heading += Math.sin(s.wander) * TURN_RATE * dt

	// WALL AVOIDANCE (not bounce): as the body's centre nears a wall, steer the
	// heading toward the tank interior — gently when just inside the margin, more
	// firmly the closer it gets. The creature curves away before reaching the edge.
	//
	// CLUSTER-AWARE: a creature should steer away from the OUTER boundary of the whole
	// connected region, never from a seam where two rooms meet. The earlier "pick one home
	// box and skip walls that touch a neighbour" approach mis-fired in the overlap zone —
	// it would treat a real outer wall as open (because the *other* box sat past it on a
	// different side) and suppress the steering, so the creature ran into the wall and got
	// hard-clamped ("hits and stops"). Instead we measure, in each of the four directions,
	// the distance from the centre to the cluster's outer boundary along that axis
	// (clusterClearance): how far the creature could travel that way before leaving the
	// UNION of rooms. A seam contributes a large clearance (the next room continues), so it
	// produces no push; only a true outer edge is near, so only it steers. Margin scales to
	// the local room so rooms of any size steer naturally.
	const home = boxContaining(tank, s.cx, s.cy) ?? nearestBox(tank, s.cx, s.cy)
	const margin = Math.min(home.width, home.height) * AVOID_MARGIN
	let ax = 0
	let ay = 0
	if (margin > 0) {
		const dxL = clusterClearance(tank, s.cx, s.cy, -1, 0) // room to the LEFT
		const dxR = clusterClearance(tank, s.cx, s.cy, 1, 0) // room to the RIGHT
		const dyT = clusterClearance(tank, s.cx, s.cy, 0, -1) // room UP
		const dyB = clusterClearance(tank, s.cx, s.cy, 0, 1) // room DOWN
		if (dxL < margin) ax += 1 - dxL / margin // little room left → push right
		if (dxR < margin) ax -= 1 - dxR / margin // little room right → push left
		if (dyT < margin) ay += 1 - dyT / margin // little room up → push down
		if (dyB < margin) ay -= 1 - dyB / margin // little room down → push up
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
	// CONFINE to the cluster. The union of touching boxes is non-convex, so we can't
	// clamp to one AABB. confineToCluster projects the centre back inside whichever box
	// it's in (or nearest, when a step crossed a seam) — so the creature is held inside
	// the whole multi-room region but can pass freely between abutting rooms. We inset by
	// the half-extents so the BODY stays inside, but only as far as each box allows (a
	// narrow room never insets past its own centre), matching the old single-tank clamp.
	const halfW = creature.props.w / 2
	const halfH = creature.props.h / 2
	const confined = confineToCluster(tank, s.cx, s.cy, halfW, halfH)
	s.cx = confined.x
	s.cy = confined.y

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

// ── TANK CLUSTERS: navigation spanning touching geo shapes ─────────────────────
/**
 * Two geo boxes are "touching" — and so share a tank — when their AABBs overlap OR
 * abut within this slack (page px). Slack absorbs the sub-pixel gap from snapping /
 * rounding when a user butts two rectangles edge-to-edge, so a hairline seam still
 * reads as one connected level instead of trapping the creature on one side.
 */
const TOUCH_SLACK = 2

/** Do two page-space AABBs overlap or abut within TOUCH_SLACK (→ same cluster)? */
function boxesTouch(a: Box, b: Box): boolean {
	return (
		a.minX <= b.maxX + TOUCH_SLACK &&
		b.minX <= a.maxX + TOUCH_SLACK &&
		a.minY <= b.maxY + TOUCH_SLACK &&
		b.minY <= a.maxY + TOUCH_SLACK
	)
}

/**
 * Build the CLUSTER a creature lives in: the connected component of touching native
 * geo shapes reachable from the geo shape under the creature's centre. A flood-fill
 * over `boxesTouch` from that seed shape across all geo shapes on the page. Returns
 * undefined when the creature isn't over any geo shape (→ no tank, it just undulates).
 *
 * Cost: O(geoShapes²) in the worst case, but it only runs on a CACHE MISS (the
 * creature crossed out of its cached cluster), not every tick — see SwimState.
 */
function resolveCluster(editor: Editor, creatureId: TLShapeId): Cluster | undefined {
	const seed = tankUnderWithId(editor, creatureId)
	if (!seed) return undefined

	// Collect every geo shape's AABB once, then flood-fill from the seed over touches.
	const geos: { id: TLShapeId; box: Box }[] = []
	for (const shape of editor.getCurrentPageShapes()) {
		if (shape.type !== 'geo') continue
		const box = editor.getShapePageBounds(shape.id)
		if (box) geos.push({ id: shape.id, box })
	}

	const boxes: Box[] = []
	const visited = new Set<TLShapeId>([seed.id])
	const frontier: Box[] = [seed.bounds]
	boxes.push(seed.bounds)
	while (frontier.length > 0) {
		const cur = frontier.pop()!
		for (const g of geos) {
			if (visited.has(g.id)) continue
			if (boxesTouch(cur, g.box)) {
				visited.add(g.id)
				boxes.push(g.box)
				frontier.push(g.box)
			}
		}
	}

	// Combined outer AABB — the cheap pre-filter for the per-tick cache check.
	let minX = Infinity
	let minY = Infinity
	let maxX = -Infinity
	let maxY = -Infinity
	for (const b of boxes) {
		if (b.minX < minX) minX = b.minX
		if (b.minY < minY) minY = b.minY
		if (b.maxX > maxX) maxX = b.maxX
		if (b.maxY > maxY) maxY = b.maxY
	}
	const union = new Box(minX, minY, maxX - minX, maxY - minY)
	return { seedId: seed.id, boxes, union }
}

/** Is a point inside ANY member box of the cluster? (union is a fast pre-filter.) */
function clusterContains(cluster: Cluster, p: Vec): boolean {
	if (!cluster.union.containsPoint(p)) return false
	return cluster.boxes.some((b) => b.containsPoint(p))
}

/** The cluster box containing (x, y), or undefined if the point is between boxes. */
function boxContaining(cluster: Cluster, x: number, y: number): Box | undefined {
	return cluster.boxes.find((b) => x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY)
}

/** The cluster box whose centre is nearest (x, y) — the fallback home box. */
function nearestBox(cluster: Cluster, x: number, y: number): Box {
	let best = cluster.boxes[0]
	let bestD = Infinity
	for (const b of cluster.boxes) {
		const dx = b.center.x - x
		const dy = b.center.y - y
		const d = dx * dx + dy * dy
		if (d < bestD) {
			bestD = d
			best = b
		}
	}
	return best
}

/**
 * How far the centre (x, y) can travel in an AXIS direction (dirX,dirY) — one of
 * (±1,0)/(0,±1) — before leaving the cluster's UNION of rooms. This is the distance to
 * the OUTER boundary along that axis, treating seams as transparent: a ray cast that way
 * passes through every box whose perpendicular span covers (x, y), and the clearance is
 * how far the union extends before a gap. Wall-avoidance and confinement both read this,
 * so a wall that opens into the next room reports a large clearance (no push, no clamp)
 * while a true outer edge reports a small one.
 *
 * Walk: among boxes that straddle the ray, start from the one containing (x,y) and extend
 * the reachable interval as long as the next box abuts (within TOUCH_SLACK) the running
 * frontier. The clearance is the frontier edge minus the current coordinate.
 */
function clusterClearance(cluster: Cluster, x: number, y: number, dirX: -1 | 0 | 1, dirY: -1 | 0 | 1): number {
	const horizontal = dirX !== 0
	// Boxes whose PERPENDICULAR span covers the point lie on the ray's path.
	const onRay = cluster.boxes.filter((b) =>
		horizontal ? y >= b.minY && y <= b.maxY : x >= b.minX && x <= b.maxX
	)
	if (onRay.length === 0) return 0
	// The coordinate we're advancing, and a helper for a box's near/far edge along it.
	const coord = horizontal ? x : y
	const lo = (b: Box): number => (horizontal ? b.minX : b.minY)
	const hi = (b: Box): number => (horizontal ? b.maxX : b.maxY)
	const forward = (horizontal ? dirX : dirY) > 0

	// Extend a frontier outward from `coord` through abutting boxes; clearance = |frontier − coord|.
	if (forward) {
		let frontier = coord
		let grew = true
		while (grew) {
			grew = false
			for (const b of onRay) {
				if (lo(b) <= frontier + TOUCH_SLACK && hi(b) > frontier) {
					frontier = hi(b)
					grew = true
				}
			}
		}
		return Math.max(0, frontier - coord)
	} else {
		let frontier = coord
		let grew = true
		while (grew) {
			grew = false
			for (const b of onRay) {
				if (hi(b) >= frontier - TOUCH_SLACK && lo(b) < frontier) {
					frontier = lo(b)
					grew = true
				}
			}
		}
		return Math.max(0, coord - frontier)
	}
}

/**
 * Project (x, y) back inside the cluster so the creature stays in the multi-room region.
 * We first snap the point into the union (nearest box if a step carried it past every
 * box), then push it off any OUTER boundary by the half-extents so the BODY stays inside.
 * "Outer" is read from clusterClearance: a direction whose clearance is larger than the
 * inset is a seam or open interior (leave it), a direction whose clearance is smaller is a
 * true outer wall (push in by the shortfall). A seam therefore never re-traps the creature,
 * and the body still tucks fully inside real edges — matching the old single-tank clamp.
 */
function confineToCluster(cluster: Cluster, x: number, y: number, halfW: number, halfH: number): Vec {
	// 1) Snap into the union: if the step left every box, pull back to the nearest box edge.
	let cx = x
	let cy = y
	if (!boxContaining(cluster, cx, cy)) {
		const b = nearestBox(cluster, cx, cy)
		cx = clamp(cx, b.minX, b.maxX)
		cy = clamp(cy, b.minY, b.maxY)
	}
	// 2) Tuck the body off any nearby OUTER wall (clearance < inset), leaving seams alone.
	const clrL = clusterClearance(cluster, cx, cy, -1, 0)
	const clrR = clusterClearance(cluster, cx, cy, 1, 0)
	const clrT = clusterClearance(cluster, cx, cy, 0, -1)
	const clrB = clusterClearance(cluster, cx, cy, 0, 1)
	if (clrL < halfW) cx += halfW - clrL
	if (clrR < halfW) cx -= halfW - clrR
	if (clrT < halfH) cy += halfH - clrT
	if (clrB < halfH) cy -= halfH - clrB
	return new Vec(cx, cy)
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
