/**
 * REGION MASK tests — the irregular organic-blob outline.
 * Pure (no tldraw), so it runs under `node --experimental-strip-types`.
 */
import { buildRegionMask } from '../regionMask.ts'
import { DELTA, DIRS } from '../tiles.ts'

const key = (x, y) => `${x},${y}`

/** Count true cells in a mask. */
function fill(mask, w, h) {
	let c = 0
	for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y][x]) c++
	return c
}

/** Number of 4-connected components of the true cells. */
function components(mask, w, h) {
	const seen = new Set()
	let n = 0
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			if (!mask[y][x] || seen.has(key(x, y))) continue
			n++
			const q = [{ x, y }]
			seen.add(key(x, y))
			while (q.length) {
				const cur = q.shift()
				for (const dir of DIRS) {
					const nx = cur.x + DELTA[dir].dx
					const ny = cur.y + DELTA[dir].dy
					if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
					if (!mask[ny][nx] || seen.has(key(nx, ny))) continue
					seen.add(key(nx, ny))
					q.push({ x: nx, y: ny })
				}
			}
		}
	}
	return n
}

/** Does the mask touch ALL four borders fully (i.e. still a full square)? */
function isFullSquare(mask, w, h) {
	for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!mask[y][x]) return false
	return true
}

const W = 12, H = 12
for (const seed of [1, 2, 3, 7, 42, 100, 2024]) {
	const mask = buildRegionMask(W, H, seed, 0.5)
	const f = fill(mask, W, H)
	const comps = components(mask, W, H)
	const frac = f / (W * H)

	console.log(`seed ${String(seed).padStart(4)}: ONE connected blob (no islands):`, comps === 1)
	console.log(`seed ${String(seed).padStart(4)}: NOT a full square (irregular outline):`, !isFullSquare(mask, W, H))
	console.log(`seed ${String(seed).padStart(4)}: fill ${(frac * 100).toFixed(0)}% in carved range (25–65%):`, frac >= 0.25 && frac <= 0.65)
	console.log(`seed ${String(seed).padStart(4)}: keeps a real region (≥8 cells):`, f >= 8)
}

// Determinism.
{
	const a = buildRegionMask(W, H, 555, 0.5)
	const b = buildRegionMask(W, H, 555, 0.5)
	let same = true
	for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (a[y][x] !== b[y][x]) same = false
	console.log('determinism: same seed → identical mask:', same)
}
