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

import { createShapeId, type Editor, type TLShapeId, type IndexKey } from 'tldraw'
import type { Segment, Vec2 } from './physics'
import { sideGroundY } from './state'

/** A tldraw v5 color name → a gameplay LineKind (see geometry.ts COLOR_TO_KIND). */
type TrackColor = 'black' | 'red' | 'yellow' | 'grey'

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
// matching page space). y = 0 is the ground plane the character runs on; negative
// y is UP (hills, the top of the loop). Tuned so a self-propelled sled (sideThrust
// / sideCruiseSpeed in physics.ts) builds enough speed on the hills to carry the
// loop.

// Where the course begins, px ahead of the spawn, so the character has a moment of
// flat ground to accelerate before the first hill.
const COURSE_AHEAD = 320

// Rolling hills: a smooth cubic through a few crests/dips to build momentum. Down
// a dip the sled accelerates (gravity along the slope); it carries that speed up
// the next crest.
const HILLS: Vec2[] = [
	{ x: 0, y: 0 },
	{ x: 220, y: 70 }, // dip (down 70)
	{ x: 460, y: -40 }, // crest (up 40)
	{ x: 700, y: 60 }, // dip
	{ x: 900, y: 0 }, // back to ground level
]

// A red speed-booster stretch on the flat after the hills (accelerate lines push
// the sled along its tangent — the Sonic speed strip).
const BOOST_START = 900
const BOOST_END = 1180

// The loop: a full circle the momentum sim carries the sled around. Authored as a
// closed cubic starting and ending at the ground (the entry/exit point), rising
// over the top. The sled needs real speed to make it — the boosters before it
// exist to guarantee that. Center is at the entry x + radius, sitting on the
// ground so the bottom of the loop IS the ground line.
const LOOP_ENTRY_X = 1180
const LOOP_R = 150

// After the loop, a short run-up to an angled spring (a tilted yellow bounce line):
// bounce launches along the surface normal, so a line tilted ~35° from horizontal
// throws the character up-and-forward — Sonic's diagonal spring.
const SPRING_X = 1720
const SPRING_LEN = 90
const SPRING_TILT_DEG = 35 // from horizontal; the launch is along the normal (up-forward)

// The landing hill after the spring, then a final flat to the goal.
const LANDING_X = 2100
const GOAL_X = 2500

// Rings scattered along the course (course-local; y is a bit above the surface so
// they float where you'd run/jump through them).
const RINGS: Ring[] = [
	{ x: 220, y: 70 - 40 }, // in the first dip
	{ x: 460, y: -40 - 40 }, // over the first crest
	{ x: 700, y: 60 - 40 }, // in the second dip
	{ x: 1030, y: -30 }, // along the booster strip
	{ x: LOOP_ENTRY_X + LOOP_R, y: -LOOP_R * 2 + 30 }, // at the top of the loop
	{ x: 1900, y: -120 }, // mid-air over the spring's arc
	{ x: 2300, y: -30 }, // on the run to the goal
]

/**
 * Build the loop as a closed circle of points (course-local), rising from the
 * ground at (entryX, 0) up and over and back down. Enough points that
 * getShapeGeometry samples it as a clean circle for collision.
 */
function loopPoints(entryX: number, r: number): Vec2[] {
	const cx = entryX + r
	const cy = -r // center one radius above the ground, so the loop bottom sits at y=0
	const pts: Vec2[] = []
	const N = 24
	// Start at the bottom (angle 90° in screen coords = straight down from center),
	// go around a full turn so the ends meet at the entry/exit on the ground.
	for (let i = 0; i <= N; i++) {
		const a = Math.PI / 2 + (i / N) * Math.PI * 2
		pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r })
	}
	return pts
}

/** All the track lines that make up the course, in draw order. */
function courseLines(): TrackLine[] {
	const lines: TrackLine[] = []
	// Rolling hills (curved, solid).
	lines.push({ pts: HILLS, color: 'black', curved: true })
	// Booster strip (straight, red = accelerate) on the flat.
	lines.push({
		pts: [
			{ x: BOOST_START, y: 0 },
			{ x: BOOST_END, y: 0 },
		],
		color: 'red',
		curved: false,
	})
	// The loop (curved, solid).
	lines.push({ pts: loopPoints(LOOP_ENTRY_X, LOOP_R), color: 'black', curved: true })
	// Flat run from the loop exit to the spring foot.
	lines.push({
		pts: [
			{ x: LOOP_ENTRY_X + LOOP_R * 2, y: 0 },
			{ x: SPRING_X, y: 0 },
		],
		color: 'black',
		curved: false,
	})
	// The angled spring (yellow = bounce), tilted up-forward.
	const rad = (SPRING_TILT_DEG * Math.PI) / 180
	lines.push({
		pts: [
			{ x: SPRING_X, y: 0 },
			{ x: SPRING_X + Math.cos(rad) * SPRING_LEN, y: -Math.sin(rad) * SPRING_LEN },
		],
		color: 'yellow',
		curved: false,
	})
	// Landing hill + final flat to the goal.
	lines.push({
		pts: [
			{ x: LANDING_X, y: 0 },
			{ x: GOAL_X + 200, y: 0 },
		],
		color: 'black',
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
		const points: Record<string, { id: string; index: IndexKey; x: number; y: number }> = {}
		line.pts.forEach((p, i) => {
			const pg = toPage(p)
			const key = `a${i + 1}`
			points[key] = { id: key, index: key as IndexKey, x: pg.x - origin.x, y: pg.y - origin.y }
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

	// Rings — native note shapes (geometry.ts collects notes as ring checkpoints).
	for (const ring of RINGS) {
		const id = createShapeId()
		ids.push(id)
		const pg = toPage(ring)
		editor.createShape({
			id,
			type: 'note',
			// Notes are placed by their top-left; nudge so the note's center lands on
			// the ring point (a default note is ~200px; centering keeps the catch box
			// where the ring reads). tldraw clamps/handles size, so this is approximate.
			x: pg.x - 100,
			y: pg.y - 100,
			props: { color: 'yellow', richText: ringLabel() },
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
		for (let i = 0; i < pts.length - 1; i++) {
			segs.push({ a: pts[i], b: pts[i + 1], kind: KIND_OF[line.color], strength: 1 })
		}
	}
	return segs
}

/** The goal's page-space center X for a given start — where a winning run ends. */
export function greenHillGoalX(start: Vec2): number {
	return start.x + COURSE_AHEAD + GOAL_X
}

/** A minimal tldraw richText doc holding a ring glyph, for the note label. */
function ringLabel() {
	return {
		type: 'doc',
		content: [{ type: 'paragraph', content: [{ type: 'text', text: '◎' }] }],
	}
}
