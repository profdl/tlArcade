/**
 * CONSTANTS — the tuning knobs for the Scale Portals demo, in one place.
 * =======================================================================
 * The nesting invariant lives here: the child map's total extent is derived from
 * the parent ROOM footprint (not eyeballed), so a whole child map fits exactly
 * inside one parent room. Because roomExtent() is linear in (roomSize, gap),
 * scaling BOTH by the same CHILD_SCALE makes childExtent === parentMapExtent *
 * CHILD_SCALE, which we pin to a fraction of the parent room. See
 * mapGeometry.test.ts for the assertion.
 */
import { roomExtent } from './mapGeometry.ts'

/** Both maps are 3x3 grids — same KIND of map, different scale (the "hybrid" feel). */
export const PARENT_W = 3
export const PARENT_H = 3
export const CHILD_W = 3
export const CHILD_H = 3

/** Parent map: a full, predictable 9-room grid (reliable portal placement). */
export const PARENT_REMOVE_PROB = 0
/** Child map: a little ragged, so it reads as its own denser little world. */
export const CHILD_REMOVE_PROB = 0.2

/** Parent room size + the gap a doorway bridges (child scales both down together). */
export const PARENT_ROOM = 240
export const GAP = 80

/** Fixed seeds → the exact same demo every reload (not time-derived). */
export const PARENT_SEED = 1
export const CHILD_SEED = 2

/** Full page-space extent of the parent map (square for a square grid). */
export const PARENT_MAP_EXTENT = roomExtent(PARENT_W, PARENT_H, PARENT_ROOM, GAP)

/** The child map fills this fraction of the portal room's footprint (small inset margin). */
export const CHILD_FILL = 0.82
/**
 * Scale applied to BOTH child roomSize and child gap. Derived so the child map's
 * full extent equals CHILD_FILL of one parent ROOM — i.e. it nests inside the
 * portal room. (Uses the parent extent's width; the grid is square so w === h.)
 */
export const CHILD_SCALE = (PARENT_ROOM * CHILD_FILL) / PARENT_MAP_EXTENT.w
export const CHILD_ROOM = PARENT_ROOM * CHILD_SCALE
export const CHILD_GAP = GAP * CHILD_SCALE

/** Player is always ~1/8 of the current room, so it reads the same at any depth. */
export const PLAYER_FRACTION = 0.12
/** Speed as room-widths per second — pacing (time to cross a room) is depth-invariant. */
export const PLAYER_SPEED_ROOMS_PER_SEC = 0.75

/** Camera dive-in/out animation. */
export const ZOOM_DURATION_MS = 350
export const ZOOM_INSET = 40
