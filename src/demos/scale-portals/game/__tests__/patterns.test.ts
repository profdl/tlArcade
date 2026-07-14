/**
 * PATTERN tests — the fractal role seam (patterns.ts).
 * =====================================================
 * A pattern factory is `(w,h,depth,seed) => (cell) => CellRole`. These assert the two
 * properties the rest of the engine leans on:
 *   • DETERMINISM — same seed ⇒ same roles (so ?seed= reproduces the world, and a
 *     pattern swap under a fixed seed is a controlled comparison).
 *   • The ≥1-submap GUARANTEE survives every pattern — buildMapLayout promotes a cell to
 *     submap if a pattern yields all-rooms, so no scale is a dive-less dead end.
 * Plus a shape check for the self-similar patterns (sierpinski marks the 3×3 centre).
 */
import { describe, it, expect } from 'vitest'
import { PATTERNS, PATTERN_ORDER, sierpinskiPattern, type PatternName } from '../patterns'
import { buildMapLayout, type CellRole, type GridCell } from '../mapGeometry'

/** Mint sequential ids so layouts build without a real editor. */
function counter() {
	let n = 0
	return () => `rect-${n++}`
}

const cells3x3: GridCell[] = Array.from({ length: 9 }, (_, i) => ({ x: i % 3, y: Math.floor(i / 3) }))

describe('pattern registry', () => {
	it('every ordered name resolves to a factory', () => {
		for (const name of PATTERN_ORDER) expect(typeof PATTERNS[name]).toBe('function')
	})

	it('every pattern is deterministic for a fixed seed', () => {
		for (const name of PATTERN_ORDER) {
			const a = PATTERNS[name](3, 3, 0, 12345)
			const b = PATTERNS[name](3, 3, 0, 12345)
			const rolesA = cells3x3.map(a)
			const rolesB = cells3x3.map(b)
			expect(rolesA, name).toEqual(rolesB)
			// Only ever emits valid roles.
			for (const r of rolesA) expect(['room', 'submap'] satisfies CellRole[]).toContain(r)
		}
	})

	it('different seeds change the seeded patterns (grid/clustered), not the pure geometric ones', () => {
		const grid1 = cells3x3.map(PATTERNS.grid(3, 3, 0, 1))
		const grid2 = cells3x3.map(PATTERNS.grid(3, 3, 0, 999))
		expect(grid1).not.toEqual(grid2)
		// Sierpiński ignores the seed — a pure geometric carpet, identical across seeds.
		const s1 = cells3x3.map(PATTERNS.sierpinski(3, 3, 0, 1))
		const s2 = cells3x3.map(PATTERNS.sierpinski(3, 3, 0, 999))
		expect(s1).toEqual(s2)
	})
})

describe('sierpiński self-similarity', () => {
	it('at one subdivision level marks exactly the 3×3 centre cell as a submap', () => {
		// levels=1: the single central-ninth test. On a 3×3 the centre cell is the only hole.
		const roleFor = sierpinskiPattern(1)(3, 3, 0, 0)
		for (const c of cells3x3) {
			const isCentre = c.x === 1 && c.y === 1
			expect(roleFor(c), `${c.x},${c.y}`).toBe(isCentre ? 'submap' : 'room')
		}
	})

	it('marks the centre a submap at every subdivision level (at shallow depth)', () => {
		for (const levels of [1, 2, 3]) {
			expect(sierpinskiPattern(levels)(3, 3, 0, 0)({ x: 1, y: 1 }), `levels ${levels}`).toBe('submap')
		}
	})

	it('TAPERS to all-rooms at/below stopDepth so the fractal recursion terminates (bounds shape count)', () => {
		const p = sierpinskiPattern(2, 2) // stopDepth 2
		// Shallow depths keep the carpet (centre is a submap)…
		expect(p(3, 3, 0, 0)({ x: 1, y: 1 }), 'depth 0').toBe('submap')
		expect(p(3, 3, 1, 0)({ x: 1, y: 1 }), 'depth 1').toBe('submap')
		// …but at depth >= stopDepth every cell is a room, so nesting stops branching.
		for (const c of cells3x3) expect(p(3, 3, 2, 0)(c), `depth 2 ${c.x},${c.y}`).toBe('room')
		for (const c of cells3x3) expect(p(3, 3, 3, 0)(c), `depth 3 ${c.x},${c.y}`).toBe('room')
	})

	it('repeats the same centre-hole rule across the SHALLOW scales (self-similar until the taper)', () => {
		// Self-similarity is what makes the carpet read as a fractal; it holds until stopDepth,
		// where the taper deliberately stops it to bound the shape count (asserted above).
		const atRoot = cells3x3.map(sierpinskiPattern(2, 2)(3, 3, 0, 42))
		const atNext = cells3x3.map(sierpinskiPattern(2, 2)(3, 3, 1, 42))
		expect(atNext).toEqual(atRoot)
	})
})

describe('the ≥1-submap guarantee holds for every pattern (via buildMapLayout)', () => {
	// buildMapLayout force-promotes one cell to submap when a host map would otherwise be all
	// rooms, so no scale becomes a dead end — regardless of how sparse a pattern is. Sweep a few
	// seeds per pattern so a lucky all-rooms roll on some seed still ends with a submap.
	const names: PatternName[] = PATTERN_ORDER
	for (const name of names) {
		it(`${name}: a host map always ends with at least one submap`, () => {
			for (let seed = 1; seed <= 40; seed++) {
				const layout = buildMapLayout(counter(), 3, 3, seed, 0, 0, 100, 20, {
					removeProb: 0,
					hasSlots: true,
					roleFor: PATTERNS[name](3, 3, 0, seed),
					ensureSubmap: true, // the game requests this for every custom pattern
				})
				expect(layout.submaps.length, `${name} seed ${seed}`).toBeGreaterThanOrEqual(1)
			}
		})
	}
})
