/**
 * CONSTANTS — the tuning knobs for the Scale Rooms demo, in one place.
 * =====================================================================
 * Unlike Scale Portals (a WFC grid of rooms joined by hallways, children in inset
 * slots), Scale Rooms is a TELESCOPE of single square rooms: each level is ONE room,
 * and its children are SMALLER rooms drawn OVERLAPPING its floor. There are no
 * hallways, no grid, no gap — a room's whole extent IS one square, and the only nesting
 * invariant is the scale ratio between a room and its children.
 *
 * SIZE CHART. Each child's side is `SCALE_RATIO` (= 1/√2) the parent's, so a child has
 * exactly HALF the area of its parent — the ratio in the supplied size chart. Colours
 * cycle every three levels (blue → light-blue → light-violet), also straight from the
 * chart. The world nests MAX_DEPTH + 1 = 16 levels; the largest frames at ~ROOT_ZOOM.
 */

/** Each level's side, as a fraction of its parent's side: 1/√2 ≈ 0.7071 (half the area). */
export const SCALE_RATIO = 1 / Math.SQRT2

/**
 * Root room side, page px. Largely a FEEL knob, not a correctness one: the camera fits
 * whatever room is current to the viewport at runtime (see fitZoomFor in gameLoop), and
 * every ratio below (player size, speed, portal geometry) is expressed relative to the
 * current room, so the world plays identically whatever this is. Sized to match the
 * supplied chart's largest square (~16.6k px), which frames near ROOT_ZOOM.
 */
export const ROOM_ROOT = 16000

/** roomSize at nesting depth `d` — each dive multiplies by SCALE_RATIO. Depth 0 is the root. */
export const roomAtDepth = (depth: number): number => ROOM_ROOT * SCALE_RATIO ** depth

/**
 * HOW MANY SCALES DEEP THE WORLD NESTS. The user's chart shows 16 squares, so the world
 * goes 16 levels: depth 0 (root) through depth MAX_DEPTH. A dive multiplies the framing
 * zoom by 1/SCALE_RATIO (≈1.414×), so the deepest level frames at ROOT_ZOOM × 1.414^15 ≈
 * ROOT_ZOOM × 181. With ROOT_ZOOM 5% that is ~905%, so ZOOM_CEILING is set well above it
 * (with headroom for smaller viewports, where the root fits at a slightly higher zoom and
 * every level shifts up with it). Bump both together to nest deeper.
 */
export const MAX_DEPTH = 15

/** The root map is framed near here (also zoomSteps[0], tldraw v5's native minimum). */
export const ROOT_ZOOM = 0.05
/** Camera max zoom — pinned above the deepest level's framing (~9×) with headroom. */
export const ZOOM_CEILING = 16
/**
 * The editor's discrete zoom levels. First is the min, last the max. The max must clear
 * the deepest room's framing so zoomToBounds can actually reach it (tldraw clamps to this
 * array's ends). Intermediate values are just snap points; the game shows no zoom UI.
 */
export const ZOOM_STEPS = [ROOT_ZOOM, 0.1, 0.25, 0.5, 1, 2, 4, 8, ZOOM_CEILING]

/** Player is always ~1/16 of the current room, so it reads the same at any depth. */
export const PLAYER_FRACTION = 0.06
/** Speed as room-widths per second — pacing (time to cross a room) is depth-invariant. */
export const PLAYER_SPEED_ROOMS_PER_SEC = 1.5

/**
 * TREE SHAPE. Every room spawns 1–CHILDREN_MAX child rooms (biased toward 1), placed in
 * DISTINCT corners so each parent keeps an L-shaped walkable floor around its solid,
 * overlapping children — the size-chart's nested-corner spiral. The world is grown by
 * randomly expanding a frontier until ROOM_BUDGET rooms exist (or MAX_DEPTH is hit), so
 * branches terminate at VARIED depths (some shallow, some deep) while the total stays in
 * the 100–500 range. Kept low (2) precisely because children are solid: more than a couple
 * of 1/√2 rooms would tile over the whole parent floor and leave nowhere to walk. Seeded,
 * so ?seed= reproduces the world.
 */
export const ROOM_BUDGET = 300
export const CHILDREN_MAX = 2

/**
 * DOORWAY geometry, as fractions of the CHILD room's side. A doorway is ONE orange rect that
 * STRADDLES the wall between a room and one of its (smaller, solid) children — and it is both
 * the drawn door AND the dive trigger, so what you SEE is exactly what triggers (no invisible
 * hit zone). It reaches DOOR_HALF onto EACH side of the wall, so a player pressing the wall
 * from the parent side (walk in → dive in) or from inside the child (walk to it → dive out)
 * overlaps it; DOOR_MOUTH is the opening's width along the wall.
 *
 * SHAPE. A door is a NARROW SLOT lying along the wall: its ACROSS-wall depth (2 × DOOR_HALF)
 * is small next to its ALONG-wall length (DOOR_MOUTH), so it reads as a thin doorway, not a
 * chunky pad. The floor on DOOR_HALF: the dive fires when the player's CENTRE is on the door
 * (portalAt/centreInside), and on an 'in' door the player is stopped at the child's solid wall,
 * so its centre can only reach ~PLAYER_FRACTION/2 (≈0.042 of the child side) past the wall onto
 * the door's parent-side half. DOOR_HALF must stay comfortably above that or the centre can
 * never land on the door and the dive never fires — 0.08 keeps a safe margin, so the along-wall
 * LENGTH (DOOR_MOUTH) is the only dimension free to shrink the door relative to the room.
 */
export const DOOR_HALF = 0.08
export const DOOR_MOUTH = 0.3

/**
 * How far past the doorway (as a fraction of the CHILD room's side) a dive aims the player's
 * landing point, along the door edge's normal — inward on a dive-IN, outward on a dive-OUT.
 * It only sets the PREFERRED point: findClearPoint (with placementAvoid, which excludes every
 * door hit) then nudges it to the nearest open floor OFF the door, so you arrive standing just
 * clear of the leaf you came through — never on it (which, with the centre-on-door trigger,
 * would otherwise re-fire the dive). Sized a touch past DOOR_HALF so the aim clears the wall.
 */
export const LAND_OFFSET = 0.15

/**
 * ONE COLOUR PER LEVEL, cycling every three depths — straight from the size chart
 * (#4465e9 / #4ba1f1 / #e085f4). tldraw v5 palette names only.
 */
export const DEPTH_COLORS = ['blue', 'light-blue', 'light-violet'] as const
/** The room fill colour for a level at `depth` (cycles every 3). */
export const colorForDepth = (depth: number): string => DEPTH_COLORS[depth % DEPTH_COLORS.length]

/** Fixed seed for TESTS (deterministic assertions). The game rolls a fresh world seed
 *  each start (see gameLoop's randomWorldSeed; override with ?seed=). */
export const TEST_SEED = 1

/** Camera dive-in/out animation, ms. A dive spans a ~1.414× zoom ratio, eased geometrically. */
export const ZOOM_DURATION_MS = 500
/** Camera inset (page px) framing the ROOT map. Deeper maps inset by SCALE_RATIO^depth so
 *  the on-screen margin looks the same at every scale. */
export const ZOOM_INSET = 40
