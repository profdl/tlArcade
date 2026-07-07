// The Green-Hill-like starter course — the Sonic template (PLAN §5.5): FROZEN
// data laid down as ordinary native tldraw shapes, no custom records. It's the
// clearest demo of "author data → the runtime plays it": every piece here is a
// shape the user can then drag, recolor, or delete. Built entirely from the
// primitives the sled sim already plays — colored lines (color → LineKind:
// solid / accelerate / bounce), note shapes as rings, a frame as the goal.
//
// Everything is authored RELATIVE to the run start point, and sits ON the
// side-mode ground plane (sideGroundY(start)) so the auto-running character meets
// it. Coordinates read left-to-right as the level: rolling hills to build speed,
// speed boosters, a loop the momentum sim carries you around, an angled spring,
// then the goal. Curves are native multi-point `line` shapes with spline:'cubic'
// (tldraw renders and getShapeGeometry samples them as smooth curves, which the
// collision extractor turns into segments) — no custom geometry.

import { createShapeId, getIndices, type Editor, type TLShapeId, type IndexKey } from 'tldraw'
import type { Segment, Vec2 } from './physics'
import { RING_COLOR } from './geometry'
import { sideGroundY } from './state'

// On-canvas diameter of a ring (geo ellipse), page px. Small enough to read as a
// Sonic ring you run through, big enough to be an easy catch target.
const RING_SIZE = 44

/** A tldraw v5 color name → a gameplay LineKind (see geometry.ts COLOR_TO_KIND).
 * blue = oneway (flip:false) — used for the LOOP so the runner passes through the
 * overhanging top from outside and rides the inside surface (see the loop notes). */
type TrackColor = 'black' | 'red' | 'yellow' | 'grey' | 'blue'

/** One authored track line: a polyline in course-local px (x right, y down), a
 * color (→ behavior), and whether tldraw should render/sample it as a smooth
 * cubic spline (curved hills, the loop) or straight segments. */
interface TrackLine {
	pts: Vec2[]
	color: TrackColor
	curved: boolean
}

/** A ring (collectible) at a course-local point. */
interface Ring {
	x: number
	y: number
}

// ── The course geometry, in course-local px relative to the start ──────────────
// x increases to the right (down-course); y increases DOWNWARD (screen convention,
// matching page space). y = 0 is the GROUND the character runs on — the same plane
// the side-mode auto-ground sits at (sideGroundY), so the course's flat parts
// coincide with it. Terrain only ever bumps UP (negative y): a dip below y=0 would
// duck under the flat auto-ground and be unreachable (the ground would cut across
// it). Tuned so the runner builds enough speed (sideThrust / sideCruiseSpeed) to
// carry the loop.

// Where the course begins, px ahead of the spawn, so the character has a moment of
// flat ground to accelerate before the first hill.
const COURSE_AHEAD = 320

// Rolling hills: a smooth cubic of gentle UP-only crests (never below y=0) that add
// undulation and a little air-time without breaking the flat ground. The runner
// keeps its speed over them (momentum) and they don't fight the auto-ground.
const HILLS: Vec2[] = [
	{ x: 0, y: 0 },
	{ x: 240, y: -28 }, // gentle crest
	{ x: 480, y: 0 }, // back to ground
	{ x: 720, y: -40 }, // slightly taller, still gentle
	{ x: 900, y: 0 }, // back to ground (into the booster)
]

// A red speed-booster stretch on the flat after the hills — the Sonic speed strip
// (accelerate lines push the sled along its tangent). It tops the runner up, but
// the REAL loop-entry speed comes from a long clean flat run: sideThrust plateaus
// around ~2800 px/s and the loop needs ~2300+ at entry, which takes roughly
// 1800px of clean running to build (measured against the real sim). So the loop is
// placed far enough right that the booster + the flat before it deliver that.
const BOOST_START = 950
const BOOST_END = 1250

// The loop: a full vertical circle the momentum sim carries the runner around.
// Drawn in BLUE = oneway (flip:false) so the runner passes through the overhanging
// top from OUTSIDE and rides the INSIDE surface — a closed SOLID circle is just a
// wall whose overhang blocks the approach (see physics.ts onLoopSegment + the
// loopProbe test). The loop's bottom sits on the ground (y=0) at LOOP_ENTRY_X,
// placed well down-course so the runner arrives at loop speed (~2300+).
const LOOP_ENTRY_X = 1900
const LOOP_R = 150

// After the loop, a run-up to an angled spring (a tilted yellow bounce line): bounce
// launches along the surface normal, so a line tilted ~35° from horizontal throws
// the runner up-and-forward — Sonic's diagonal spring.
const SPRING_X = 2500
const SPRING_LEN = 90
const SPRING_TILT_DEG = 35 // from horizontal; the launch is along the normal (up-forward)

// A final flat run to the goal after the spring's arc.
const GOAL_X = 3200

// Rings along the course (course-local; y negative = above the surface, where you
// run/jump through them). Kept at/above y=0 so none hides under the ground.
const RINGS: Ring[] = [
	{ x: 240, y: -58 }, // over the first crest
	{ x: 720, y: -70 }, // over the taller crest
	{ x: 1050, y: -40 }, // along the booster strip
	{ x: 1150, y: -40 },
	{ x: LOOP_ENTRY_X, y: -LOOP_R * 2 - 30 }, // at the top of the loop
	{ x: 2650, y: -160 }, // mid-air over the spring's arc
	{ x: 2950, y: -40 }, // on the run to the goal
]

/**
 * Build the loop as a full circle of points (course-local), traced from the BOTTOM
 * (on the ground at (entryX, 0)) up the +x side, over the top, and back down to the
 * bottom — the winding the one-way orientation (blue, flip:false) needs so each
 * segment blocks from the inside. Enough points that getShapeGeometry samples it as
 * a clean circle. Center one radius above the entry so the loop bottom is on y=0.
 */
function loopPoints(entryX: number, r: number): Vec2[] {
	const cx = entryX
	const cy = -r
	const pts: Vec2[] = []
	const N = 40
	// Start at the bottom (angle +90° from center = straight down) and sweep a FULL
	// turn the same way the loopProbe traces it (a = 90° - i·360°/N), so the winding
	// — and thus each one-way segment's blocking side — matches the proven probe.
	for (let i = 0; i <= N; i++) {
		const a = Math.PI / 2 - (i / N) * Math.PI * 2
		pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r })
	}
	return pts
}

/** All the track lines that make up the course, in draw order. The flat GROUND
 * itself is the side-mode auto-ground plane (RunController injects it at y=0), so
 * these are only the features ON that ground: hills, the booster strip, the loop,
 * and the spring. */
function courseLines(): TrackLine[] {
	const lines: TrackLine[] = []
	// Rolling UP-only hills (curved, solid) — never dip below the ground.
	lines.push({ pts: HILLS, color: 'black', curved: true })
	// Booster strip (straight, red = accelerate): the long run-up that gets the
	// runner to loop speed.
	lines.push({
		pts: [
			{ x: BOOST_START, y: 0 },
			{ x: BOOST_END, y: 0 },
		],
		color: 'red',
		curved: false,
	})
	// The loop (curved, BLUE = oneway flip:false so the runner rides the inside).
	lines.push({ pts: loopPoints(LOOP_ENTRY_X, LOOP_R), color: 'blue', curved: true })
	// The angled spring (yellow = bounce), tilted up-forward, after the loop.
	const rad = (SPRING_TILT_DEG * Math.PI) / 180
	lines.push({
		pts: [
			{ x: SPRING_X, y: 0 },
			{ x: SPRING_X + Math.cos(rad) * SPRING_LEN, y: -Math.sin(rad) * SPRING_LEN },
		],
		color: 'yellow',
		curved: false,
	})
	return lines
}

/**
 * Lay the whole Green-Hill course onto the canvas as native shapes, positioned
 * relative to `start`. All pieces sit on the side-mode ground plane. The
 * createShape calls are normal (undoable) edits — a template load is just a bunch
 * of authored shapes the user can then edit; only selection/camera would be
 * history:'ignore', which the caller handles. Returns the created shape ids.
 */
export function loadGreenHill(editor: Editor, start: Vec2): TLShapeId[] {
	const groundY = sideGroundY(start)
	const baseX = start.x + COURSE_AHEAD
	// Course-local (x,y) → page point. y is measured UP from the ground as negative
	// in the course data, and the ground is at groundY, so page y = groundY + localY.
	const toPage = (p: Vec2): Vec2 => ({ x: baseX + p.x, y: groundY + p.y })
	const ids: TLShapeId[] = []

	for (const line of courseLines()) {
		const id = createShapeId()
		ids.push(id)
		// A `line` shape stores its points LOCAL to the shape's (x,y). Anchor the
		// shape at the first point's page position and store the rest as offsets.
		const origin = toPage(line.pts[0])
		// A line's points are keyed by a VALID fractional IndexKey — NOT `a1,a2,…a10`
		// ("a10" is not a valid index key; the format is fractional-indexing, where
		// a9 < aA, not a9 < a10). getIndices(n) mints n ordered, valid keys.
		const indices = getIndices(line.pts.length)
		const points: Record<string, { id: string; index: IndexKey; x: number; y: number }> = {}
		line.pts.forEach((p, i) => {
			const pg = toPage(p)
			const index = indices[i]
			points[index] = { id: index, index, x: pg.x - origin.x, y: pg.y - origin.y }
		})
		editor.createShape({
			id,
			type: 'line',
			x: origin.x,
			y: origin.y,
			props: {
				color: line.color,
				// Cubic renders (and getShapeGeometry samples) a smooth curve through
				// the points; straight segments use the 'line' spline.
				spline: line.curved ? 'cubic' : 'line',
				points,
			},
		})
	}

	// Rings — small gold geo ELLIPSES (geometry.ts → isRingShape collects these as
	// scoring rings and excludes them from collision, so the character passes
	// through). A ring reads as a real Sonic ring, unlike an oversized sticky note.
	for (const ring of RINGS) {
		const id = createShapeId()
		ids.push(id)
		const pg = toPage(ring)
		// A geo shape is placed by its top-left; offset by half the ring size so the
		// ring's CENTER lands on the ring point (where it visually reads / is caught).
		editor.createShape({
			id,
			type: 'geo',
			x: pg.x - RING_SIZE / 2,
			y: pg.y - RING_SIZE / 2,
			props: { geo: 'ellipse', w: RING_SIZE, h: RING_SIZE, color: RING_COLOR, fill: 'none' },
		})
	}

	// The goal — a native frame at the end (goal.ts: frame = the finish box).
	const goalId = createShapeId()
	ids.push(goalId)
	const goalPage = toPage({ x: GOAL_X, y: -120 })
	editor.createShape({
		id: goalId,
		type: 'frame',
		x: goalPage.x,
		y: goalPage.y,
		props: { w: 160, h: 240, name: 'GOAL' },
	})

	return ids
}

// ── Pure course geometry (no tldraw) — shared by the e2e harness / structure test ──
// The color → LineKind map used by the pure builder, mirroring geometry.ts's
// COLOR_TO_KIND for exactly the colors this course uses. Kept tiny and local so the
// pure builder needs no editor.
const KIND_OF: Record<TrackColor, Segment['kind']> = {
	black: 'solid',
	red: 'accelerate',
	yellow: 'bounce',
	grey: 'ice',
	blue: 'oneway', // the loop; flip:false (set on the segment below) rides the inside
}

/** Catmull-Rom sample of a polyline into `perSeg` points per control interval, so a
 * `curved` line reads as a smooth curve (a faithful stand-in for tldraw's cubic
 * spline for collision purposes). A non-curved line returns its points unchanged. */
function samplePolyline(pts: Vec2[], curved: boolean, perSeg = 8): Vec2[] {
	if (!curved || pts.length < 3) return pts
	const out: Vec2[] = []
	const p = (i: number) => pts[Math.max(0, Math.min(pts.length - 1, i))]
	for (let i = 0; i < pts.length - 1; i++) {
		const p0 = p(i - 1)
		const p1 = p(i)
		const p2 = p(i + 1)
		const p3 = p(i + 2)
		for (let s = 0; s < perSeg; s++) {
			const t = s / perSeg
			const t2 = t * t
			const t3 = t2 * t
			// Catmull-Rom basis.
			const x =
				0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3)
			const y =
				0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
			out.push({ x, y })
		}
	}
	out.push(pts[pts.length - 1])
	return out
}

/**
 * The Green-Hill course as pure page-space collision segments relative to `start`
 * (no tldraw, no shapes). The same point data `loadGreenHill` lays down as shapes,
 * sampled into segments — so a headless harness can drive the real sled sim through
 * the real course to prove momentum/loops without a browser. Does NOT include the
 * side-mode ground plane (the RunController injects that); this is only the drawn
 * track. Rings/goal are separate (see greenHillGoalX).
 */
export function greenHillSegments(start: Vec2): Segment[] {
	const groundY = sideGroundY(start)
	const baseX = start.x + COURSE_AHEAD
	const toPage = (p: Vec2): Vec2 => ({ x: baseX + p.x, y: groundY + p.y })
	const segs: Segment[] = []
	for (const line of courseLines()) {
		const pts = samplePolyline(line.pts, line.curved).map(toPage)
		const kind = KIND_OF[line.color]
		for (let i = 0; i < pts.length - 1; i++) {
			const seg: Segment = { a: pts[i], b: pts[i + 1], kind, strength: 1 }
			// blue = oneway flip:false (COLOR_TO_KIND), matching the shape path — the
			// loop blocks from the inside so the runner rides its inner surface.
			segs.push(seg)
		}
	}
	return segs
}

/** The goal's page-space center X for a given start — where a winning run ends. */
export function greenHillGoalX(start: Vec2): number {
	return start.x + COURSE_AHEAD + GOAL_X
}
