import { describe, it, expect } from 'vitest'
import { decomposeConvex, type P } from './decompose'

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
