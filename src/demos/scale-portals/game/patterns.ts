/**
 * ROLE PATTERNS — the fractal seam of Scale Portals.
 * ====================================================
 * `buildMapLayout` takes a PLUGGABLE `roleFor: (cell) => CellRole` (mapGeometry.ts) that
 * decides, per present cell, whether it's a plain ROOM or a SUBMAP slot (a whole nested map).
 * The default is a seeded coin flip — a plain grid of rooms sprinkled with dive points. This
 * module offers RICHER rules so the *pattern of where you can dive* becomes structure, not noise.
 *
 * WHY THIS MAKES THINGS FRACTAL. The engine already recurses: every submap hosts another map
 * built by the SAME `buildMapLayout`. So if the role rule is SELF-SIMILAR — the same motif of
 * submap-vs-room at every scale — the scale-tree becomes a literal fractal: zoom into a submap
 * and you meet the same pattern again, smaller. A pattern factory is
 * `(w, h, depth, seed) => (cell) => CellRole`: it sees the grid size, the current nesting depth,
 * and a seed, and returns the per-cell role function `buildMapLayout` expects. Depth is passed
 * so a rule *can* vary by scale (most don't — self-similarity is the point), and `seed` is the
 * map's own seed so every pattern stays deterministic and `?seed=` still reproduces the world.
 *
 * INVARIANTS THE PATTERNS RELY ON (all enforced downstream in buildMapLayout, so patterns stay
 * pure and carefree):
 *   • The SPAWN cell and every GATE cell are force-`room` regardless of what a pattern returns —
 *     you must be able to stand where you arrive. A pattern never needs to special-case them.
 *   • A host map is GUARANTEED ≥1 submap: if a pattern yields all-rooms on some map, the cell
 *     that flipped closest to submap is promoted, so no scale becomes a dive-less dead end.
 * A pattern is therefore free to be sparse, or to starve a small/pruned grid — the floor of one
 * submap always holds. `validateWorldTree` (swept across 300 seeds) still asserts every tunnel
 * keeps its gate + portal for whatever pattern is active, so a broken rule fails loudly.
 */
import { mulberry32 } from '../wfc/collapse.ts'
import type { CellRole, GridCell } from './mapGeometry.ts'

/** A role rule for one map: given its size/depth/seed, decide each present cell's role. */
export type RoleForFn = (cell: GridCell) => CellRole
export type PatternFactory = (w: number, h: number, depth: number, seed: number) => RoleForFn

/** A stable per-cell hash in [0,1), seeded by the map seed + cell — matches the coin-flip the
 *  default role function used, so `grid` reproduces the original worlds bit-for-bit. */
function cellNoise(seed: number, cell: GridCell): number {
	return mulberry32((seed ^ (cell.x * 73856093) ^ (cell.y * 19349663) ^ 0x5f356495) >>> 0)()
}

/**
 * GRID — the original, simplest map: an independent seeded coin flip per cell. Any cell is a
 * submap with probability `prob`. No spatial structure; the baseline every other pattern departs
 * from. (This IS the default role function inlined here, so selecting `grid` is a no-op change.)
 */
export function gridPattern(prob = 0.5): PatternFactory {
	return (_w, _h, _depth, seed) => (cell) => (cellNoise(seed, cell) < prob ? 'submap' : 'room')
}

/**
 * SIERPIŃSKI — a self-similar carpet. Map the cell to the [0,1) unit square and mark it a submap
 * iff it lands in the recursively-removed "hole" set of a Sierpiński carpet (the central ninth at
 * every subdivision). Because EVERY submap recurses the same rule at the next scale, the carpet
 * literally continues as you dive: the same holes-within-holes motif repeats at every zoom. Works
 * at any grid size (the unit-square mapping is size-agnostic); on a 3×3 it marks exactly the
 * centre cell each level, so the fractal is crispest there. `levels` bounds how many subdivisions
 * we test (2 is plenty for the small grids here).
 *
 * DEPTH TAPER — the count problem. A self-similar rule that marks submaps at EVERY scale branches
 * geometrically: every submap builds a full child map that itself has submaps, so the eager
 * whole-tree build (gameLoop) explodes — Sierpiński to ~4000 shapes, enough to choke tldraw. So
 * beyond `stopDepth` the rule returns all-rooms, terminating the recursion. You still read the
 * carpet at the scales you actually see (root + first dive); only the deepest, barely-visible
 * scale goes rooms-only, which roughly thirds the shape count (stopDepth 2 → ~1400 shapes, in
 * line with the grid pattern). Bump stopDepth only alongside a smaller grid or a lower MAX_DEPTH.
 */
export function sierpinskiPattern(levels = 2, stopDepth = 2): PatternFactory {
	// Geometry only (ignores seed); depth gates the taper so the fractal recursion terminates.
	return (w, h, depth) => (cell) => {
		if (depth >= stopDepth) return 'room' // taper: deepest scales are rooms-only (see above)
		// Sample the cell's centre in [0,1)^2, then run the carpet test: at each of `levels`
		// subdivisions into thirds, if BOTH coords fall in the middle third, it's a hole (submap).
		let u = (cell.x + 0.5) / w
		let v = (cell.y + 0.5) / h
		for (let i = 0; i < levels; i++) {
			const cu = Math.floor(u * 3)
			const cv = Math.floor(v * 3)
			if (cu === 1 && cv === 1) return 'submap'
			u = u * 3 - cu
			v = v * 3 - cv
		}
		return 'room'
	}
}

/**
 * CLUSTERED — organic blobs of deep nesting. Two-pass: a sparse set of seed cells flip submap by
 * coin (probability `seedProb`), then any cell ORTHOGONALLY adjacent to a seed also flips submap
 * with a higher probability `growProb`. The result clumps — pockets of dense diving next to open
 * rooms — rather than the even sprinkle of `grid`. Both passes are seeded, so it stays
 * deterministic; adjacency is computed against the grid coords, blind to pruning (a pruned
 * neighbour just never becomes a cell, which is fine).
 */
export function clusteredPattern(seedProb = 0.18, growProb = 0.55): PatternFactory {
	return (_w, _h, _depth, seed) => {
		const isSeed = (c: GridCell) => cellNoise(seed, c) < seedProb
		return (cell) => {
			if (isSeed(cell)) return 'submap'
			const neighbours: GridCell[] = [
				{ x: cell.x - 1, y: cell.y },
				{ x: cell.x + 1, y: cell.y },
				{ x: cell.x, y: cell.y - 1 },
				{ x: cell.x, y: cell.y + 1 },
			]
			if (neighbours.some(isSeed)) {
				// A second, cell-distinct draw so growth isn't just the seed test again.
				return mulberry32((seed ^ (cell.x * 2246822519) ^ (cell.y * 3266489917) ^ 0x9e3779b9) >>> 0)() < growProb
					? 'submap'
					: 'room'
			}
			return 'room'
		}
	}
}

/**
 * RINGS — a concentric shell pattern: cells on EVEN Chebyshev rings from the grid centre are
 * submaps, odd rings are rooms (with a light seeded jitter so it's not perfectly mechanical).
 * Because the centre ring alternates the same way at every scale, diving through a submap ring
 * lands you in a map whose own rings continue the alternation — a target-like nested motif.
 */
export function ringsPattern(jitter = 0.15): PatternFactory {
	return (w, h, _depth, seed) => (cell) => {
		const cx = (w - 1) / 2
		const cy = (h - 1) / 2
		const ring = Math.round(Math.max(Math.abs(cell.x - cx), Math.abs(cell.y - cy)))
		const base = ring % 2 === 0 ? 'submap' : 'room'
		// Flip a small fraction of cells to soften the rings into something more organic.
		if (cellNoise(seed, cell) < jitter) return base === 'submap' ? 'room' : 'submap'
		return base
	}
}

/**
 * THE PATTERN REGISTRY. Names are the UI labels; each entry is a ready-to-use factory with tuned
 * defaults. `grid` is first (the simple baseline). Add a pattern by adding one entry here — App's
 * preset buttons render straight off `PATTERN_ORDER`, so no wiring beyond this file.
 */
export const PATTERNS = {
	grid: gridPattern(0.5),
	sparse: gridPattern(0.25),
	dense: gridPattern(0.7),
	sierpinski: sierpinskiPattern(2),
	clustered: clusteredPattern(),
	rings: ringsPattern(),
} satisfies Record<string, PatternFactory>

export type PatternName = keyof typeof PATTERNS

/** Display order for the preset UI — simplest first, most structured last. */
export const PATTERN_ORDER: PatternName[] = ['grid', 'sparse', 'dense', 'sierpinski', 'clustered', 'rings']

/** Human labels for the preset buttons (kebab → Title Case, with nicer names where it helps). */
export const PATTERN_LABELS: Record<PatternName, string> = {
	grid: 'Grid',
	sparse: 'Sparse',
	dense: 'Dense',
	sierpinski: 'Sierpiński',
	clustered: 'Clustered',
	rings: 'Rings',
}
