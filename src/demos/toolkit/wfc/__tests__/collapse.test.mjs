/**
 * WFC pure-core tests — collapse + connectivity. No editor, no DOM, so they run
 * under `node --experimental-strip-types` like the grid/referee tests.
 */
import { collapse, mulberry32, hasDoor } from '../collapse.ts'
import { DELTA, opposite, DIRS } from '../tiles.ts'
import { connectedComponents, largestComponent, chooseFood, connectGrid, pruneAndConnect } from '../connectivity.ts'

// ── PRNG determinism ──────────────────────────────────────────────────────────
{
	const a = mulberry32(123)
	const b = mulberry32(123)
	const seqA = [a(), a(), a(), a()]
	const seqB = [b(), b(), b(), b()]
	const same = seqA.every((v, i) => v === seqB[i])
	const inRange = seqA.every((v) => v >= 0 && v < 1)
	console.log('mulberry32: same seed → same sequence:', same)
	console.log('mulberry32: outputs in [0,1):', inRange)
}

// ── collapse produces a full grid of the requested size ─────────────────────────
{
	const g = collapse(6, 5, 42)
	const rightShape = g.length === 5 && g.every((row) => row.length === 6)
	const allTiles = g.every((row) => row.every((t) => t && typeof t.name === 'string'))
	console.log('collapse: grid is 5 rows × 6 cols:', rightShape)
	console.log('collapse: every cell is a resolved tile:', allTiles)
}

// ── collapse is deterministic for a fixed seed ──────────────────────────────────
{
	const a = collapse(7, 7, 999)
	const b = collapse(7, 7, 999)
	let same = true
	for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) if (a[y][x].name !== b[y][x].name) same = false
	console.log('collapse: same seed → identical grid:', same)
}

// ── EDGE-AGREEMENT invariant: every shared border matches (door↔door, wall↔wall) ─
// This is the core WFC guarantee and the thing generateTank.ts relies on to know a
// door on one side is matched by an opening on the other.
{
	const g = collapse(8, 8, 7)
	const h = g.length
	const w = g[0].length
	let ok = true
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			for (const dir of DIRS) {
				const nx = x + DELTA[dir].dx
				const ny = y + DELTA[dir].dy
				if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
				if (g[y][x].edges[dir] !== g[ny][nx].edges[opposite(dir)]) ok = false
			}
		}
	}
	console.log('collapse: every shared border has matching edges:', ok)
}

// ── hasDoor agrees with the tile edges, and is symmetric across a border ─────────
{
	const g = collapse(6, 6, 5)
	let symmetric = true
	for (let y = 0; y < 6; y++) {
		for (let x = 0; x < 6; x++) {
			for (const dir of DIRS) {
				const nx = x + DELTA[dir].dx
				const ny = y + DELTA[dir].dy
				if (nx < 0 || nx >= 6 || ny < 0 || ny >= 6) continue
				if (hasDoor(g, x, y, dir) !== hasDoor(g, nx, ny, opposite(dir))) symmetric = false
			}
		}
	}
	console.log('hasDoor: a door is the same from both sides:', symmetric)
}

// ── connectivity: components partition the grid, largest is non-empty ───────────
{
	const g = collapse(8, 8, 31)
	const comps = connectedComponents(g)
	const totalCells = comps.reduce((s, c) => s + c.length, 0)
	const partitions = totalCells === 64
	const sortedDesc = comps.every((c, i) => i === 0 || c.length <= comps[i - 1].length)
	const largest = largestComponent(g)
	console.log('connectivity: components cover all 64 cells exactly once:', partitions)
	console.log('connectivity: components sorted largest-first:', sortedDesc)
	console.log('connectivity: largest component is non-empty:', largest.length > 0)
}

// ── connectGrid makes the whole grid ONE component, across many seeds ───────────
// The core fix for "some rooms are disconnected": after stitching, every room must be
// reachable from every other, so connectedComponents returns exactly one component.
{
	let allSingle = true
	let edgesStillAgree = true
	let preservesCells = true // existing doors are never removed
	for (let seed = 0; seed < 40; seed++) {
		const raw = collapse(6, 5, seed)
		const connected = connectGrid(raw)
		// 1) exactly one component.
		if (connectedComponents(connected).length !== 1) allSingle = false
		// 2) edge-agreement invariant still holds (door↔door across every border).
		for (let y = 0; y < 5; y++) {
			for (let x = 0; x < 6; x++) {
				for (const dir of DIRS) {
					const nx = x + DELTA[dir].dx
					const ny = y + DELTA[dir].dy
					if (nx < 0 || nx >= 6 || ny < 0 || ny >= 5) continue
					if (connected[y][x].edges[dir] !== connected[ny][nx].edges[opposite(dir)]) edgesStillAgree = false
				}
			}
		}
		// 3) connecting only ADDS doors — every original door is still a door.
		for (let y = 0; y < 5; y++)
			for (let x = 0; x < 6; x++)
				for (const dir of DIRS) if (raw[y][x].edges[dir] === 'door' && connected[y][x].edges[dir] !== 'door') preservesCells = false
	}
	console.log('connectGrid: every grid becomes a single component (40 seeds):', allSingle)
	console.log('connectGrid: edge-agreement (door↔door) preserved:', edgesStillAgree)
	console.log('connectGrid: only adds doors, never removes them:', preservesCells)
}

// ── connectGrid is deterministic and leaves the input grid untouched (pure) ──────
{
	const raw = collapse(5, 5, 808)
	const a = connectGrid(raw)
	const b = connectGrid(raw)
	let same = true
	for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) for (const dir of DIRS) if (a[y][x].edges[dir] !== b[y][x].edges[dir]) same = false
	console.log('connectGrid: deterministic (same input → same output):', same)
}

// ── pruneAndConnect: removes rooms but keeps survivors ONE reachable component ───
// The requirement: after randomly removing rooms, every REMAINING room must still be
// reachable from every other. Checked over many seeds, a big grid, a healthy remove rate.
{
	let allSingle = true
	let actuallyRemoved = false // pruning really drops some rooms (not a no-op)
	let edgesAgree = true // sealing/carving keeps door↔door symmetry over present cells
	let noDoorToVoid = true // no surviving door points at a removed (or off-grid) cell
	for (let seed = 0; seed < 30; seed++) {
		const raw = collapse(12, 12, seed)
		const { grid, present } = pruneAndConnect(raw, seed, 0.3)
		const comps = connectedComponents(grid, present)
		if (comps.length !== 1) allSingle = false
		// Count present cells; with removeProb 0.3 on 144 cells, some must be gone.
		let presentCount = 0
		for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) if (present[y][x]) presentCount++
		if (presentCount < 144) actuallyRemoved = true
		for (let y = 0; y < 12; y++) {
			for (let x = 0; x < 12; x++) {
				for (const dir of DIRS) {
					const nx = x + DELTA[dir].dx
					const ny = y + DELTA[dir].dy
					const off = nx < 0 || nx >= 12 || ny < 0 || ny >= 12
					const isDoor = grid[y][x].edges[dir] === 'door'
					// door↔door symmetry across present in-grid borders
					if (!off && present[y][x] && present[ny][nx]) {
						if (isDoor !== (grid[ny][nx].edges[opposite(dir)] === 'door')) edgesAgree = false
					}
					// a door on a PRESENT cell must lead to a present in-grid cell
					if (present[y][x] && isDoor && (off || !present[ny][nx])) noDoorToVoid = false
				}
			}
		}
	}
	console.log('pruneAndConnect: survivors are ONE reachable component (30 seeds, 12×12):', allSingle)
	console.log('pruneAndConnect: actually removes rooms (not a no-op):', actuallyRemoved)
	console.log('pruneAndConnect: door↔door symmetry preserved over present cells:', edgesAgree)
	console.log('pruneAndConnect: no surviving door points at a removed/off-grid cell:', noDoorToVoid)
}

// ── pruneAndConnect determinism + purity ────────────────────────────────────────
{
	const raw = collapse(10, 10, 4242)
	const a = pruneAndConnect(raw, 4242, 0.3)
	const b = pruneAndConnect(raw, 4242, 0.3)
	let same = a.present.length === b.present.length
	for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) if (a.present[y][x] !== b.present[y][x]) same = false
	console.log('pruneAndConnect: deterministic for a fixed seed:', same)
	// removeProb 0 → nothing removed (all present), still single-component.
	const none = pruneAndConnect(raw, 1, 0)
	let allPresent = true
	for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) if (!none.present[y][x]) allPresent = false
	console.log('pruneAndConnect: removeProb 0 keeps every room:', allPresent)
}

// ── food is chosen only from the (reachable) region, spread, count-capped ────────
{
	const g = collapse(8, 8, 77)
	const region = largestComponent(g)
	const regionSet = new Set(region.map((c) => `${c.x},${c.y}`))
	const food = chooseFood(region, 5)
	const allInRegion = food.every((c) => regionSet.has(`${c.x},${c.y}`))
	const capped = food.length <= 5 && food.length <= region.length
	console.log('chooseFood: every pellet is in the reachable region:', allInRegion)
	console.log('chooseFood: count is capped to request and region size:', capped)
	console.log('chooseFood: 0 requested → no pellets:', chooseFood(region, 0).length === 0)
}
