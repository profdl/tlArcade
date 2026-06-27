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
import { Box, Editor, TLShapeId, TLShapePartial, Vec, atom } from 'tldraw'
import { creatureClock, jellyfishPropulsion, jellyfishTilt, positionWriteHz, tailBeat } from './clock'
import { CreatureShape } from '../shapes/CreatureShape'
import type { CreatureKind } from '../../shared/shape-schemas'

/**
 * The shape this loop swims: the `creature` shape, of any `kind`. (The line-fish is just
 * `kind:'lineFish'` — same prop shape, same tank/steering/navigation; it behaves as a fish
 * for facing/propulsion, see FACING below.)
 */
type SwimmableShape = CreatureShape

/** Shape types this loop drives. One source of truth for the filter + type guard below. */
const SWIMMABLE_TYPES = new Set<string>(['creature'])

/** The orientation kind for facing/propulsion. */
function swimKind(shape: SwimmableShape): CreatureKind {
	return shape.props.kind
}

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
	lineFish: { facingOffset: 0, upright: false }, // a fish reduced to its centreline — faces head-first
	inkFish: { facingOffset: 0, upright: false }, // the line-fish re-inked as a tapered body — same head-first facing
	snake: { facingOffset: 0, upright: false },
	crab: { facingOffset: Math.PI / 2, upright: false }, // lead with the side → sideways
	jellyfish: { facingOffset: 0, upright: true }, // bell stays up; drifts, doesn't aim
	ant: { facingOffset: 0, upright: false }, // walks head-first along its heading
}

// ════════════════════════════════════════════════════════════════════════════════
// TUNING KNOBS — the feel of the swim. Safe to nudge; each doc-comment says what the
// number trades off and which symptom it was tuned against. (The two STRUCTURAL
// constants below this block — MAX_DT, DRAG_RESYNC_DIST — are NOT feel knobs: they're
// coupled to the write cadence / drag detection, so read their comments before changing.)
// ════════════════════════════════════════════════════════════════════════════════

// ── Speed & propulsion ─────────────────────────────────────────────────────────
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
// ── Steering & turning ─────────────────────────────────────────────────────────
/** How sharply the heading meanders, in radians/ms. Gentle — barely curving. */
const TURN_RATE = 0.0004
/**
 * Hard cap on how fast the heading may turn, in radians/ms — a maximum YAW RATE. Steering
 * (meander + food + wall-avoidance) proposes a new heading each tick; this clamps the actual
 * change toward it so the body can never spin instantly. Without it, a steering TARGET that
 * jumps — e.g. the food waypoint flipping from a doorway to the next room's centre, an angle
 * swing of up to ~180° — would snap the rotation in a single tick (the per-tick ease factor
 * AVOID_RATE·dt approaches 1 at the dt cap). ~0.004 rad/ms ≈ 0.23°/ms ≈ a graceful ~90°
 * turn over ~390ms regardless of how abruptly the target moves, so doorway hand-offs read as
 * a smooth bank, not a snap. Tuned DOWN from 0.006 for lazier, more fish-like banking; if a
 * creature starts clipping a tight doorway corner before correcting, nudge it back up.
 */
const MAX_TURN_SPEED = 0.004
/**
 * Per-ms low-pass factor for the ANGULAR VELOCITY (s.turnRate) easing toward the turn the
 * steering wants this tick — an ACCELERATION limit on top of the speed cap. Without it the
 * turn rate can step 0 → MAX_TURN_SPEED the instant a target switches, so the body snaps into
 * a constant-rate turn (the "sudden turn" that survives the speed cap). Easing the rate ramps
 * each turn in and out — an S-curve bank. ~0.01/ms ≈ a ~100ms spin-up: quick enough to still
 * dodge walls, slow enough that a target switch no longer reads as a jerk. Lower = lazier.
 */
const TURN_ACCEL = 0.01
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

// ── Food attraction (green geo shapes attract creatures) ───────────────────────
/**
 * A geo shape with one of these colors is FOOD: the creature steers toward it. When
 * a creature reaches it, the food turns 'black' (EATEN_COLOR) and drops out of this
 * set, so it stops attracting. We accept both tldraw greens so either palette pick
 * reads as food.
 */
const FOOD_COLORS = new Set(['green', 'light-green'])
/** What an eaten food turns into — a color NOT in FOOD_COLORS, so it stops attracting. */
const EATEN_COLOR = 'black'
/**
 * How firmly the creature steers toward its food waypoint, in radians/ms. Set to MATCH
 * AVOID_RATE (not below it): a doorway often sits in a room CORNER, where two nearby outer
 * walls push back; if attraction were weaker than avoidance there, the creature would never
 * commit to the opening and would hover beside it (the "stuck at the doorway" symptom). At
 * parity, the toward-doorway pull balances the corner push and it threads through, while a
 * food in open water still reads as a deliberate beeline over the idle meander.
 */
const FOOD_ATTRACT_RATE = 0.012
/**
 * How fast the SMOOTHED aim point (s.navAim) eases toward the raw nav waypoint, per ms. The
 * raw waypoint jumps when the plan advances (doorway → next room → food); easing the aim
 * across that jump turns the desired-heading step into a continuous sweep, so the body rounds
 * the corner instead of pivoting. ~0.006/ms ≈ a ~165ms glide — long enough to visibly round a
 * doorway hand-off, short enough that the aim still leads the body to its actual target.
 */
const AIM_EASE = 0.006
/**
 * Minimum LOOK-AHEAD distance (page px) for food steering. The desired heading is the bearing
 * to the aim point, `atan2(aim − pos)` — which is numerically UNSTABLE when the aim sits right
 * on top of the body: a tiny position change swings the bearing wildly. That's the residual
 * jerk at a doorway hand-off — the fish is parked on the old aim (the doorway) just as it
 * switches, so the bearing to the gliding aim whips around. We fade the steering strength to
 * zero as the aim comes within this radius, so a near, fast-swinging bearing barely nudges the
 * heading and the fish coasts straight through on its existing course until the aim leads far
 * enough ahead again to give a stable bearing. ~1.5 body-lengths' worth in typical use.
 */
const MIN_AIM_DIST = 60
/**
 * A creature "reaches" (eats) food once its centre is within this slack of the food
 * box (page px). A little positive slack so the body need only TOUCH the food, not have
 * its centre cross the edge, to register the bite.
 */
const EAT_SLACK = 4

// ════════════════════════════════════════════════════════════════════════════════
// STRUCTURAL constants — NOT feel knobs. Coupled to the write cadence and drag
// detection; changing them can break correctness, not just feel. Read each comment.
// ════════════════════════════════════════════════════════════════════════════════
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
	/**
	 * Current ANGULAR VELOCITY (radians/ms) — the heading's rate of change, low-passed toward
	 * the per-tick desired turn. Capping the turn (MAX_TURN_SPEED) bounds the rate but lets it
	 * jump 0 → max the instant a target switches: a constant turn that snaps ON reads as a
	 * "sudden turn". Easing the RATE (an acceleration limit, TURN_ACCEL) makes the body ramp
	 * into and out of every turn — an S-curve bank with no angular-velocity discontinuity — so
	 * a target switch starts the turn gently instead of abruptly.
	 */
	turnRate: number
	wander: number
	cx: number
	cy: number
	speed: number
	tank: Cluster | null
	/**
	 * NAV HYSTERESIS. The room index the creature is currently COMMITTED to crossing into
	 * on its way to food, plus the doorway it's threading. Without this, navWaypoint re-ran a
	 * fresh BFS every tick off `roomIndexAt`, which OSCILLATES inside a narrow doorway (the
	 * thin overlap leaves the centre near-equally deep in both rooms), so the steering target
	 * teleported between unrelated points tick-to-tick — the "glitches in a narrow space"
	 * symptom. Instead we LOCK onto the committed next room + its doorway and only re-plan once
	 * the creature is firmly inside that next room (past the overlap), so the target is stable
	 * while transiting. Cleared when there's no food or the plan is reached/invalid.
	 */
	navNextRoom: number | null
	/**
	 * SMOOTHED AIM POINT (page space), low-passed toward the raw nav waypoint each tick. The
	 * raw waypoint is a STEP function — it jumps the instant the plan advances (doorway → next
	 * room's centre, or → the food). Steering at the raw point makes the desired heading jump
	 * too, so the body pivots abruptly (only bounded, not rounded, by the turn-rate cap). We
	 * instead steer toward THIS, which eases toward the raw waypoint (aimEase), so when the
	 * waypoint switches the aim glides across and the `want` angle changes continuously — the
	 * turn rounds the corner. Null until the first hunt seeds it; reset when food is lost.
	 */
	navAim: Vec | null
	/**
	 * Opt C: cached wall-clearance rays [left, right, up, down] from the last recompute,
	 * reused for CLEARANCE_REFRESH_TICKS ticks before being recast (staggered by id). null
	 * until the first recompute. Clearance changes slowly (a fish moves a few px/tick), so
	 * reusing it for a few frames is invisible but quarters the per-tick ray-casts.
	 */
	clearance: [number, number, number, number] | null
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
	/**
	 * Every native geo member's id, so the swim loop can read each one's CURRENT color
	 * per tick and pick out the FOOD (green ones). Kept as ids — not pre-filtered to the
	 * green ones — because a food's color changes at runtime (it turns black when eaten),
	 * and the cluster cache only re-resolves on a membership miss. Reading the live color
	 * each tick (a cheap getShape) means "eaten → no longer attracts" takes effect at once.
	 */
	memberIds: TLShapeId[]
	/**
	 * NAVIGATION GRAPH over the rooms (boxes), so a creature can find a PATH to food in
	 * another room instead of swimming straight at it and grinding into the wall between.
	 * Rooms are the box indices; two rooms are adjacent when their boxes OVERLAP with a
	 * positive-area intersection — a real doorway the body can swim through (mere abutting,
	 * which makes a cluster but not a passage, does NOT connect them here). Each adjacency
	 * stores the DOORWAY point: the centre of the overlap rectangle, a point guaranteed
	 * inside both rooms and thus a safe waypoint. The creature steers toward the doorway
	 * leading to the next room on the BFS path, room by room, until it shares the food's
	 * room — then it aims at the food directly. Built once per cluster resolve (boxes don't
	 * move between resolves), so the per-tick nav is just a small BFS + lookup.
	 */
	adj: number[][] // adj[i] = indices of rooms reachable from room i
	doorways: Map<number, Box> // key = i * boxes.length + j → overlap RECT between rooms i,j
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
		/** DEV: mirror of swimDebugEnabled, so the overlay can be flipped from the console. */
		__SWIM_DEBUG?: boolean
		/** DEV: per-optimization toggles, mirror of swimOpts (see below). */
		__SWIM_OPTS?: Partial<SwimOpts>
	}
}

// ── PER-OPTIMIZATION TOGGLES (for A/B/C/D performance measurement) ──────────────
/**
 * Four independently-switchable swim-loop optimizations, so the stress harness can
 * measure how much EACH one contributes (flip one flag at a time). All default ON; the
 * "Stress test (swim opts …)" menu item flips them and prints a side-by-side table.
 *
 * MEASURED RESULT (500 fish, ONE static tank — the common case): the whole spread from
 * baseline to all-on was only ~1.3ms of a ~30ms frame (~4%). A/B/C each landed BELOW the
 * run-to-run noise floor (their sign flipped between runs); D was the only consistent win
 * (~1ms, and the only one that improved worst-5%). The dominant ~17ms swim cost is NOT
 * hit-testing OR write batching — it's the store/reactive machinery reacting to N moving
 * shapes each tick (inherent to the sync-for-free architecture). So these are kept as
 * FUTURE-PROOFING, not proven wins: A is a clean native-API swap; B/C are expected to pay
 * off in MULTI-ROOM / many-geo tanks (which a single rectangle doesn't exercise) and in
 * cache-miss-heavy scenarios (creatures crossing tanks); re-measure with the harness there.
 *
 *   useSpatialIndex   — A: resolve the tank under a creature via tldraw's native R-tree
 *                          (editor.getShapeIdsInsideBounds) instead of getShapeAtPoint,
 *                          which additionally z-sorts/masks/label-tests every page shape.
 *   useSharedClusters — B: build the connected-component tank CLUSTERS once per geo-topology
 *                          change (shared by every creature) instead of each creature
 *                          re-running the O(geo²) flood-fill on its own cache miss.
 *   amortizeClearance — C: cache each creature's 4 wall-clearance rays in its SwimState and
 *                          recompute them only every Nth tick, STAGGERED by id, instead of
 *                          casting all four every tick.
 *   batchWrites       — D: collect every creature's new position into ONE editor.updateShapes
 *                          call per tick, instead of a per-creature editor.updateShape (each
 *                          of which opens its own transaction + emits + single-record store
 *                          .put). The only consistent win measured (~1ms / improved worst-5%);
 *                          smaller than expected because the store.put of N records still
 *                          drives the downstream reactive cost that dominates either way.
 */
export type SwimOpts = {
	useSpatialIndex: boolean
	useSharedClusters: boolean
	amortizeClearance: boolean
	batchWrites: boolean
}

/** The LIVE flags. Mutated in place by setSwimOpts so the running loop picks changes up
 *  immediately (the tick closure reads this object every frame). */
const swimOpts: SwimOpts = {
	useSpatialIndex: true,
	useSharedClusters: true,
	amortizeClearance: true,
	batchWrites: true,
}

/** Set one or more optimization flags (used by the stress harness + the console mirror).
 *  Pass a partial; unspecified flags keep their current value. Returns the new full set. */
export function setSwimOpts(opts: Partial<SwimOpts>): SwimOpts {
	Object.assign(swimOpts, opts)
	if (typeof window !== 'undefined') window.__SWIM_OPTS = { ...swimOpts }
	return { ...swimOpts }
}

/** Read the current flags (the stress harness restores them after a run). */
export function getSwimOpts(): SwimOpts {
	return { ...swimOpts }
}

/**
 * Opt C tuning: how many ticks a creature reuses its cached wall-clearance before
 * recomputing. The recompute is STAGGERED by id (each creature recomputes on a
 * different tick) so the cost spreads evenly instead of spiking on one frame. Higher =
 * cheaper but staler avoidance; 4 keeps walls responsive at ~60fps (recompute ~15×/s)
 * while quartering the ray-casts. Clearance changes slowly (a fish moves a few px/tick),
 * so a few ticks of staleness is invisible.
 */
const CLEARANCE_REFRESH_TICKS = 4

// ── DEBUG OVERLAY plumbing ─────────────────────────────────────────────────────
/**
 * Per-creature snapshot the SwimDebugOverlay draws, all in PAGE space (the overlay
 * converts to screen with the camera). Published reactively from the swim loop each
 * tick — but ONLY while debug is enabled, so it costs nothing in the normal path.
 *   center  — the body centre we integrate on.
 *   heading — current travel direction (radians); drawn as a ray from the centre.
 *   boxes   — the tank cluster's member AABBs (as [minX,minY,w,h]); drawn as outlines.
 *   food    — the centre of the food this creature is currently hunting (if any).
 *   waypoint— the actual point it's steering toward right now: the food itself when in the
 *             same room, or the next DOORWAY on the path through rooms. Drawn as the link,
 *             so you can SEE it routing toward the opening rather than straight at the food.
 */
export type SwimDebugCreature = {
	id: TLShapeId
	center: { x: number; y: number }
	heading: number
	boxes: { x: number; y: number; w: number; h: number }[]
	food: { x: number; y: number } | null
	waypoint: { x: number; y: number } | null
}

/**
 * Whether the debug overlay is active. A tldraw `atom` so the menu toggle, the swim
 * loop, and the overlay all share ONE reactive source (same pattern as creatureClock).
 * Off by default; the loop only publishes snapshots while this is true.
 */
export const swimDebugEnabled = atom('swimDebugEnabled', false)

/** The latest debug snapshot (one entry per creature). Read by SwimDebugOverlay via useValue. */
export const swimDebug = atom<SwimDebugCreature[]>('swimDebug', [])

/** Flip the overlay on/off (used by the DEV menu item); also mirrors window.__SWIM_DEBUG. */
export function setSwimDebug(on: boolean): void {
	swimDebugEnabled.set(on)
	if (typeof window !== 'undefined') window.__SWIM_DEBUG = on
	if (!on) swimDebug.set([]) // clear so the overlay paints nothing once disabled
}

export function registerSwimming(editor: Editor): () => void {
	let busy = false
	const state = new Map<TLShapeId, SwimState>()
	// Time (ms) accumulated since we last WROTE positions. We integrate over the
	// whole accumulated dt in one write, then reset — so throttling the write rate
	// down (for big fleets) doesn't slow the swim, it just makes it coarser.
	let sinceWrite = 0
	// Monotonic tick counter — drives opt C's staggered clearance refresh (each creature
	// recomputes its rays when (tick + idHash) % CLEARANCE_REFRESH_TICKS === 0).
	let tickNo = 0
	// Opt B: the SHARED cluster cache. Built once per geo-topology change and reused by
	// every creature, instead of each creature flood-filling on its own miss. Lives for
	// the loop's lifetime; self-invalidates when the geo shapes' ids/bounds change.
	const clusterCache = new ClusterCache()

	const onTick = (elapsedMs: number) => {
		if (busy || elapsedMs <= 0) return
		if (typeof window !== 'undefined' && window.__SWIM_OFF) return // profiling: render-only
		// DEV: let the console flip optimization flags via window.__SWIM_OPTS (mirrors setSwimOpts).
		if (typeof window !== 'undefined' && window.__SWIM_OPTS) Object.assign(swimOpts, window.__SWIM_OPTS)
		tickNo++
		// Never integrate while the pointer is down — writing positions under a live
		// drag breaks hit-testing and the pointer-up release (same gate as physics).
		if (editor.inputs.getIsPointing()) return

		// Only the elected lead client drives motion (avoids clients fighting over
		// the synced x/y). Checked once per tick — it's a per-page election, not
		// per creature.
		if (!ownsSwimmingLead(editor)) return

		const creatures = editor
			.getCurrentPageShapes()
			.filter((s): s is SwimmableShape => SWIMMABLE_TYPES.has(s.type))
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

		// DEBUG: collect a per-creature snapshot for the overlay, but only while it's
		// enabled (atom set by the menu toggle, or the window mirror from the console).
		// NOTE: only the elected LEAD client reaches here, so the overlay visualizes the
		// driver's live state — exactly the client whose steering decisions matter.
		const debugOn =
			swimDebugEnabled.get() || (typeof window !== 'undefined' && !!window.__SWIM_DEBUG)
		const snapshot: SwimDebugCreature[] = []
		// Opt D: collect every creature's position partial and write them in ONE updateShapes
		// after the loop (one transaction/emit/store.put instead of N). When opt D is off,
		// swimOne writes inline and returns partial:null, so this stays empty.
		const partials: TLShapePartial[] = []

		busy = true
		try {
			editor.run(
				() => {
					for (const creature of creatures) {
						const step = swimOne(editor, creature, state, dt, debugOn, tickNo, clusterCache)
						if (step.partial) partials.push(step.partial)
						if (debugOn && step.snapshot) snapshot.push(step.snapshot)
					}
					if (partials.length > 0) editor.updateShapes(partials)
				},
				{ history: 'ignore' }
			)
		} finally {
			busy = false
		}
		if (debugOn) swimDebug.set(snapshot)

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

/**
 * Move one creature one tick within its tank (or leave it still if tankless). When
 * `debug` is set, returns a snapshot for the overlay (heading/cluster/food target);
 * otherwise returns null. Returning null also covers the early-outs (no tank etc.).
 */
/**
 * The result of stepping one creature: its new position PARTIAL (to be written — batched
 * by the caller, or already written inline when opt D is off, in which case partial is
 * null), plus the optional debug snapshot. Either field may be null (no tank → no move).
 */
type SwimStep = { partial: TLShapePartial | null; snapshot: SwimDebugCreature | null }

function swimOne(
	editor: Editor,
	creature: SwimmableShape,
	all: Map<TLShapeId, SwimState>,
	dt: number,
	debug: boolean,
	tickNo: number,
	clusterCache: ClusterCache
): SwimStep {
	const bounds = editor.getShapePageBounds(creature.id)
	if (!bounds) return EMPTY_STEP

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
			turnRate: 0, // starts not turning; eases up as steering demands
			wander: creature.props.seed * 10,
			cx: bounds.center.x,
			cy: bounds.center.y,
			speed: 0, // eases up from rest on the first strokes
			tank: null,
			navNextRoom: null,
			navAim: null,
			clearance: null,
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
			s.turnRate = 0 // start fresh from the placed angle, not mid-turn
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
		// Opt B: get the cluster from the SHARED cache (built once per topology change) —
		// find the geo under the centre, then look up its precomputed connected component.
		// Opt OFF: each creature flood-fills on its own miss (the original resolveCluster).
		const found = swimOpts.useSharedClusters
			? clusterCache.clusterFor(editor, creature.id)
			: resolveCluster(editor, creature.id)
		if (!found) {
			// Left every tank → drop the cache and stop roaming (still undulates).
			s.tank = null
			return EMPTY_STEP
		}
		s.tank = found
		tank = found
	}
	if (!tank) return EMPTY_STEP // not in a tank → no roaming (it still undulates in place)

	// Remember the heading BEFORE this tick's steering so we can cap the total turn (below).
	// All of meander + food + wall-avoidance adjust s.heading; the cap is applied once, to
	// their combined effect, so no single step can spin the body instantly.
	const prevHeading = s.heading

	// Meander: nudge the heading by a smooth, slowly-varying amount. Using the
	// wander phase (advanced each tick) keeps turns gentle and frame-rate-stable.
	s.wander += dt * 0.002
	s.heading += Math.sin(s.wander) * TURN_RATE * dt

	// FOOD ATTRACTION + EATING. Steer the heading toward the nearest food (via a routed
	// waypoint) and eat it on contact. Runs BEFORE wall-avoidance so a food tucked against
	// a wall never wins over staying in the tank — avoidance gets the last word below.
	const { food, waypoint } = steerTowardFood(editor, tank, s, creature, dt)

	// WALL AVOIDANCE (not bounce): nudge the heading toward the tank interior as the body
	// nears an OUTER wall, so it curves away before contact. Runs AFTER food steering.
	// Opt C: recompute the 4 clearance rays only every CLEARANCE_REFRESH_TICKS ticks,
	// STAGGERED by id (so the cost spreads across frames, not all on one); reuse the cache
	// otherwise. When the opt is off, recompute every tick (the original behaviour).
	const refresh =
		!swimOpts.amortizeClearance ||
		s.clearance === null ||
		(tickNo + idStagger(creature.id)) % CLEARANCE_REFRESH_TICKS === 0
	steerFromWalls(tank, s, dt, refresh)

	// SMOOTH THE TURN — speed cap PLUS acceleration limit. The steppers above mutated s.heading
	// into the DESIRED heading; treat the net change as the turn the steering wants this tick.
	//   1) Desired angular velocity = shortest(desired − prev) / dt, clamped to ±MAX_TURN_SPEED.
	//   2) Ease the actual rate (s.turnRate) toward that desired rate (TURN_ACCEL) — so the body
	//      ramps into and out of turns instead of snapping to a constant rate when a target
	//      switches. This S-curve is what finally kills the "sudden turn" on a waypoint flip.
	//   3) Apply the eased rate to prev → the new heading.
	let desiredTurn = s.heading - prevHeading
	desiredTurn = Math.atan2(Math.sin(desiredTurn), Math.cos(desiredTurn)) // shortest signed delta
	const desiredRate = clamp(dt > 0 ? desiredTurn / dt : 0, -MAX_TURN_SPEED, MAX_TURN_SPEED)
	s.turnRate += (desiredRate - s.turnRate) * Math.min(1, TURN_ACCEL * dt)
	s.heading = prevHeading + s.turnRate * dt

	// PROPULSION: modulate forward speed, read from the same clock+seed+speed the body
	// renders with — so the canvas surge lines up with the VISIBLE animation on every
	// client. The envelope is KIND-SPECIFIC:
	//   • jellyfish — the JET IMPULSE (jellyfishPropulsion): ≈0 while the tentacles
	//     reach out (it barely moves), spiking the instant they snap straight, then
	//     ramping down — so the shape lurches forward exactly when the body visibly
	//     jets. It surges from a dead glide (no GLIDE_FLOOR), pulse-and-coast.
	//   • everything else — the tail-beat thrust (two smooth power strokes/cycle) with
	//     a high GLIDE_FLOOR so a fish coasts between flicks instead of stalling.
	const kind = swimKind(creature)
	const isJelly = kind === 'jellyfish'
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
	// FACE THE HEADING (per-kind) — computed BEFORE confinement so the clamp can use the
	// body's ROTATED footprint. The body is drawn head-LEFT in local space (forward = −x), so
	// heading + π points the head along travel. A crab adds a 90° facingOffset so its SIDE
	// leads (sideways scuttle); a jellyfish is `upright` — it stays bell-up but leans by the
	// STROKE TILT (jellyTilt, computed above) so the bell points along its tilted jet.
	const face = FACING[kind] ?? FACING.fish
	const rotation = face.upright ? jellyTilt : s.heading + Math.PI + face.facingOffset

	// CONFINE to the cluster. The union of touching boxes is non-convex, so we can't clamp to
	// one AABB. confineToCluster projects the centre back inside whichever box it's in (or
	// nearest, when a step crossed a seam) — held inside the whole multi-room region but free
	// to pass between rooms. We inset by the body's ROTATED AABB half-extents, NOT the raw
	// w/2,h/2: a fish is wide and short, so when it's pointing DOWN a narrow vertical corridor
	// its true horizontal footprint is ~h/2, not w/2. Insetting by the un-rotated w/2 there
	// over-pushed it off both side walls every tick — a fight that jittered its position in the
	// corridor. The rotated AABB matches the body's actual span on each axis, so the clamp is
	// stable. half-extents of a w×h box rotated by θ: (|cosθ|w+|sinθ|h)/2, (|sinθ|w+|cosθ|h)/2.
	const cosR = Math.abs(Math.cos(rotation))
	const sinR = Math.abs(Math.sin(rotation))
	const halfX = (cosR * creature.props.w + sinR * creature.props.h) / 2
	const halfY = (sinR * creature.props.w + cosR * creature.props.h) / 2
	const confined = confineToCluster(tank, s.cx, s.cy, halfX, halfY)
	s.cx = confined.x
	s.cy = confined.y

	// Derive the top-left from the desired CENTRE + rotation in ONE write so position and
	// rotation never disagree. tldraw rotates about the top-left ORIGIN, so the centre→top-left
	// offset is (w/2, h/2) ROTATED by the angle.
	const half = new Vec(creature.props.w / 2, creature.props.h / 2).rot(rotation) // centre→top-left, rotated
	// Cast: both swimmable types are valid partials, but updateShape's wide overload can't
	// resolve against the union by `creature.type` alone (the repo's standard escape hatch).
	const partial = {
		id: creature.id,
		type: creature.type,
		x: s.cx - half.x,
		y: s.cy - half.y,
		rotation,
	} as TLShapePartial

	// Opt D: when batching is ON, the caller collects this partial and writes ALL creatures
	// in ONE editor.updateShapes (one transaction + emit + store.put, not N). When OFF, write
	// inline per-creature (the original path) and report it as already-written (partial: null).
	if (!swimOpts.batchWrites) {
		editor.updateShape(partial)
	}
	const partialOut = swimOpts.batchWrites ? partial : null

	// DEBUG snapshot (only built when the overlay is on): the post-step centre + heading,
	// the cluster boxes, and the current food target. All page-space; the overlay maps it.
	if (!debug) return { partial: partialOut, snapshot: null }
	return {
		partial: partialOut,
		snapshot: {
			id: creature.id,
			center: { x: s.cx, y: s.cy },
			heading: s.heading,
			boxes: tank.boxes.map((b) => ({ x: b.minX, y: b.minY, w: b.width, h: b.height })),
			food: food ? { x: food.box.center.x, y: food.box.center.y } : null,
			// Show the SMOOTHED aim (what the body actually steers at), not the raw step waypoint.
			waypoint: s.navAim ? { x: s.navAim.x, y: s.navAim.y } : waypoint ? { x: waypoint.x, y: waypoint.y } : null,
		},
	}
}

/** A no-op step (no move, no snapshot) for swimOne's early-outs. */
const EMPTY_STEP: SwimStep = { partial: null, snapshot: null }

function clamp(n: number, lo: number, hi: number): number {
	return n < lo ? lo : n > hi ? hi : n
}

/**
 * FOOD ATTRACTION + EATING — nudges s.heading toward the nearest food and eats it on contact.
 * Returns the food it's hunting and the raw nav waypoint (both for the debug overlay; null when
 * there's no food in reach). Green geo shapes in the cluster are FOOD: we read live colors each
 * tick (nearestFood → getShape), so the moment one is eaten — turned black — the fleet retargets.
 *
 * The point we actually steer toward is a routed WAYPOINT, not the food itself: when the food is
 * in another room, steering straight at it drives the body into the wall between (it can't see
 * the doorway). navWaypoint routes through the room graph and returns the next doorway on the way.
 * That raw waypoint is a STEP function (it jumps when the plan advances), so we steer toward a
 * SMOOTHED aim (s.navAim) eased toward it — the desired heading then sweeps continuously and the
 * turn rounds the corner instead of pivoting. (A jellyfish drifts by its own jet, not its heading,
 * so attraction barely moves it — but it still eats on contact.)
 */
function steerTowardFood(
	editor: Editor,
	tank: Cluster,
	s: SwimState,
	creature: SwimmableShape,
	dt: number
): { food: { id: TLShapeId; box: Box } | undefined; waypoint: Vec | null } {
	const food = nearestFood(editor, tank, s.cx, s.cy)
	if (!food) {
		// No food in reach → drop the route commitment AND the smoothed aim so the next hunt
		// re-plans fresh and the aim doesn't lerp from a stale point.
		s.navNextRoom = null
		s.navAim = null
		return { food, waypoint: null }
	}

	// "Deep inside the next room" is measured with a small inset so the plan only advances once
	// the body has truly cleared the doorway — half the smaller body extent, the natural scale
	// for "past the threshold" without being so large a small room fails it.
	const bodyInset = Math.min(creature.props.w, creature.props.h) / 2
	const waypoint = navWaypoint(tank, s, s.cx, s.cy, food.box.center, bodyInset)

	// EASE a smoothed aim point toward the raw waypoint, then steer at the SMOOTHED point. Snap
	// the aim straight to the waypoint on the first tick (no prior aim) so it starts correct.
	if (!s.navAim) s.navAim = new Vec(waypoint.x, waypoint.y)
	else {
		const k = Math.min(1, AIM_EASE * dt)
		s.navAim = new Vec(s.navAim.x + (waypoint.x - s.navAim.x) * k, s.navAim.y + (waypoint.y - s.navAim.y) * k)
	}

	// Steer the heading toward the smoothed aim, scaled like wall-avoidance — but FADE the
	// strength out as the aim comes within MIN_AIM_DIST, where the bearing to it gets
	// numerically unstable (a near point swings its angle fast). The fade lets the fish coast
	// straight through a close aim instead of jerking toward a whipping bearing.
	const aimDist = Math.hypot(s.navAim.x - s.cx, s.navAim.y - s.cy)
	const nearFade = Math.min(1, aimDist / MIN_AIM_DIST) // 0 at the body → 1 past the radius
	const want = Math.atan2(s.navAim.y - s.cy, s.navAim.x - s.cx)
	let diff = want - s.heading
	diff = Math.atan2(Math.sin(diff), Math.cos(diff)) // shortest angular path
	s.heading += diff * Math.min(1, FOOD_ATTRACT_RATE * dt) * nearFade

	// EAT on contact: once the centre is within EAT_SLACK of the food box, mark it eaten
	// (color → black). This is a normal store write, already inside the loop's editor.run(...,
	// { history: 'ignore' }) so it syncs to every client. A color change doesn't move the box,
	// so the cached cluster stays valid.
	if (food.box.containsPoint(new Vec(s.cx, s.cy), EAT_SLACK)) {
		editor.updateShape({ id: food.id, type: 'geo', props: { color: EATEN_COLOR } })
	}

	return { food, waypoint }
}

/**
 * WALL AVOIDANCE (not bounce) — nudges s.heading toward the tank interior as the body's centre
 * nears an OUTER wall, gently within the margin and more firmly the closer it gets, so the
 * creature curves away before reaching the edge.
 *
 * CLUSTER-AWARE: it steers away from the OUTER boundary of the whole connected region, never
 * from a seam where two rooms meet. The earlier "pick one home box and skip walls touching a
 * neighbour" approach mis-fired in the overlap zone — it treated a real outer wall as open
 * (because the *other* box sat past it on a different side) and suppressed the steering, so the
 * creature ran into the wall and got hard-clamped ("hits and stops"). Instead we measure, in
 * each of the four directions, how far the centre can travel before leaving the UNION of rooms
 * (clusterClearance). A seam contributes a large clearance (the next room continues) → no push;
 * only a true outer edge is near → only it steers. Margin scales to the local room so rooms of
 * any size steer naturally.
 */
function steerFromWalls(tank: Cluster, s: SwimState, dt: number, refresh: boolean): void {
	const home = boxContaining(tank, s.cx, s.cy) ?? nearestBox(tank, s.cx, s.cy)
	const margin = Math.min(home.width, home.height) * AVOID_MARGIN
	if (margin <= 0) return

	// Opt C: recast the 4 rays only on a refresh tick; otherwise reuse the cached values.
	// The cache (s.clearance) is seeded on the first call (refresh is forced true then).
	if (refresh || s.clearance === null) {
		s.clearance = [
			clusterClearance(tank, s.cx, s.cy, -1, 0), // LEFT
			clusterClearance(tank, s.cx, s.cy, 1, 0), // RIGHT
			clusterClearance(tank, s.cx, s.cy, 0, -1), // UP
			clusterClearance(tank, s.cx, s.cy, 0, 1), // DOWN
		]
	}
	const [dxL, dxR, dyT, dyB] = s.clearance
	// Per axis, combine the two opposing walls into ONE smooth push (axisPush): a one-sided
	// shove when only one wall is near, a CENTERING force in a narrow corridor (both near) —
	// which has no sign-flip, so the heading isn't whipped between walls (the corridor "glitch").
	const ax = axisPush(dxL, dxR, margin)
	const ay = axisPush(dyT, dyB, margin)
	if (ax === 0 && ay === 0) return

	// Rotate `heading` toward the away-direction by an amount scaled to depth.
	const depth = Math.min(1, Math.hypot(ax, ay))
	const want = Math.atan2(ay, ax)
	let diff = want - s.heading
	diff = Math.atan2(Math.sin(diff), Math.cos(diff)) // shortest angular path
	s.heading += diff * Math.min(1, AVOID_RATE * dt * depth)
}

/**
 * Combine the two opposing wall clearances on ONE axis into a single avoidance push, in
 * [-1, 1]. `loClear` is the room toward the negative direction (left / up), `hiClear` toward
 * the positive (right / down); the result is positive to push in the POSITIVE direction
 * (toward the roomier side). Beyond `margin` a wall doesn't contribute.
 *
 *   • One side near  → the classic one-sided shove away from it (magnitude grows as it nears).
 *   • BOTH sides near (a narrow corridor) → a CENTERING force from the relative clearance:
 *       (hiClear − loClear) / margin, clamped — ZERO on the centreline and smoothly toward the
 *       roomier wall. This is the fix for the corridor glitch: summing two near-equal opposing
 *       shoves produced a tiny residual that flipped sign as the body wobbled, whipping the
 *       heading; a difference-based centering force has no such sign-flip and settles the body
 *       on the corridor's midline instead of bouncing it between the walls.
 */
function axisPush(loClear: number, hiClear: number, margin: number): number {
	const loNear = loClear < margin
	const hiNear = hiClear < margin
	if (loNear && hiNear) {
		// Narrow passage: centre smoothly between the two walls.
		return clamp((hiClear - loClear) / margin, -1, 1)
	}
	if (loNear) return 1 - loClear / margin // wall on the negative side → push positive
	if (hiNear) return -(1 - hiClear / margin) // wall on the positive side → push negative
	return 0
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
	const found = geoUnderPoint(editor, bounds.center)
	if (!found) return undefined
	return { id: found.id, bounds: found.bounds }
}

/**
 * The native geo shape whose page-space AABB contains `point` (the innermost/smallest
 * such, so a creature inside a small room nested in a big one picks the room). Opt A:
 * when useSpatialIndex is on, query tldraw's native R-tree (getShapeIdsInsideBounds)
 * for the few candidates overlapping the point, then keep the geos that truly contain it
 * — far cheaper than getShapeAtPoint, which additionally z-sorts every page shape and
 * runs label/mask/hollow-area logic we don't need. Opt OFF: the original getShapeAtPoint.
 *
 * Both paths agree on the result: "the geo box under this point". We pick the SMALLEST
 * area on a tie so nesting resolves to the tightest enclosing tank (getShapeAtPoint's
 * hollow-area tiebreak does the same), keeping behaviour identical with the opt on or off.
 */
function geoUnderPoint(editor: Editor, point: { x: number; y: number }): { id: TLShapeId; bounds: Box } | undefined {
	if (!swimOpts.useSpatialIndex) {
		const tank = editor.getShapeAtPoint(point, { filter: (s) => s.type === 'geo', hitInside: true })
		if (!tank) return undefined
		const tankBounds = editor.getShapePageBounds(tank.id)
		return tankBounds ? { id: tank.id, bounds: tankBounds } : undefined
	}
	// R-tree: a zero-size box at the point returns every shape whose AABB overlaps it.
	const candidateIds = editor.getShapeIdsInsideBounds(new Box(point.x, point.y, 0, 0))
	let best: { id: TLShapeId; bounds: Box } | undefined
	let bestArea = Infinity
	for (const cid of candidateIds) {
		const shape = editor.getShape(cid)
		if (!shape || shape.type !== 'geo') continue
		const b = editor.getShapePageBounds(cid)
		if (!b || !b.containsPoint(point)) continue // AABB overlap → confirm true contains
		const area = b.width * b.height
		if (area < bestArea) {
			bestArea = area
			best = { id: cid, bounds: b }
		}
	}
	return best
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
	return buildClusterFromSeed(seed.id, seed.bounds, collectGeos(editor))
}

/** Collect every native geo shape on the page with its page-space AABB. The one O(N)
 *  sweep both the per-creature resolveCluster and the shared ClusterCache build on. */
function collectGeos(editor: Editor): { id: TLShapeId; box: Box }[] {
	const geos: { id: TLShapeId; box: Box }[] = []
	for (const shape of editor.getCurrentPageShapes()) {
		if (shape.type !== 'geo') continue
		const box = editor.getShapePageBounds(shape.id)
		if (box) geos.push({ id: shape.id, box })
	}
	return geos
}

/**
 * Flood-fill the connected component of touching geo boxes reachable from `seedId`, then
 * build its Cluster (boxes, union AABB, member ids, room nav-graph). Pure over the given
 * `geos` snapshot — shared by resolveCluster (per-creature) and ClusterCache (build-all),
 * so both produce byte-identical clusters; only WHEN/HOW OFTEN it runs differs.
 */
function buildClusterFromSeed(seedId: TLShapeId, seedBounds: Box, geos: { id: TLShapeId; box: Box }[]): Cluster {
	const boxes: Box[] = [seedBounds]
	const memberIds: TLShapeId[] = [seedId]
	const visited = new Set<TLShapeId>([seedId])
	const frontier: Box[] = [seedBounds]
	while (frontier.length > 0) {
		const cur = frontier.pop()!
		for (const g of geos) {
			if (visited.has(g.id)) continue
			if (boxesTouch(cur, g.box)) {
				visited.add(g.id)
				memberIds.push(g.id)
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

	// NAVIGATION GRAPH: connect rooms whose boxes OVERLAP (positive-area intersection — a
	// passage the body can swim through), and record the doorway (overlap-rect centre) for
	// each connection. Built once here; the per-tick path is a tiny BFS over `adj`.
	const { adj, doorways } = buildRoomGraph(boxes)

	return { seedId, boxes, union, memberIds, adj, doorways }
}

/**
 * Opt B: the SHARED tank-cluster cache. Partitions ALL the page's geo shapes into their
 * connected components (clusters) ONCE per geo-topology change, and indexes every member
 * geo id → its cluster. So when N creatures share one tank, the O(geo²) flood-fill runs
 * ONCE for the whole page on a topology change — not once per creature per cache-miss.
 *
 * Invalidation is by a cheap TOPOLOGY SIGNATURE (sorted "id:minX,minY,w,h" of every geo):
 * if a geo is added/removed/moved/resized the signature changes and we rebuild; otherwise
 * the cached clusters are reused across ticks. Creatures moving does NOT invalidate it
 * (only geo shapes form tanks), so in the steady state of "many fish in a static tank"
 * this rebuilds ~never. This is the boids "shared neighbour list" idea: the walls are the
 * neighbours, they change far less than the swimmers, so compute them once and share.
 */
class ClusterCache {
	private sig = ''
	private byGeoId = new Map<TLShapeId, Cluster>()

	/** The cluster a creature lives in: find the geo under its centre (opt A's lookup),
	 *  then return that geo's precomputed connected component. Rebuilds all clusters first
	 *  iff the geo topology changed since the last build. */
	clusterFor(editor: Editor, creatureId: TLShapeId): Cluster | undefined {
		const seed = tankUnderWithId(editor, creatureId)
		if (!seed) return undefined
		this.ensureBuilt(editor)
		return this.byGeoId.get(seed.id)
	}

	/** Rebuild the cluster partition iff the geo topology signature changed. */
	private ensureBuilt(editor: Editor): void {
		const geos = collectGeos(editor)
		const sig = topologySignature(geos)
		if (sig === this.sig && this.byGeoId.size > 0) return // unchanged → reuse
		this.sig = sig
		this.byGeoId.clear()
		// Partition every geo into connected components; each unvisited geo seeds a cluster
		// whose every member is then indexed to it (so any member id resolves O(1)).
		const assigned = new Set<TLShapeId>()
		for (const g of geos) {
			if (assigned.has(g.id)) continue
			const cluster = buildClusterFromSeed(g.id, g.box, geos)
			for (const memberId of cluster.memberIds) {
				assigned.add(memberId)
				this.byGeoId.set(memberId, cluster)
			}
		}
	}
}

/** A stable signature of the geo topology: sorted "id:minX,minY,w,h" of every geo box.
 *  Changes iff a geo is added/removed/moved/resized → the only events that alter tanks. */
function topologySignature(geos: { id: TLShapeId; box: Box }[]): string {
	return geos
		.map((g) => `${g.id}:${g.box.minX | 0},${g.box.minY | 0},${g.box.width | 0},${g.box.height | 0}`)
		.sort()
		.join('|')
}

/** A small per-id offset in [0, CLEARANCE_REFRESH_TICKS) so creatures recompute their
 *  wall-clearance on DIFFERENT ticks (opt C), spreading the cost instead of spiking it
 *  on one frame. Deterministic hash of the shape id string. */
function idStagger(id: TLShapeId): number {
	let h = 0
	for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
	return Math.abs(h) % CLEARANCE_REFRESH_TICKS
}

/**
 * Build the room adjacency graph + doorways for a cluster's boxes. Two rooms are linked
 * when their boxes share a POSITIVE-AREA overlap — a real opening the creature can pass
 * through (boxes that merely abut within TOUCH_SLACK make one cluster but have no interior
 * passage, so they are NOT linked here; navigating "through" a hairline seam would mean
 * threading a zero-width gap). The doorway for a link stores the overlap RECTANGLE (not just
 * its centre) so navigation can both aim at the opening AND tell when the creature is inside
 * it (time to aim into the next room). The overlap rect is inside both rooms throughout.
 */
function buildRoomGraph(boxes: Box[]): { adj: number[][]; doorways: Map<number, Box> } {
	const n = boxes.length
	const adj: number[][] = Array.from({ length: n }, () => [])
	const doorways = new Map<number, Box>()
	for (let i = 0; i < n; i++) {
		for (let j = i + 1; j < n; j++) {
			const a = boxes[i]
			const b = boxes[j]
			// Overlap rectangle (empty if they only abut / are disjoint).
			const oxMin = Math.max(a.minX, b.minX)
			const oxMax = Math.min(a.maxX, b.maxX)
			const oyMin = Math.max(a.minY, b.minY)
			const oyMax = Math.min(a.maxY, b.maxY)
			if (oxMax - oxMin <= 0 || oyMax - oyMin <= 0) continue // no passable opening
			const overlap = new Box(oxMin, oyMin, oxMax - oxMin, oyMax - oyMin)
			adj[i].push(j)
			adj[j].push(i)
			doorways.set(i * n + j, overlap)
			doorways.set(j * n + i, overlap)
		}
	}
	return { adj, doorways }
}

/**
 * The room (box index) a point (x, y) belongs to. In an OVERLAP zone the point is inside
 * several boxes at once, so picking "the first box that contains it" classifies the same
 * spot inconsistently and makes the nav target flip-flop at a doorway (the stuck-at-doorway
 * bug). Instead we pick the box the point is DEEPEST inside — the one whose nearest wall is
 * furthest away — so a creature sitting in the overlap is firmly assigned to whichever room
 * it's more inside of, and the assignment changes smoothly as it crosses. Falls back to the
 * nearest box centre when the point is in a gap between boxes.
 */
function roomIndexAt(cluster: Cluster, x: number, y: number): number {
	let best = -1
	let bestDepth = 0 // max over containing boxes of the distance to that box's nearest wall
	for (let i = 0; i < cluster.boxes.length; i++) {
		const b = cluster.boxes[i]
		if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) continue
		const depth = Math.min(x - b.minX, b.maxX - x, y - b.minY, b.maxY - y)
		if (best === -1 || depth > bestDepth) {
			bestDepth = depth
			best = i
		}
	}
	if (best !== -1) return best
	// Not inside any box (a gap) → nearest box centre.
	let nearest = 0
	let bestD = Infinity
	for (let i = 0; i < cluster.boxes.length; i++) {
		const c = cluster.boxes[i].center
		const d = (c.x - x) * (c.x - x) + (c.y - y) * (c.y - y)
		if (d < bestD) {
			bestD = d
			nearest = i
		}
	}
	return nearest
}

/**
 * BFS the room graph from `start` to `goal`, returning the path as a list of room indices
 * (inclusive of both ends), or null if unreachable. Rooms are few (a handful of boxes),
 * so plain BFS is ample and gives the fewest-doorways route.
 */
function roomPath(cluster: Cluster, start: number, goal: number): number[] | null {
	if (start === goal) return [start]
	const prev = new Map<number, number>()
	const seen = new Set<number>([start])
	const queue = [start]
	while (queue.length > 0) {
		const cur = queue.shift()!
		for (const next of cluster.adj[cur]) {
			if (seen.has(next)) continue
			seen.add(next)
			prev.set(next, cur)
			if (next === goal) {
				// Reconstruct the path goal → start, then reverse.
				const path = [goal]
				let p = goal
				while (p !== start) {
					p = prev.get(p)!
					path.push(p)
				}
				return path.reverse()
			}
			queue.push(next)
		}
	}
	return null // food's room not reachable through overlaps (only abutting seams between)
}

/**
 * Is (x, y) inside box `i`, and at least `inset` from all its walls? The "deep inside" test
 * the nav hysteresis uses to decide the creature has truly entered a room. The inset is CAPPED
 * to just under each half-extent, so even a room SMALLER than the body still has a reachable
 * deep zone near its centre — otherwise a big creature could commit to a small room and, never
 * counting as "deep inside", never advance its plan (a fresh kind of stuck).
 */
function deepInsideRoom(cluster: Cluster, i: number, x: number, y: number, inset: number): boolean {
	const b = cluster.boxes[i]
	const ix = Math.min(inset, b.width / 2 - 1)
	const iy = Math.min(inset, b.height / 2 - 1)
	return x >= b.minX + ix && x <= b.maxX - ix && y >= b.minY + iy && y <= b.maxY - iy
}

/**
 * The point a creature should STEER TOWARD to reach `target` (the food's centre) through the
 * rooms, with HYSTERESIS so the target stays stable while transiting a doorway. Without the
 * hysteresis, this re-ran a fresh BFS off `roomIndexAt` every tick — and in a NARROW doorway
 * the centre is near-equally deep in both rooms, so `roomIndexAt` oscillates and the target
 * teleported between unrelated points each tick (the "glitches in a narrow space" symptom).
 *
 * Stable scheme, using s.navNextRoom (the committed room we're crossing into):
 *   • Same room as the goal → clear the commitment, aim at the food directly.
 *   • If we hold a commitment and haven't yet arrived DEEP inside that room, KEEP it: aim at
 *     its doorway (approach) or its centre (once within the overlap) — no re-plan, so a thin
 *     overlap can't flip the target. We only re-plan once firmly inside the committed room.
 *   • Otherwise (no/!reached commitment) plan a fresh BFS and commit to path[1].
 * The DEEP-inside test (inset by the body half-size) is the key: it ignores the overlap-zone
 * jitter and only advances the plan when the creature has truly entered the next room.
 */
function navWaypoint(cluster: Cluster, s: SwimState, x: number, y: number, target: Vec, bodyInset: number): Vec {
	const goal = roomIndexAt(cluster, target.x, target.y)

	// In the food's room (anywhere inside its box) → done routing; aim straight at the food.
	if (deepInsideRoom(cluster, goal, x, y, 0)) {
		s.navNextRoom = null
		return target
	}

	const N = cluster.boxes.length

	// Keep an existing commitment until we're firmly inside that room (immune to doorway jitter).
	if (s.navNextRoom !== null && s.navNextRoom < N) {
		const committed = s.navNextRoom
		if (!deepInsideRoom(cluster, committed, x, y, bodyInset)) {
			// Still en route to the committed room: steer through the doorway between whatever
			// room we're physically in and the committed one (no re-plan, so a thin overlap
			// can't flip the target).
			return aimThroughDoor(cluster, roomIndexAt(cluster, x, y), committed, x, y)
		}
		// Arrived deep inside the committed room → fall through to re-plan the NEXT hop from here.
	}

	// Plan a fresh route from the room we're firmly in and commit to the next hop.
	const start = roomIndexAt(cluster, x, y)
	const path = roomPath(cluster, start, goal)
	if (!path || path.length < 2) {
		s.navNextRoom = null
		return target // unreachable → fall back to direct
	}
	const next = path[1]
	s.navNextRoom = next
	return aimThroughDoor(cluster, start, next, x, y)
}

/**
 * The point to STEER TOWARD to cross from `from` into the adjacent `to` room: aim at the
 * doorway opening while approaching it, then at the next room's centre once the body is
 * inside the overlap (so it commits through rather than hugging the threshold). Falls back
 * to the next room's centre if the two rooms have no recorded doorway (shouldn't happen on
 * a planned hop, but keeps the nav total). Clamping (x,y) into the doorway rect gives the
 * nearest point of the opening, so a creature off to one side aims at the part it can reach.
 */
function aimThroughDoor(cluster: Cluster, from: number, to: number, x: number, y: number): Vec {
	const N = cluster.boxes.length
	const door = cluster.doorways.get(from * N + to) ?? cluster.doorways.get(to * N + from)
	if (!door) return cluster.boxes[to].center
	const inDoorway = x >= door.minX && x <= door.maxX && y >= door.minY && y <= door.maxY
	if (inDoorway) return cluster.boxes[to].center
	return new Vec(clamp(x, door.minX, door.maxX), clamp(y, door.minY, door.maxY))
}

/**
 * The nearest FOOD shape in the cluster to (x, y), if any. Food = a member geo shape
 * whose CURRENT color is green (FOOD_COLORS). We read each member's live color here (not
 * from the cached cluster) so a food that was just eaten — turned black — instantly stops
 * counting. Returns the food's id + page-space box, so the caller can both steer toward
 * its centre and detect a bite against its box.
 */
function nearestFood(
	editor: Editor,
	cluster: Cluster,
	x: number,
	y: number
): { id: TLShapeId; box: Box } | undefined {
	let best: { id: TLShapeId; box: Box } | undefined
	let bestD = Infinity
	for (const id of cluster.memberIds) {
		const shape = editor.getShape(id)
		// A member can vanish (deleted) or stop being food (eaten → black); skip both.
		if (!shape || shape.type !== 'geo') continue
		if (!FOOD_COLORS.has((shape.props as { color?: string }).color ?? '')) continue
		const box = editor.getShapePageBounds(id)
		if (!box) continue
		const dx = box.center.x - x
		const dy = box.center.y - y
		const d = dx * dx + dy * dy
		if (d < bestD) {
			bestD = d
			best = { id, box }
		}
	}
	return best
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
