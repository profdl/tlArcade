/**
 * CONSTANTS — the tuning knobs for the Scale Portals demo, in one place.
 * =======================================================================
 * The nesting invariant lives here: the child map's total extent is derived from
 * the SLOT a submap cell offers (not eyeballed), so a whole child map fits exactly
 * in that slot. Because roomExtent() is linear in (roomSize, gap), scaling BOTH by
 * the same CHILD_SCALE makes childExtent === parentMapExtent * CHILD_SCALE, which
 * we pin to the slot side. See mapGeometry.test.ts for the assertion.
 */
import { roomExtent } from './mapGeometry.ts'

/** Every scale is a 3x3 grid — same KIND of map, different scale (the "hybrid" feel).
 *  The maps are deliberately consistent at every depth, so the world reads as the
 *  same place seen closer and closer. */
export const PARENT_W = 3
export const PARENT_H = 3
export const CHILD_W = 3
export const CHILD_H = 3

/** Root map: a full, predictable 9-room grid (reliable portal placement). */
export const PARENT_REMOVE_PROB = 0
/** Nested maps: a little ragged, so each reads as its own denser little world. */
export const CHILD_REMOVE_PROB = 0.2

/**
 * Parent room size + the gap a doorway bridges (child scales both down together).
 * The root world's page-space extent is linear in BOTH, and the zoom at which the
 * whole map fits the viewport is inversely proportional to that extent — so scaling
 * these two together (keeping their 3:1 ratio) resizes the world WITHOUT touching any
 * nesting invariant (CHILD_SCALE, player size, and speed are all ratios of room size).
 * These values frame the root at ~5% (18.75x larger than the original 240/80, which
 * fit at ~93%) — 5% is tldraw v5's native minimum zoom (zoomSteps[0]), so no camera
 * override is needed; zoomToBounds lands right at the floor.
 */
export const PARENT_ROOM = 4500
export const GAP = 1500

/**
 * Fixed seeds for TESTS (deterministic assertions). The game itself generates a NEW
 * world seed every start (see gameLoop's randomWorldSeed; override with ?seed=), and
 * derives every child's seed from it via childSeedFor.
 */
export const PARENT_SEED = 1
export const CHILD_SEED = 2

/** Full page-space extent of the parent map (square for a square grid). */
export const PARENT_MAP_EXTENT = roomExtent(PARENT_W, PARENT_H, PARENT_ROOM, GAP)

/** The child map fills this fraction of its host cell's footprint (small inset margin). */
export const CHILD_FILL = 0.82
/**
 * SLOT — the square a submap cell offers to its nested child map (centred in the
 * cell footprint). The child map's extent is pinned to exactly this, so tunnels
 * built to the slot edge meet the child's gate rooms.
 */
export const SLOT = PARENT_ROOM * CHILD_FILL
/**
 * How far a tunnel pokes INTO a slot (page px). The dive trigger is a strict AABB
 * overlap with the slot, so the player must be able to advance onto it while still
 * standing in the walkable tunnel.
 *
 * CRITICAL: this MUST exceed the player's per-tick movement step, or diving breaks.
 * Movement is all-or-nothing per axis per tick (see collision.ts resolveMove): a step
 * only applies if the WHOLE player box stays in the walkable union, so the player halts
 * in ~step-sized jumps at the tunnel's dead end. If the poke (the overlap zone's depth)
 * is smaller than one step, every jump that reaches the end overshoots the zone and is
 * rejected — the player never overlaps the slot, so it never dives in. The step is
 * roomSize * PLAYER_SPEED_ROOMS_PER_SEC / 60 ≈ 0.025 * roomSize, so we keep the poke a
 * fixed 0.05 of the room (the original 12/240 ratio) — scale-invariant, ~2x the step.
 */
export const SLOT_POKE = PARENT_ROOM * 0.05
/**
 * Scale applied to BOTH child roomSize and child gap. Derived so the child map's
 * full extent equals the SLOT — i.e. it exactly fills a submap cell's slot.
 * (Uses the parent extent's width; the grid is square so w === h.)
 */
export const CHILD_SCALE = SLOT / PARENT_MAP_EXTENT.w
export const CHILD_ROOM = PARENT_ROOM * CHILD_SCALE
export const CHILD_GAP = GAP * CHILD_SCALE

/** roomSize / gap at nesting depth `d` — each dive compounds CHILD_SCALE, so a map at
 *  depth d is CHILD_SCALE^d the size of the root. Depth 0 is the root (PARENT_ROOM/GAP). */
export const roomAtDepth = (depth: number): number => PARENT_ROOM * CHILD_SCALE ** depth
export const gapAtDepth = (depth: number): number => GAP * CHILD_SCALE ** depth

/**
 * HOW MANY SCALES DEEP THE WORLD NESTS — derived from the zoom window we allow.
 * -------------------------------------------------------------------------------
 * The root map is framed at ROOT_ZOOM (10%, tldraw's native minimum). Each dive
 * zooms in by 1/CHILD_SCALE (~4.47x), so a map at depth d is framed at
 * ROOT_ZOOM / CHILD_SCALE^d. The deepest depth must stay <= ZOOM_CEILING, so:
 *   ROOT_ZOOM / CHILD_SCALE^MAX_DEPTH <= ZOOM_CEILING
 *   MAX_DEPTH <= log(ZOOM_CEILING / ROOT_ZOOM) / log(1 / CHILD_SCALE)
 *
 * tldraw's NATIVE ceiling is 800%, which floors to 2 dive steps => 3 scales
 * (10% / ~44.7% / ~200%). To nest DEEPER we raise the ceiling past 800% and widen
 * the editor's zoomSteps to match (see ZOOM_STEPS below + App.tsx setCameraOptions).
 * At 1000% the formula floors to 3 dive steps => 4 scales, adding a fourth depth
 * framed at ~894% — just inside the widened window. Bump ZOOM_CEILING further
 * (and re-check the deepest frame stays under it) to go deeper still.
 */
export const ROOT_ZOOM = 0.1
export const ZOOM_CEILING = 10
export const MAX_DEPTH = Math.floor(
	Math.log(ZOOM_CEILING / ROOT_ZOOM) / Math.log(1 / CHILD_SCALE)
)

/**
 * The editor's discrete zoom levels. First value is the min zoom, last is the max —
 * the max is pinned to ZOOM_CEILING so zoomToBounds can actually reach the deepest
 * map's ~894% frame (tldraw clamps to this array's ends). Intermediate values are
 * just snap points and don't matter for the game (no zoom UI is shown).
 */
export const ZOOM_STEPS = [ROOT_ZOOM, 0.25, 0.5, 1, 2, 4, 8, ZOOM_CEILING]

/** Player is always ~1/8 of the current room, so it reads the same at any depth. */
export const PLAYER_FRACTION = 0.12
/** Speed as room-widths per second — pacing (time to cross a room) is depth-invariant. */
export const PLAYER_SPEED_ROOMS_PER_SEC = 1.5

/** Camera dive-in/out animation. A dive spans a large zoom ratio (~18.75× per depth), eased
 *  geometrically (see gameLoop) — a slightly longer beat reads as a graceful scale rather
 *  than a snap. */
export const ZOOM_DURATION_MS = 500
/** Camera inset (page px) framing the ROOT map. Deeper maps inset by CHILD_SCALE^depth
 *  so the on-screen margin looks the same at every scale. */
export const ZOOM_INSET = 40
