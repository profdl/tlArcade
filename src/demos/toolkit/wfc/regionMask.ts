/**
 * REGION MASK — carve the square grid into an irregular ORGANIC BLOB.
 * ===================================================================
 * Uniform random pruning thins the grid evenly but keeps its SQUARE footprint — the
 * overall silhouette stays a rectangle. To make the map's outline irregular we instead
 * decide, BEFORE pruning, which cells even belong to the map: we keep a blobby region
 * (lobes, bays, peninsulas) and discard the rest, so the boundary is ragged.
 *
 * HOW (pure, seeded, deterministic):
 *   • A few seeded "blob centres" are scattered on the grid; each contributes a smooth
 *     RADIAL falloff (1 at its centre, fading out with distance). Summed, they make an
 *     organic multi-lobed field — denser where centres cluster, thin at the edges.
 *   • A little seeded value-NOISE perturbs the field so the boundary is wobbly, not a
 *     clean union of circles.
 *   • Keep a cell when field > threshold; the threshold is auto-tuned (bisection) so the
 *     kept fraction lands near a target (~0.5) regardless of seed.
 *   • Finally keep only the LARGEST 4-connected component, so the base region is a single
 *     connected blob (no detached islands) with a ragged outline — exactly what
 *     pruneAndConnect needs as a starting present-set.
 *
 * No tldraw import → unit-tested under `yarn test`. connectivity.ts consumes the mask.
 */
import { mulberry32 } from './collapse.ts'
import { DELTA, DIRS } from './tiles.ts'
import type { Present } from './connectivity.ts'

const key = (x: number, y: number) => `${x},${y}`

/** Smooth radial falloff: 1 at distance 0, easing to 0 at `radius`, 0 beyond. */
function falloff(dist: number, radius: number): number {
	if (dist >= radius) return 0
	const t = 1 - dist / radius // 1 → 0 across the radius
	return t * t * (3 - 2 * t) // smoothstep for a rounded lobe
}

/** Largest 4-connected component of a boolean mask, as a new mask (others cleared). */
function largestMaskComponent(mask: Present, width: number, height: number): Present {
	const seen = new Set<string>()
	let best: Array<{ x: number; y: number }> = []
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (!mask[y][x] || seen.has(key(x, y))) continue
			const comp: Array<{ x: number; y: number }> = []
			const queue = [{ x, y }]
			seen.add(key(x, y))
			while (queue.length) {
				const cur = queue.shift()!
				comp.push(cur)
				for (const dir of DIRS) {
					const nx = cur.x + DELTA[dir].dx
					const ny = cur.y + DELTA[dir].dy
					if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue
					if (!mask[ny][nx] || seen.has(key(nx, ny))) continue
					seen.add(key(nx, ny))
					queue.push({ x: nx, y: ny })
				}
			}
			if (comp.length > best.length) best = comp
		}
	}
	const out: Present = Array.from({ length: height }, () => Array.from({ length: width }, () => false))
	for (const c of best) out[c.y][c.x] = true
	return out
}

/**
 * Build an irregular organic-blob region mask over a `width × height` grid. `targetFill`
 * is the rough fraction of cells to keep (~0.5 by default); the actual kept fraction lands
 * near it via threshold bisection, then trimming to the largest component lowers it a bit.
 * Deterministic for a given seed. Returns a Present mask (true = in the map).
 */
export function buildRegionMask(width: number, height: number, seed: number, targetFill = 0.5): Present {
	const rng = mulberry32((seed ^ 0x27d4eb2f) >>> 0)

	// Scatter 2–4 blob centres, each with its own radius, biased toward the grid interior
	// so lobes reach outward but the mass stays roughly centred.
	const nCenters = 2 + Math.floor(rng() * 3)
	const centers: { cx: number; cy: number; r: number }[] = []
	const maxDim = Math.max(width, height)
	for (let i = 0; i < nCenters; i++) {
		centers.push({
			cx: width * (0.25 + 0.5 * rng()),
			cy: height * (0.25 + 0.5 * rng()),
			r: maxDim * (0.35 + 0.35 * rng()),
		})
	}

	// Per-cell field: summed radial falloff + a little value noise (seeded per cell).
	const field: number[][] = Array.from({ length: height }, () => new Array(width).fill(0))
	let lo = Infinity
	let hi = -Infinity
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			let v = 0
			for (const c of centers) {
				const d = Math.hypot(x + 0.5 - c.cx, y + 0.5 - c.cy)
				v += falloff(d, c.r)
			}
			// Deterministic per-cell noise in [-0.25, 0.25] to wobble the boundary.
			const n = mulberry32(((x * 73856093) ^ (y * 19349663) ^ seed) >>> 0)()
			v += (n - 0.5) * 0.5
			field[y][x] = v
			if (v < lo) lo = v
			if (v > hi) hi = v
		}
	}

	// Bisect a threshold so the kept fraction ≈ targetFill.
	const total = width * height
	const keptAt = (thresh: number) => {
		let c = 0
		for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (field[y][x] >= thresh) c++
		return c
	}
	let tLo = lo
	let tHi = hi
	let thresh = (lo + hi) / 2
	for (let iter = 0; iter < 24; iter++) {
		const frac = keptAt(thresh) / total
		if (frac > targetFill) tLo = thresh
		else tHi = thresh
		thresh = (tLo + tHi) / 2
	}

	const mask: Present = Array.from({ length: height }, () => new Array(width).fill(false))
	for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) mask[y][x] = field[y][x] >= thresh

	// Single connected blob, ragged outline — drop any detached islands.
	return largestMaskComponent(mask, width, height)
}
