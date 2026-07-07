/**
 * Engine — 2-bone IK solver unit tests.
 *
 * The core property: FK of the solved angles lands the foot ON the target. We build
 * the foot position forward from the solution (hip + thigh vector + shin vector) and
 * assert it matches the requested target — the round-trip that proves the closed-form
 * math, independent of how the angles are derived.
 */
import { describe, expect, it } from 'vitest'
import { solveTwoBoneIk } from './ik'

/** Forward kinematics: the foot world position from a solved chain rooted at (0,0). */
function footOf(thigh: number, shin: number, l1: number, l2: number) {
  const knee = { x: Math.cos(thigh) * l1, y: Math.sin(thigh) * l1 }
  return { x: knee.x + Math.cos(shin) * l2, y: knee.y + Math.sin(shin) * l2 }
}

describe('solveTwoBoneIk', () => {
  it('places the foot exactly on a reachable target (FK round-trip)', () => {
    const l1 = 20
    const l2 = 18
    // Sweep a grid of reachable targets and confirm each round-trips.
    for (const bx of [-10, 0, 12, 25]) {
      for (const by of [5, 15, 30]) {
        const d = Math.hypot(bx, by)
        if (d >= l1 + l2 || d <= Math.abs(l1 - l2)) continue // skip unreachable
        const sol = solveTwoBoneIk({ x: bx, y: by }, l1, l2, 1)
        const foot = footOf(sol.thigh, sol.shin, l1, l2)
        expect(foot.x).toBeCloseTo(bx, 6)
        expect(foot.y).toBeCloseTo(by, 6)
        expect(sol.clamped).toBe(false)
      }
    }
  })

  it('bendSign mirrors the knee to the opposite side (same foot, different knee)', () => {
    const l1 = 20
    const l2 = 20
    const target = { x: 6, y: 28 }
    const a = solveTwoBoneIk(target, l1, l2, 1)
    const b = solveTwoBoneIk(target, l1, l2, -1)
    // Both reach the foot.
    const fa = footOf(a.thigh, a.shin, l1, l2)
    const fb = footOf(b.thigh, b.shin, l1, l2)
    expect(fa.x).toBeCloseTo(target.x, 6)
    expect(fb.x).toBeCloseTo(target.x, 6)
    // But the knees sit on opposite sides of the hip→foot line.
    const kneeA = { x: Math.cos(a.thigh) * l1, y: Math.sin(a.thigh) * l1 }
    const kneeB = { x: Math.cos(b.thigh) * l1, y: Math.sin(b.thigh) * l1 }
    // Cross product of hip→foot with hip→knee flips sign between the two solutions.
    const cross = (k: { x: number; y: number }) => target.x * k.y - target.y * k.x
    expect(Math.sign(cross(kneeA))).toBe(-Math.sign(cross(kneeB)))
  })

  it('clamps to full extension when the target is out of reach (points straight at it)', () => {
    const l1 = 20
    const l2 = 20
    const far = { x: 50, y: 0 } // d = 50 > 40 = l1+l2
    const sol = solveTwoBoneIk(far, l1, l2, 1)
    expect(sol.clamped).toBe(true)
    expect(sol.thigh).toBeCloseTo(0, 9) // straight toward the target
    expect(sol.shin).toBeCloseTo(0, 9)
    // The extended foot sits at l1+l2 along the target direction (as close as it can).
    const foot = footOf(sol.thigh, sol.shin, l1, l2)
    expect(Math.hypot(foot.x, foot.y)).toBeCloseTo(l1 + l2, 9)
  })

  it('a straight-down target extends the leg straight down (knee unbent)', () => {
    const l1 = 20
    const l2 = 20
    // Target just short of full reach, straight down (+y). Near full extension the
    // thigh/shin sit close to π/2 with only a small residual bend (~0.07 rad here).
    const sol = solveTwoBoneIk({ x: 0, y: 39.9 }, l1, l2, 1)
    expect(sol.thigh).toBeCloseTo(Math.PI / 2, 0) // within ~0.5 rad
    expect(sol.shin).toBeCloseTo(Math.PI / 2, 0)
    // The knee bend is small (leg nearly straight): thigh and shin differ little.
    expect(Math.abs(sol.thigh - sol.shin)).toBeLessThan(0.2)
    // And the foot lands on the target.
    const foot = footOf(sol.thigh, sol.shin, l1, l2)
    expect(foot.y).toBeCloseTo(39.9, 6)
  })

  it('never returns NaN, even for degenerate targets', () => {
    for (const t of [{ x: 0, y: 0 }, { x: 0.0001, y: 0 }, { x: 100, y: 100 }]) {
      const sol = solveTwoBoneIk(t, 20, 18, 1)
      expect(Number.isFinite(sol.thigh)).toBe(true)
      expect(Number.isFinite(sol.shin)).toBe(true)
    }
  })
})
