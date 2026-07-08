// Ant-mover geometry — the SINGLE SOURCE OF TRUTH for the T load and the maze.
//
// Everything (the planck bodies in the sim AND the SVG the overlay draws) derives
// from these constants, so the physics and the picture can never disagree. All
// coordinates are in tldraw PAGE space (px). The plan authors geometry as
// hardcoded constants (not native shapes) so the corridor-forces-rotation ratio
// is tunable in one place; see ANT_MOVER_PLAN.md step 1.
//
// planck uses meters, tldraw uses pixels. We pick a scale (PX_PER_M) and convert
// at the sim boundary; these constants stay in px, the human-legible unit.

/** Pixels per planck meter. Box2D is tuned for objects ~0.1–10 m; keeping the T a
 * few meters across (not a few hundred) keeps the solver in its happy range. */
export const PX_PER_M = 30

export interface Vec2 {
	x: number
	y: number
}

/** An axis-aligned rectangle in page space (a maze wall or a T limb). Center +
 * half-extents — the same shape planck's Box fixture wants, so the mapping is
 * trivial. `cx,cy` are RELATIVE to their parent's origin (the T's center, or the
 * page for walls). */
export interface Rect {
	cx: number
	cy: number
	halfW: number
	halfH: number
}

// --- The T load -------------------------------------------------------------
// Two overlapping boxes (crossbar + stem) welded into one compound body. Local
// frame: origin at the body center, +x right, +y DOWN (page/screen convention).
// The center is placed so the piece balances reasonably; exact COM comes from
// planck once both fixtures have density.

/** Half-width of the crossbar (the top of the T), px. */
const CROSSBAR_HALF_W = 90
/** Half-height (thickness) of the crossbar, px. */
const CROSSBAR_HALF_H = 22
/** Half-width (thickness) of the stem (the vertical of the T), px. */
const STEM_HALF_W = 22
/** Half-height of the stem, px. */
const STEM_HALF_H = 78

/** The T's two fixtures, in the body's local frame (px, +y down). The crossbar
 * sits at the top; the stem hangs below it, overlapping so they weld into a
 * continuous T outline. */
export const T_FIXTURES: Rect[] = [
	{ cx: 0, cy: -(STEM_HALF_H), halfW: CROSSBAR_HALF_W, halfH: CROSSBAR_HALF_H },
	{ cx: 0, cy: CROSSBAR_HALF_H, halfW: STEM_HALF_W, halfH: STEM_HALF_H },
]

/** A generous radius covering the whole T, for cheap cursor hit-tests before the
 * precise per-fixture check. */
export const T_BOUND_RADIUS = Math.hypot(CROSSBAR_HALF_W, STEM_HALF_H + CROSSBAR_HALF_H)

// --- The maze ---------------------------------------------------------------
// A first tuning pass: a corridor with a gap NARROWER than the crossbar, so the T
// MUST rotate to pass — the awkward-object squeeze the game is about. Walls are
// static rects in page space. Exit is past the gap.

/** The playfield the T is dragged across (page-space bounds, for camera framing). */
export const FIELD = { minX: 0, minY: 0, maxX: 1200, maxY: 800 }

/** Where the T spawns (page-space center of the body). */
export const T_SPAWN: Vec2 = { x: 200, y: 400 }

/** The exit zone the T must reach to win (page space). Used for framing now,
 * scored in step 7. */
export const EXIT = { cx: 1050, cy: 400, halfW: 80, halfH: 120 }

// The pinch. The opening is defined by its CENTER and half-height, then each
// pinch wall is derived to fill from the field edge to the opening edge — so the
// gap width is exactly `GAP * 2` and can't drift from a hand-computed extent
// (the bug the first pass had: the gap collapsed to 30px, unthreadable).
//
// Sizing the gap — the squeeze is an ALIGNMENT problem, not a "shrink the
// bounding box" one. The pinch is a thin VERTICAL wall, so what must fit through
// is the T's VERTICAL extent as it crosses x=CORRIDOR_X:
//  - Level (angle 0): crossbar 44px thick + stem hangs 156px below = ~200px tall.
//  - Tilted: taller (a 45° T spans more vertically) → jams.
// So a T that's carefully held LEVEL slips through, but a careless/tilted one
// wedges. That's the tension: keep it aligned or it catches. Gap is set just
// above the level extent (200px) for clearance, so alignment — not luck — is what
// gets it through. (A single straight slot can't force a *rotation*; a real
// rotate-to-pass needs a corridor with a turn — that's a step-7 maze, not step 2.)
const WALL_T = 30 // wall half-thickness (px)
const CORRIDOR_X = 620 // x of the pinch
const GAP = 120 // half the opening → 240px tall. Level T (~200) fits; tilted jams.
const GAP_CY = 400 // opening centered on the field's mid-line
const GAP_TOP = GAP_CY - GAP // page-y of the opening's top edge
const GAP_BOTTOM = GAP_CY + GAP // page-y of the opening's bottom edge

/** Build a vertical pinch wall spanning [yTop, yBottom] at x=CORRIDOR_X. */
function pinchWall(yTop: number, yBottom: number): Rect {
	return { cx: CORRIDOR_X, cy: (yTop + yBottom) / 2, halfW: WALL_T, halfH: (yBottom - yTop) / 2 }
}

/** Static maze walls, page space (center + half-extents). A boxed field with a
 * pinch in the middle that forces the rotate-to-pass moment. */
export const MAZE_WALLS: Rect[] = [
	// Outer boundary (top, bottom, left, right) — keep the T on the field.
	{ cx: 600, cy: FIELD.minY - WALL_T, halfW: 620, halfH: WALL_T }, // top
	{ cx: 600, cy: FIELD.maxY + WALL_T, halfW: 620, halfH: WALL_T }, // bottom
	{ cx: FIELD.minX - WALL_T, cy: 400, halfW: WALL_T, halfH: 420 }, // left
	{ cx: FIELD.maxX + WALL_T, cy: 400, halfW: WALL_T, halfH: 420 }, // right
	// The pinch: a wall from the field top down to the opening, and one from the
	// opening down to the field bottom — leaving a GAP*2 gap centered on GAP_CY.
	pinchWall(FIELD.minY, GAP_TOP),
	pinchWall(GAP_BOTTOM, FIELD.maxY),
]
