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

// The gap between the two corridor walls. Kept just UNDER the crossbar's full
// width (2*CROSSBAR_HALF_W = 180) so a level crossbar can't fit — the T has to
// turn to thread it. Tune this ratio to make the squeeze easier/harder.
const GAP_HALF = 70 // half the corridor opening height (140 tall < 180 crossbar)
const CORRIDOR_X = 620 // x of the pinch point
const WALL_T = 30 // wall thickness (half-extent)

/** Static maze walls, page space (center + half-extents). A boxed field with a
 * pinch in the middle wall that forces the rotate-to-pass moment. */
export const MAZE_WALLS: Rect[] = [
	// Outer boundary (top, bottom, left, right) — keep the T on the field.
	{ cx: 600, cy: FIELD.minY - WALL_T, halfW: 620, halfH: WALL_T }, // top
	{ cx: 600, cy: FIELD.maxY + WALL_T, halfW: 620, halfH: WALL_T }, // bottom
	{ cx: FIELD.minX - WALL_T, cy: 400, halfW: WALL_T, halfH: 420 }, // left
	{ cx: FIELD.maxX + WALL_T, cy: 400, halfW: WALL_T, halfH: 420 }, // right
	// The pinch: a wall from the top and one from the bottom, leaving a GAP_HALF*2
	// opening centered vertically — narrower than the crossbar.
	{ cx: CORRIDOR_X, cy: (FIELD.minY + (400 - GAP_HALF)) / 2, halfW: WALL_T, halfH: (400 - GAP_HALF) / 2 },
	{ cx: CORRIDOR_X, cy: (FIELD.maxY + (400 + GAP_HALF)) / 2, halfW: WALL_T, halfH: (FIELD.maxY - (400 + GAP_HALF)) / 2 },
]
