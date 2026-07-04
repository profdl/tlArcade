/**
 * WFC TILESET — room-cell tiles for the fishtank generator.
 * =========================================================
 * Wave Function Collapse here is the classic TILED model: a grid of cells, each
 * cell eventually resolving to ONE tile. A tile is a ROOM CELL whose four edges
 * are each either a `wall` (closed) or a `door` (an opening toward that neighbour).
 *
 * The single adjacency rule the collapse enforces (see collapse.ts) is EDGE
 * AGREEMENT: across the border two cells share, both must mark that border the
 * same way — a `door` must face a `door`, a `wall` must face a `wall`. That one
 * rule is what makes the generated warren coherent: an opening on one side is
 * always matched by an opening on the other, so every door is a real two-way
 * passage (which generateTank.ts then realises as an overlapping doorway rect).
 *
 * This is PURE DATA (no editor, no DOM) so the collapse that consumes it runs
 * under `yarn test`. Keep it that way.
 */

/** The four edges of a square cell. Order matters: opposite(dir) flips N↔S, E↔W. */
export type Dir = 'N' | 'E' | 'S' | 'W'
export const DIRS: Dir[] = ['N', 'E', 'S', 'W']

/** Step (dx, dy) in CELL coordinates for each direction (y grows downward, like the canvas). */
export const DELTA: Record<Dir, { dx: number; dy: number }> = {
	N: { dx: 0, dy: -1 },
	E: { dx: 1, dy: 0 },
	S: { dx: 0, dy: 1 },
	W: { dx: -1, dy: 0 },
}

/** The edge on the far cell that meets our `dir` edge (N borders the neighbour's S, etc.). */
export function opposite(dir: Dir): Dir {
	switch (dir) {
		case 'N':
			return 'S'
		case 'S':
			return 'N'
		case 'E':
			return 'W'
		case 'W':
			return 'E'
	}
}

/** How a tile treats one of its edges: a solid wall, or a door (opening) to the neighbour. */
export type Edge = 'wall' | 'door'

/**
 * A room-cell tile: its four edges + a RELATIVE weight (higher = chosen more often
 * during observation). `name` is for debugging/tests only.
 *   edges.N/E/S/W — 'door' opens toward that neighbour, 'wall' is closed.
 */
export type Tile = {
	name: string
	edges: Record<Dir, Edge>
	weight: number
}

/**
 * The tileset. We enumerate the room cells by their DOOR COUNT so the collapse has,
 * for any required edge configuration, at least one tile that fits — and we weight
 * toward 2–3 door rooms so generated levels are well-connected (corridors and
 * junctions) rather than a field of sealed boxes or a fully-open plaza.
 *
 * Completeness matters for WFC: propagation narrows a cell to the tiles whose edges
 * match every already-decided neighbour. If no tile offered, say, "door on N only",
 * a cell forced into that configuration would hit a CONTRADICTION. Enumerating all
 * 16 wall/door combinations guarantees every edge demand is satisfiable, so the
 * collapse never dead-ends on a missing piece (only on genuine over-constraint,
 * which the retry in collapse.ts handles).
 */
function tile(name: string, n: Edge, e: Edge, s: Edge, w: Edge, weight: number): Tile {
	return { name, edges: { N: n, E: e, S: s, W: w }, weight }
}

const W: Edge = 'wall'
const D: Edge = 'door'

export const TILES: Tile[] = [
	// 0 doors — a sealed room. Low weight: a few make nice dead-air pockets, but a
	// level of them would be all walls and no passages.
	tile('sealed', W, W, W, W, 0.4),

	// 1 door — a dead-end room (one way in/out). Modest weight.
	tile('end-N', D, W, W, W, 1),
	tile('end-E', W, D, W, W, 1),
	tile('end-S', W, W, D, W, 1),
	tile('end-W', W, W, W, D, 1),

	// 2 doors, straight-through — a corridor segment. HIGH weight: corridors are the
	// connective tissue that makes the warren swimmable end-to-end.
	tile('hall-NS', D, W, D, W, 3),
	tile('hall-EW', W, D, W, D, 3),

	// 2 doors, bent — an L-corner. High weight: corners let corridors turn.
	tile('bend-NE', D, D, W, W, 2.5),
	tile('bend-ES', W, D, D, W, 2.5),
	tile('bend-SW', W, W, D, D, 2.5),
	tile('bend-WN', D, W, W, D, 2.5),

	// 3 doors — a T-junction. Medium weight: branching points.
	tile('tee-NES', D, D, D, W, 1.5),
	tile('tee-ESW', W, D, D, D, 1.5),
	tile('tee-SWN', D, W, D, D, 1.5),
	tile('tee-WNE', D, D, W, D, 1.5),

	// 4 doors — an open crossroads hub. Low-ish: a few make good central chambers.
	tile('cross', D, D, D, D, 1),
]
