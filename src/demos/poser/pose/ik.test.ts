import { describe, expect, it } from 'vitest'
import { bendSignFromRest, normalizeAngle, solveTwoBone, type Vec2 } from './ik'

/** Reconstruct the tip position from a solution, to check the solver actually reaches. */
function tipOf(root: Vec2, l1: number, l2: number, s: { rootAngle: number; effectorAngle: number }): Vec2 {
	const mid = { x: root.x + l1 * Math.cos(s.rootAngle), y: root.y + l1 * Math.sin(s.rootAngle) }
	return { x: mid.x + l2 * Math.cos(s.effectorAngle), y: mid.y + l2 * Math.sin(s.effectorAngle) }
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y)

describe('solveTwoBone', () => {
	const root: Vec2 = { x: 100, y: 100 }
	const l1 = 60
	const l2 = 50

	it('reaches a target inside the reachable annulus exactly', () => {
		const target: Vec2 = { x: 180, y: 150 } // dist ~94.3, within [10, 110]
		const s = solveTwoBone(root, l1, l2, target, 1)
		expect(s.reachable).toBe(true)
		expect(dist(tipOf(root, l1, l2, s), target)).toBeLessThan(1e-6)
	})

	it('points at and fully extends toward an unreachable (too-far) target', () => {
		const target: Vec2 = { x: 400, y: 100 } // dist 300 > maxReach 110
		const s = solveTwoBone(root, l1, l2, target, 1)
		expect(s.reachable).toBe(false)
		// Tip lands on the ray root→target at the max reach distance.
		const tip = tipOf(root, l1, l2, s)
		expect(dist(root, tip)).toBeCloseTo(l1 + l2, 3)
		// And the limb is (nearly) straight: both bones share the base direction.
		expect(Math.abs(normalizeAngle(s.effectorAngle - s.rootAngle))).toBeLessThan(1e-3)
	})

	it('folds toward a too-close target (inside the inner radius)', () => {
		const close: Vec2 = { x: 105, y: 100 } // dist 5 < |l1-l2| = 10
		const s = solveTwoBone(root, l1, l2, close, 1)
		expect(s.reachable).toBe(false)
		// Tip lands at the minimum reach distance from the root.
		expect(dist(root, tipOf(root, l1, l2, s))).toBeCloseTo(Math.abs(l1 - l2), 3)
	})

	it('returns finite angles pointing at the target when a bone collapses (empty annulus)', () => {
		// l2 = 0 makes minReach == maxReach == l1: the reachable annulus is a single
		// circle, so the `dist` clamp would invert. The guard must return finite angles
		// aimed at the target rather than NaN.
		const target: Vec2 = { x: 200, y: 100 } // straight right of the root
		const s = solveTwoBone(root, l1, 0, target, 1)
		expect(Number.isFinite(s.rootAngle)).toBe(true)
		expect(Number.isFinite(s.effectorAngle)).toBe(true)
		expect(s.reachable).toBe(false)
		expect(normalizeAngle(s.rootAngle)).toBeCloseTo(0) // atan2 toward +x
	})

	it('bendSign flips the middle joint to the mirror solution', () => {
		const target: Vec2 = { x: 170, y: 160 }
		const up = solveTwoBone(root, l1, l2, target, 1)
		const down = solveTwoBone(root, l1, l2, target, -1)
		// Both reach the same tip...
		expect(dist(tipOf(root, l1, l2, up), target)).toBeLessThan(1e-6)
		expect(dist(tipOf(root, l1, l2, down), target)).toBeLessThan(1e-6)
		// ...but via mirrored bends (different bone-1 angle).
		expect(Math.abs(normalizeAngle(up.rootAngle - down.rootAngle))).toBeGreaterThan(1e-3)
	})

	it('bendSignFromRest recovers the sign the pose is currently bent in', () => {
		// A target that resolves to a clearly-bent pose.
		const target: Vec2 = { x: 150, y: 180 }
		for (const sign of [1, -1] as const) {
			const s = solveTwoBone(root, l1, l2, target, sign)
			expect(bendSignFromRest(s.rootAngle, s.effectorAngle)).toBe(sign)
		}
	})
})

describe('normalizeAngle', () => {
	it('wraps into (-π, π]', () => {
		expect(normalizeAngle(0)).toBeCloseTo(0)
		expect(normalizeAngle(Math.PI * 2)).toBeCloseTo(0)
		expect(normalizeAngle(Math.PI * 3)).toBeCloseTo(Math.PI)
		expect(normalizeAngle(-Math.PI * 1.5)).toBeCloseTo(Math.PI * 0.5)
	})
})
