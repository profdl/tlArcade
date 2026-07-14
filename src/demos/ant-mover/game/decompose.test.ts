import { describe, it, expect } from 'vitest'
import { decomposeConvex, convexHull, thickBar, type P } from './decompose'

/** Signed area ×2 (CCW positive). */
function area2(poly: P[]): number {
	let a = 0
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y)
	}
	return a
}
function areaOf(poly: P[]): number {
	return Math.abs(area2(poly)) / 2
}
/** Every interior turn is a left turn (CCW) → convex. */
function isConvexCCW(poly: P[]): boolean {
	if (poly.length < 3) return false
	for (let i = 0; i < poly.length; i++) {
		const a = poly[(i - 1 + poly.length) % poly.length]
		const b = poly[i]
		const c = poly[(i + 1) % poly.length]
		const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
		if (cross < -1e-6) return false
	}
	return true
}

describe('decomposeConvex', () => {
	it('leaves a convex quad as a single piece', () => {
		const square: P[] = [
			{ x: 0, y: 0 },
			{ x: 2, y: 0 },
			{ x: 2, y: 2 },
			{ x: 0, y: 2 },
		]
		const pieces = decomposeConvex(square)
		expect(pieces).toHaveLength(1)
		expect(areaOf(pieces[0])).toBeCloseTo(4)
	})

	it('emits only convex pieces for a concave L-shape', () => {
		// An L (concave): area = 3 unit squares.
		const L: P[] = [
			{ x: 0, y: 0 },
			{ x: 2, y: 0 },
			{ x: 2, y: 1 },
			{ x: 1, y: 1 },
			{ x: 1, y: 2 },
			{ x: 0, y: 2 },
		]
		const pieces = decomposeConvex(L)
		expect(pieces.length).toBeGreaterThanOrEqual(1)
		for (const p of pieces) expect(isConvexCCW(p)).toBe(true)
		const total = pieces.reduce((s, p) => s + areaOf(p), 0)
		expect(total).toBeCloseTo(3)
	})

	it('preserves total area for a concave T (the classic load)', () => {
		// A T outline: crossbar 6 wide ×1 (area 6) + stem 2 wide ×3 (area 6) = 12.
		const T: P[] = [
			{ x: 0, y: 0 },
			{ x: 6, y: 0 },
			{ x: 6, y: 1 },
			{ x: 4, y: 1 },
			{ x: 4, y: 4 },
			{ x: 2, y: 4 },
			{ x: 2, y: 1 },
			{ x: 0, y: 1 },
		]
		const pieces = decomposeConvex(T)
		for (const p of pieces) expect(isConvexCCW(p)).toBe(true)
		const total = pieces.reduce((s, p) => s + areaOf(p), 0)
		expect(total).toBeCloseTo(12)
	})

	it('handles clockwise-wound input (reverses to CCW)', () => {
		const cwSquare: P[] = [
			{ x: 0, y: 0 },
			{ x: 0, y: 2 },
			{ x: 2, y: 2 },
			{ x: 2, y: 0 },
		]
		const pieces = decomposeConvex(cwSquare)
		expect(pieces.length).toBeGreaterThanOrEqual(1)
		for (const p of pieces) expect(isConvexCCW(p)).toBe(true)
		const total = pieces.reduce((s, p) => s + areaOf(p), 0)
		expect(total).toBeCloseTo(4)
	})

	it('respects the vertex cap (never emits > maxVerts)', () => {
		// A regular-ish octagon; with a low cap it should split into smaller pieces.
		const oct: P[] = [
			{ x: 1, y: 0 },
			{ x: 3, y: 0 },
			{ x: 4, y: 1 },
			{ x: 4, y: 3 },
			{ x: 3, y: 4 },
			{ x: 1, y: 4 },
			{ x: 0, y: 3 },
			{ x: 0, y: 1 },
		]
		const pieces = decomposeConvex(oct, 4)
		for (const p of pieces) {
			expect(p.length).toBeLessThanOrEqual(4)
			expect(isConvexCCW(p)).toBe(true)
		}
	})

	it('returns [] for degenerate input', () => {
		expect(decomposeConvex([{ x: 0, y: 0 }])).toEqual([])
		expect(
			decomposeConvex([
				{ x: 0, y: 0 },
				{ x: 1, y: 0 },
			])
		).toEqual([])
	})
})

describe('convexHull', () => {
	it('wraps a self-intersecting figure-8 into one convex solid', () => {
		// A figure-8 is NOT simple, so decomposeConvex can't fill it correctly; the
		// hull gives a valid convex solid to fall back on.
		const fig8: P[] = [
			{ x: 0, y: 0 },
			{ x: 4, y: 2 },
			{ x: 0, y: 4 },
			{ x: 4, y: 0 },
			{ x: 8, y: 4 },
			{ x: 4, y: 2 },
		]
		const hull = convexHull(fig8)
		expect(isConvexCCW(hull)).toBe(true)
		expect(areaOf(hull)).toBeGreaterThan(0)
	})

	it('ignores interior points', () => {
		const pts: P[] = [
			{ x: 0, y: 0 },
			{ x: 4, y: 0 },
			{ x: 4, y: 4 },
			{ x: 0, y: 4 },
			{ x: 2, y: 2 }, // interior — must not appear on the hull
		]
		const hull = convexHull(pts)
		expect(areaOf(hull)).toBeCloseTo(16)
		expect(hull.some((p) => p.x === 2 && p.y === 2)).toBe(false)
	})

	it('returns [] for collinear points (no area to hull)', () => {
		expect(
			convexHull([
				{ x: 0, y: 0 },
				{ x: 1, y: 0 },
				{ x: 2, y: 0 },
			])
		).toEqual([])
	})
})

describe('thickBar', () => {
	it('inflates a straight line into a min-thickness rectangle', () => {
		// A horizontal segment (zero area) → a 10-long × 4-thick bar (area 40).
		const line: P[] = [
			{ x: 0, y: 0 },
			{ x: 5, y: 0 },
			{ x: 10, y: 0 },
		]
		const bar = thickBar(line, 4)
		expect(bar).toHaveLength(4)
		expect(isConvexCCW(bar)).toBe(true)
		expect(areaOf(bar)).toBeCloseTo(40)
	})

	it('keeps a stroke that is already wider than the floor', () => {
		// A stroke 10 long that already bows 6 wide keeps its 6, not the 2 floor.
		const bowed: P[] = [
			{ x: 0, y: 0 },
			{ x: 5, y: 6 },
			{ x: 10, y: 0 },
		]
		const bar = thickBar(bowed, 2)
		expect(areaOf(bar)).toBeCloseTo(60)
	})

	it('returns [] for a single point (no extent)', () => {
		expect(thickBar([{ x: 3, y: 3 }], 4)).toEqual([])
	})
})
