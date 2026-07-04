/**
 * WFC pure-core tests — collapse + connectivity. No editor, no DOM. Vitest suite
 * (this repo runs `.test.ts` under `vitest run`; toolkit's legacy `.test.mjs`
 * files run separately). Ported from toolkit's collapse.test.mjs, minus the
 * fish-specific chooseFood cases (that export doesn't exist here).
 */
import { describe, it, expect } from 'vitest'
import { collapse, mulberry32, hasDoor } from '../collapse'
import { DELTA, opposite, DIRS } from '../tiles'
import { connectedComponents, largestComponent, connectGrid, pruneAndConnect } from '../connectivity'

describe('mulberry32', () => {
	it('is deterministic for a fixed seed and stays in [0,1)', () => {
		const a = mulberry32(123)
		const b = mulberry32(123)
		const seqA = [a(), a(), a(), a()]
		const seqB = [b(), b(), b(), b()]
		expect(seqA).toEqual(seqB)
		expect(seqA.every((v) => v >= 0 && v < 1)).toBe(true)
	})
})

describe('collapse', () => {
	it('produces a full grid of the requested size, every cell resolved', () => {
		const g = collapse(6, 5, 42)
		expect(g.length).toBe(5)
		expect(g.every((row) => row.length === 6)).toBe(true)
		expect(g.every((row) => row.every((t) => t && typeof t.name === 'string'))).toBe(true)
	})

	it('is deterministic for a fixed seed', () => {
		const a = collapse(7, 7, 999)
		const b = collapse(7, 7, 999)
		for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) expect(a[y][x].name).toBe(b[y][x].name)
	})

	it('satisfies edge-agreement across every shared border', () => {
		const g = collapse(8, 8, 7)
		const h = g.length
		const w = g[0].length
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				for (const dir of DIRS) {
					const nx = x + DELTA[dir].dx
					const ny = y + DELTA[dir].dy
					if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue
					expect(g[y][x].edges[dir]).toBe(g[ny][nx].edges[opposite(dir)])
				}
			}
		}
	})

	it('never contradicts at demo grid size (3×3) across many seeds', () => {
		// Contradictions throw; this asserts none do at the size this demo uses.
		for (let seed = 0; seed < 200; seed++) {
			expect(() => collapse(3, 3, seed)).not.toThrow()
		}
	})
})

describe('hasDoor', () => {
	it('reports the same door from both sides of a border', () => {
		const g = collapse(6, 6, 5)
		for (let y = 0; y < 6; y++) {
			for (let x = 0; x < 6; x++) {
				for (const dir of DIRS) {
					const nx = x + DELTA[dir].dx
					const ny = y + DELTA[dir].dy
					if (nx < 0 || nx >= 6 || ny < 0 || ny >= 6) continue
					expect(hasDoor(g, x, y, dir)).toBe(hasDoor(g, nx, ny, opposite(dir)))
				}
			}
		}
	})
})

describe('connectedComponents / largestComponent', () => {
	it('partition the grid, sorted largest-first, largest non-empty', () => {
		const g = collapse(8, 8, 31)
		const comps = connectedComponents(g)
		expect(comps.reduce((s, c) => s + c.length, 0)).toBe(64)
		expect(comps.every((c, i) => i === 0 || c.length <= comps[i - 1].length)).toBe(true)
		expect(largestComponent(g).length).toBeGreaterThan(0)
	})
})

describe('connectGrid', () => {
	it('makes every grid a single component while preserving edge-agreement and only adding doors', () => {
		for (let seed = 0; seed < 40; seed++) {
			const raw = collapse(6, 5, seed)
			const connected = connectGrid(raw)
			expect(connectedComponents(connected).length).toBe(1)
			for (let y = 0; y < 5; y++) {
				for (let x = 0; x < 6; x++) {
					for (const dir of DIRS) {
						const nx = x + DELTA[dir].dx
						const ny = y + DELTA[dir].dy
						if (nx < 0 || nx >= 6 || ny < 0 || ny >= 5) continue
						expect(connected[y][x].edges[dir]).toBe(connected[ny][nx].edges[opposite(dir)])
						if (raw[y][x].edges[dir] === 'door') expect(connected[y][x].edges[dir]).toBe('door')
					}
				}
			}
		}
	})

	it('is deterministic (same input → same output)', () => {
		const raw = collapse(5, 5, 808)
		const a = connectGrid(raw)
		const b = connectGrid(raw)
		for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) for (const dir of DIRS) expect(a[y][x].edges[dir]).toBe(b[y][x].edges[dir])
	})
})

describe('pruneAndConnect', () => {
	it('removes rooms but keeps survivors one reachable component, no doors to void', () => {
		for (let seed = 0; seed < 30; seed++) {
			const raw = collapse(12, 12, seed)
			const { grid, present } = pruneAndConnect(raw, seed, 0.3)
			expect(connectedComponents(grid, present).length).toBe(1)
			for (let y = 0; y < 12; y++) {
				for (let x = 0; x < 12; x++) {
					for (const dir of DIRS) {
						const nx = x + DELTA[dir].dx
						const ny = y + DELTA[dir].dy
						const off = nx < 0 || nx >= 12 || ny < 0 || ny >= 12
						const isDoor = grid[y][x].edges[dir] === 'door'
						if (!off && present[y][x] && present[ny][nx]) {
							expect(isDoor).toBe(grid[ny][nx].edges[opposite(dir)] === 'door')
						}
						if (present[y][x] && isDoor) expect(off || !present[ny][nx]).toBe(false)
					}
				}
			}
		}
	})

	it('is deterministic and treats removeProb 0 as keep-everything', () => {
		const raw = collapse(10, 10, 4242)
		const a = pruneAndConnect(raw, 4242, 0.3)
		const b = pruneAndConnect(raw, 4242, 0.3)
		for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) expect(a.present[y][x]).toBe(b.present[y][x])
		const none = pruneAndConnect(raw, 1, 0)
		expect(none.present.every((row) => row.every((p) => p))).toBe(true)
	})
})
