/**
 * WFC CONNECTIVITY — find the playable region of a generated map.
 * =================================================================
 * WFC guarantees local edge AGREEMENT (every door faces a door), but NOT global
 * connectivity: a valid collapse can still split into several door-connected
 * pockets with sealed walls between them. The player navigates a map as a graph of
 * rooms joined by doorways, so a room stranded in an unreachable pocket is a room
 * the player can never enter.
 *
 * So after collapse we:
 *   1. CONNECT the grid — carve extra doors between adjacent rooms in different
 *      components until the whole grid is ONE component, so you can reach any room
 *      from any other (connectGrid). This is the fix for "some rooms are isolated".
 *   2. flood-fill the DOOR graph into connected COMPONENTS (now just one).
 *
 * PURE (no editor/DOM) → tested under vitest. mapGeometry.ts consumes the result
 * and is the only impure step (it writes real tldraw shapes).
 */
import { hasDoor, mulberry32, type TileGrid } from './collapse.ts'
import { DELTA, DIRS, opposite, type Dir, type Tile } from './tiles.ts'

/** A cell coordinate in the grid. */
export type Cell = { x: number; y: number }

/**
 * A PRESENCE mask: present[y][x] === false means that cell was pruned (removed) and is
 * NOT a room — it's not a graph node, no door may point into it, no rect is emitted for
 * it. Threaded through the connectivity functions so "remove some rooms" and "every
 * remaining room reachable" compose. When a function is given no mask, every cell is
 * present (the original full-grid behaviour, so existing callers are unchanged).
 */
export type Present = boolean[][]

/** Is cell (x,y) present? True when there's no mask (full grid) or the mask marks it so. */
function isPresent(present: Present | undefined, x: number, y: number): boolean {
	return present ? !!present[y]?.[x] : true
}

/** Stable key for a cell, for sets/maps. */
const key = (x: number, y: number) => `${x},${y}`

/**
 * Partition the grid into door-connected COMPONENTS over the PRESENT cells. Two present
 * cells are in the same component when a chain of doors links them (cell A's edge toward
 * B is a door — which, by the collapse invariant, means B's facing edge is too) AND both
 * ends are present. Pruned cells are skipped entirely. Returns the components as lists of
 * cells, sorted LARGEST FIRST. With no `present` mask, every cell participates (original
 * full-grid behaviour).
 */
export function connectedComponents(grid: TileGrid, present?: Present): Cell[][] {
	const height = grid.length
	const width = grid[0]?.length ?? 0
	const seen = new Set<string>()
	const components: Cell[][] = []

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (!isPresent(present, x, y) || seen.has(key(x, y))) continue
			// BFS this cell's door-connected component (present cells only).
			const comp: Cell[] = []
			const queue: Cell[] = [{ x, y }]
			seen.add(key(x, y))
			while (queue.length > 0) {
				const cur = queue.shift()!
				comp.push(cur)
				for (const dir of DIRS) {
					if (!hasDoor(grid, cur.x, cur.y, dir)) continue
					const nx = cur.x + DELTA[dir].dx
					const ny = cur.y + DELTA[dir].dy
					if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
					if (!isPresent(present, nx, ny) || seen.has(key(nx, ny))) continue
					seen.add(key(nx, ny))
					queue.push({ x: nx, y: ny })
				}
			}
			components.push(comp)
		}
	}

	components.sort((a, b) => b.length - a.length)
	return components
}

/** The largest door-connected component over the PRESENT cells — the region fish can roam
 *  end-to-end. After pruneAndConnect the survivors are one component, so this returns them
 *  all; the `present` mask is forwarded so pruned cells are never counted. */
export function largestComponent(grid: TileGrid, present?: Present): Cell[] {
	const comps = connectedComponents(grid, present)
	return comps[0] ?? []
}

/**
 * CONNECT THE GRID — carve extra doors until every PRESENT room is reachable from every
 * other present one. WFC (and pruning) leaves the present rooms in several door-connected
 * pockets; this stitches them into ONE component by repeatedly finding an adjacent pair of
 * PRESENT cells in DIFFERENT components and carving a door between them (set on BOTH sides
 * so the collapse's door↔door edge-agreement invariant is preserved — generateTank reads
 * only one side, but connectedComponents reads both, so they must agree). Each carve merges
 * two components, so it terminates in (#components − 1) carves.
 *
 * Crucially this runs AFTER pruning (with the same mask): a door is only ever carved
 * between two present cells, so the survivors are guaranteed connected even though removing
 * a room could otherwise have split them. No door is carved into a pruned cell.
 *
 * Returns a NEW grid (cells whose edges changed are replaced with fresh Tile objects;
 * unchanged cells are shared) — the input grid is left untouched, keeping this pure.
 *
 * CAVEAT: connectivity is only guaranteed when the PRESENT cells form a single 4-connected
 * region on the grid (an inter-component carve site only exists if some present cell has a
 * present orthogonal neighbour in another component). pruneAndConnect enforces this by only
 * pruning cells that keep the present set 4-connected, so connectGrid always succeeds there.
 *
 * Door choice is DETERMINISTIC (scan order: lowest-y, then lowest-x cell, preferring its
 * E then S neighbour), so a seed still reproduces the same connected tank.
 */
export function connectGrid(grid: TileGrid, present?: Present): TileGrid {
	const height = grid.length
	const width = grid[0]?.length ?? 0
	if (height === 0 || width === 0) return grid

	// Work on a shallow copy of rows so we can swap individual cells without touching input.
	const out: TileGrid = grid.map((row) => row.slice())

	/** Replace cell (x,y)'s tile with one whose `dir` edge is a door (fresh object). */
	const carve = (x: number, y: number, dir: Dir) => {
		const t = out[y][x]
		if (t.edges[dir] === 'door') return
		const next: Tile = {
			name: `${t.name}+${dir}door`,
			weight: t.weight,
			edges: { ...t.edges, [dir]: 'door' },
		}
		out[y][x] = next
	}

	// Loop: while the present cells form >1 component, carve one inter-component door.
	// Recompute components after each carve (grids are small enough).
	for (;;) {
		const comps = connectedComponents(out, present)
		if (comps.length <= 1) break

		// Map each present cell to its component index for an O(1) "different component?" test.
		const compOf = new Map<string, number>()
		comps.forEach((comp, i) => comp.forEach((c) => compOf.set(key(c.x, c.y), i)))

		// Find the first adjacent pair of PRESENT cells (deterministic scan) in different comps.
		let carved = false
		for (let y = 0; y < height && !carved; y++) {
			for (let x = 0; x < width && !carved; x++) {
				if (!isPresent(present, x, y)) continue
				const mine = compOf.get(key(x, y))
				// Prefer the E neighbour, then the S neighbour — covers all grid edges.
				for (const dir of ['E', 'S'] as Dir[]) {
					const nx = x + DELTA[dir].dx
					const ny = y + DELTA[dir].dy
					if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
					if (!isPresent(present, nx, ny)) continue // never carve into a pruned cell
					if (compOf.get(key(nx, ny)) === mine) continue // same component → no help
					carve(x, y, dir)
					carve(nx, ny, opposite(dir)) // both sides → preserve edge-agreement
					carved = true
					break
				}
			}
		}
		// No present inter-component carve site (present set not 4-connected) → bail rather
		// than loop forever. pruneAndConnect prevents this by construction.
		if (!carved) break
	}

	return out
}

/** The result of pruning + connecting: the (possibly door-augmented) grid and the
 *  presence mask saying which cells survived. generateTank emits rects only for present
 *  cells, and only doors between two present cells. */
export type PrunedGrid = { grid: TileGrid; present: Present }

/** All-present mask for a w×h grid. */
function fullMask(width: number, height: number): Present {
	return Array.from({ length: height }, () => Array.from({ length: width }, () => true))
}

/** Count present cells 4-connected to (sx,sy) via the GRID (ignores doors — pure adjacency). */
function presentRegionSize(present: Present, width: number, height: number, sx: number, sy: number): number {
	const seen = new Set<string>([key(sx, sy)])
	const queue: Cell[] = [{ x: sx, y: sy }]
	let count = 0
	while (queue.length) {
		const { x, y } = queue.shift()!
		count++
		for (const dir of DIRS) {
			const nx = x + DELTA[dir].dx
			const ny = y + DELTA[dir].dy
			if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
			if (!present[ny][nx] || seen.has(key(nx, ny))) continue
			seen.add(key(nx, ny))
			queue.push({ x: nx, y: ny })
		}
	}
	return count
}

/**
 * PRUNE then CONNECT — remove a random fraction of rooms so the tank isn't a perfect grid,
 * while guaranteeing every REMAINING room is reachable from every other.
 *
 * The ordering is the whole point: we prune FIRST, then connect over the survivors. (Connect
 * first, prune second would be wrong — removing a room can re-split the survivors if it was
 * the only bridge.) And we only remove a cell if doing so keeps the present cells 4-CONNECTED
 * as a region — otherwise connectGrid could never stitch an island back in (there'd be no
 * adjacent present pair to carve a door through). So:
 *   1. start all-present; visit cells in a seeded-shuffled order.
 *   2. tentatively remove a cell with probability `removeProb`; KEEP the removal only if the
 *      remaining present cells are still one 4-connected region (a cheap flood-fill check).
 *      This naturally refuses to remove articulation points, so the survivors never fragment
 *      beyond what doors can re-join.
 *   3. strip every door that now points at a removed neighbour (no doorway-to-nowhere), both
 *      sides, via fresh Tile objects.
 *   4. connectGrid over the present mask → every surviving room reachable from every other.
 *
 * Deterministic for a given seed (so a tank reproduces). Pure: returns a new grid + mask,
 * input untouched. With removeProb 0 it's a no-op prune + the usual full connect.
 *
 * `initialMask` (optional) is the starting present-set: when given, only those cells are
 * part of the map to begin with (the rest are already absent), and pruning thins WITHIN it.
 * This is how an irregular ORGANIC-BLOB outline is fed in (see regionMask.ts) — the blob
 * replaces the full square as the starting footprint, so the final map's boundary is ragged.
 * The mask MUST be a single 4-connected region (regionMask guarantees this) or connectGrid
 * can't stitch it; cells outside it never become rooms.
 */
export function pruneAndConnect(grid: TileGrid, seed: number, removeProb: number, initialMask?: Present): PrunedGrid {
	const height = grid.length
	const width = grid[0]?.length ?? 0
	// Start from the blob mask if provided (a fresh copy so we don't mutate the caller's),
	// else the full square. Pruning only ever removes cells, never adds them back.
	const present = initialMask ? initialMask.map((row) => row.slice()) : fullMask(width, height)
	if (width === 0 || height === 0) return { grid, present }

	const rng = mulberry32(seed)
	let presentCount = 0
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (present[y][x]) presentCount++

	// A seeded shuffle of all cell coordinates (Fisher–Yates), so removals aren't biased
	// toward one corner / scan order.
	const cells: Cell[] = []
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) cells.push({ x, y })
	for (let i = cells.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1))
		;[cells[i], cells[j]] = [cells[j], cells[i]]
	}

	for (const { x, y } of cells) {
		if (presentCount <= 1) break // always keep at least one room
		if (!present[y][x]) continue // already outside the map (blob mask) — nothing to remove
		if (rng() >= removeProb) continue // this cell survives the dice roll
		// Tentatively remove; keep the removal only if the rest stays one 4-connected region.
		present[y][x] = false
		// Find any other present cell to flood from.
		let start: Cell | null = null
		for (let yy = 0; yy < height && !start; yy++)
			for (let xx = 0; xx < width && !start; xx++) if (present[yy][xx]) start = { x: xx, y: yy }
		const stillConnected = start ? presentRegionSize(present, width, height, start.x, start.y) === presentCount - 1 : false
		if (stillConnected) presentCount--
		else present[y][x] = true // undo — removing this cell would orphan part of the tank
	}

	// Strip doors that point at a now-removed neighbour, on BOTH sides (fresh Tile objects).
	const out: TileGrid = grid.map((row) => row.slice())
	const seal = (x: number, y: number, dir: Dir) => {
		const t = out[y][x]
		if (t.edges[dir] === 'wall') return
		out[y][x] = { name: `${t.name}-${dir}wall`, weight: t.weight, edges: { ...t.edges, [dir]: 'wall' } }
	}
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			for (const dir of DIRS) {
				if (out[y][x].edges[dir] !== 'door') continue
				const nx = x + DELTA[dir].dx
				const ny = y + DELTA[dir].dy
				const offGrid = nx < 0 || nx >= width || ny < 0 || ny >= height
				// A door survives only between two present cells; otherwise seal it (both sides).
				if (!present[y][x] || offGrid || !present[ny][nx]) {
					seal(x, y, dir)
					if (!offGrid) seal(nx, ny, opposite(dir))
				}
			}
		}
	}

	// Now stitch the surviving rooms into one component.
	return { grid: connectGrid(out, present), present }
}
