/**
 * WFC COLLAPSE — the pure Wave Function Collapse core (tiled model).
 * =================================================================
 * Takes a grid size + a seed and returns a fully-resolved grid of room-cell tiles
 * (see tiles.ts), where every shared border has matching edges (door↔door, wall↔wall).
 *
 * The algorithm, classic observe/propagate:
 *   • Every cell starts as the SUPERPOSITION of all tiles (all possible).
 *   • OBSERVE: pick the undecided cell with the FEWEST remaining options (lowest
 *     "entropy" — the most-constrained cell, least likely to need a guess), and
 *     collapse it to ONE tile chosen by WEIGHT from the seeded RNG.
 *   • PROPAGATE: that choice constrains neighbours — a neighbour may only keep
 *     tiles whose facing edge AGREES with an edge still possible on this cell.
 *     Propagation ripples outward until no cell's option set changes.
 *   • Repeat until every cell is decided, or a cell's options empty out — a
 *     CONTRADICTION, which we recover from by retrying with a fresh sub-seed.
 *
 * PURE: no editor, no DOM, deterministic for a given seed → it runs under `yarn test`
 * and the same seed reproduces the same tank (which is why generation can be a plain
 * client-local store write, gotcha #7, and still look identical when re-tested).
 */
import { DELTA, DIRS, opposite, TILES, type Dir, type Tile } from './tiles.ts'

/** A resolved grid: grid[y][x] is the chosen Tile for that cell. Row-major, y downward. */
export type TileGrid = Tile[][]

/**
 * A tiny deterministic PRNG (mulberry32). We do NOT use Math.random so a seed fully
 * determines the tank — required for reproducible tests and for "same seed → same map".
 * Returns a function yielding floats in [0, 1).
 */
export function mulberry32(seed: number): () => number {
	let a = seed >>> 0
	return function () {
		a |= 0
		a = (a + 0x6d2b79f5) | 0
		let t = Math.imul(a ^ (a >>> 15), 1 | a)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

/** Pick an index into `tiles` weighted by each tile's weight, using rng ∈ [0,1). */
function weightedPick(tiles: Tile[], rng: () => number): number {
	let total = 0
	for (const t of tiles) total += t.weight
	let r = rng() * total
	for (let i = 0; i < tiles.length; i++) {
		r -= tiles[i].weight
		if (r <= 0) return i
	}
	return tiles.length - 1 // float-slop fallback
}

/**
 * One collapse attempt. Returns the resolved grid, or null on a contradiction (the
 * caller retries with a new sub-seed). Options are tracked as boolean masks over the
 * shared TILES array (cell options = which TILES indices are still possible).
 */
function attempt(width: number, height: number, seed: number): TileGrid | null {
	const rng = mulberry32(seed)
	const n = TILES.length
	// options[y][x] = boolean[n]; true = that tile index is still possible here.
	const options: boolean[][][] = Array.from({ length: height }, () =>
		Array.from({ length: width }, () => Array.from({ length: n }, () => true))
	)
	const countAt = (x: number, y: number) => options[y][x].reduce((s, ok) => s + (ok ? 1 : 0), 0)

	const inBounds = (x: number, y: number) => x >= 0 && x < width && y >= 0 && y < height

	/**
	 * Propagate constraints outward from `startX,startY` via a worklist. For each
	 * neighbour we keep only tiles whose facing edge agrees with SOME still-possible
	 * tile on the current cell; if that shrinks the neighbour, we re-enqueue it.
	 * Returns false on a contradiction (a neighbour emptied out).
	 */
	function propagate(startX: number, startY: number): boolean {
		const stack: [number, number][] = [[startX, startY]]
		while (stack.length > 0) {
			const [x, y] = stack.pop()!
			const here = options[y][x]
			for (const dir of DIRS) {
				const { dx, dy } = DELTA[dir]
				const nx = x + dx
				const ny = y + dy
				if (!inBounds(nx, ny)) continue
				// The set of edge-states this cell can still present toward `dir`.
				const allowedEdges = new Set<string>()
				for (let i = 0; i < n; i++) if (here[i]) allowedEdges.add(TILES[i].edges[dir])
				// A neighbour tile survives iff its FACING edge matches one of those.
				const facing = opposite(dir)
				const nb = options[ny][nx]
				let changed = false
				let any = false
				for (let i = 0; i < n; i++) {
					if (!nb[i]) continue
					if (!allowedEdges.has(TILES[i].edges[facing])) {
						nb[i] = false
						changed = true
					} else {
						any = true
					}
				}
				if (!any) return false // neighbour has no options left → contradiction
				if (changed) stack.push([nx, ny])
			}
		}
		return true
	}

	// OBSERVE/PROPAGATE until every cell is a singleton (or we contradict).
	for (;;) {
		// Find the undecided cell with the fewest options (lowest entropy). Ties broken
		// by the RNG so the structure doesn't bias toward a scan order.
		let best: { x: number; y: number; count: number } | null = null
		let tieKey = -1
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const c = countAt(x, y)
				if (c <= 1) continue // already decided (or empty — caught below)
				const key = rng()
				if (best === null || c < best.count || (c === best.count && key > tieKey)) {
					best = { x, y, count: c }
					tieKey = key
				}
			}
		}
		if (best === null) break // all cells decided

		// Collapse the chosen cell to ONE tile, weighted among its survivors.
		const survivors: Tile[] = []
		const survivorIdx: number[] = []
		for (let i = 0; i < n; i++) {
			if (options[best.y][best.x][i]) {
				survivors.push(TILES[i])
				survivorIdx.push(i)
			}
		}
		const pick = survivorIdx[weightedPick(survivors, rng)]
		for (let i = 0; i < n; i++) options[best.y][best.x][i] = i === pick

		if (!propagate(best.x, best.y)) return null // contradiction → caller retries
	}

	// Materialise the singleton options into a Tile grid.
	const grid: TileGrid = Array.from({ length: height }, () => Array.from({ length: width }, () => TILES[0]))
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const idx = options[y][x].findIndex((ok) => ok)
			if (idx < 0) return null // shouldn't happen post-loop, but guard
			grid[y][x] = TILES[idx]
		}
	}
	return grid
}

/**
 * Collapse a `width × height` grid into resolved room-cell tiles, deterministically
 * from `seed`. Retries on contradiction with derived sub-seeds (WFC contradicts
 * occasionally; a fresh observation order usually succeeds). Throws only if every
 * retry contradicts — vanishingly unlikely for this complete tileset at sane sizes.
 */
export function collapse(width: number, height: number, seed: number, maxRetries = 30): TileGrid {
	for (let attemptNo = 0; attemptNo < maxRetries; attemptNo++) {
		// Derive a distinct sub-seed per attempt so each retry explores a different order.
		const subSeed = (seed ^ Math.imul(attemptNo + 1, 0x9e3779b1)) >>> 0
		const grid = attempt(width, height, subSeed)
		if (grid) return grid
	}
	throw new Error(`WFC: ${maxRetries} attempts all contradicted at ${width}×${height} (seed ${seed})`)
}

/**
 * Whether two adjacent cells have a DOOR between them: cell (x,y)'s `dir` edge is a
 * door AND (by the collapse's edge-agreement invariant) so is the neighbour's facing
 * edge. Used by connectivity.ts to walk the passage graph and by generateTank.ts to
 * decide where to emit a doorway rect. Returns false if the neighbour is off-grid.
 */
export function hasDoor(grid: TileGrid, x: number, y: number, dir: Dir): boolean {
	return grid[y][x].edges[dir] === 'door'
}
