import { describe, expect, it } from 'vitest'
import {
  PHYSICS_DEFAULTS,
  approach,
  gravityMult,
  makeTunables,
  stepVx,
  stepVy,
  type PhysicsTunables,
} from './physics'

// The pure "game feel" math is where the platformer's responsiveness lives, so
// it's worth pinning: the approach curve (accel/friction never overshoots), the
// asymmetric gravity (heavier falling, floaty apex), and horizontal control that
// differs on ground vs. air. The timer-driven parts (coyote/buffer/jump-cut)
// live in engine.ts; these cover the stateless helpers they build on.

const T: PhysicsTunables = makeTunables()

describe('approach', () => {
  it('moves toward the target without overshooting (rising)', () => {
    expect(approach(0, 100, 30)).toBe(30)
    expect(approach(90, 100, 30)).toBe(100) // would overshoot → clamps to target
  })
  it('moves toward the target without overshooting (falling)', () => {
    expect(approach(100, 0, 30)).toBe(70)
    expect(approach(10, 0, 30)).toBe(0)
  })
  it('is a no-op when already at the target', () => {
    expect(approach(50, 50, 30)).toBe(50)
  })
})

describe('stepVx — horizontal control', () => {
  const dt = 1 / 120

  it('accelerates toward +moveSpeed when holding right', () => {
    const v = stepVx(0, 1, true, dt, T)
    expect(v).toBeGreaterThan(0)
    expect(v).toBeLessThanOrEqual(T.moveSpeed)
    // exactly one ground-accel step from rest
    expect(v).toBeCloseTo(T.groundAccel * dt, 5)
  })

  it('never exceeds moveSpeed even from a running start', () => {
    const v = stepVx(T.moveSpeed - 1, 1, true, dt, T)
    expect(v).toBe(T.moveSpeed)
  })

  it('applies friction toward 0 with no input', () => {
    const v = stepVx(T.moveSpeed, 0, true, dt, T)
    expect(v).toBeLessThan(T.moveSpeed)
    expect(v).toBeCloseTo(T.moveSpeed - T.groundFriction * dt, 5)
  })

  it('air control is weaker than ground control (lighter drift)', () => {
    const ground = stepVx(0, 1, true, dt, T)
    const air = stepVx(0, 1, false, dt, T)
    expect(air).toBeLessThan(ground) // airAccel < groundAccel by default
  })

  it('turnaround from full speed passes through zero over several steps', () => {
    let v = T.moveSpeed
    for (let i = 0; i < 20; i++) v = stepVx(v, -1, true, dt, T)
    expect(v).toBeLessThan(0) // now moving the other way
    expect(v).toBeGreaterThanOrEqual(-T.moveSpeed)
  })
})

describe('gravityMult — asymmetric gravity', () => {
  it('is the apex multiplier near vy=0 (floaty peak)', () => {
    expect(gravityMult(0, T)).toBe(T.apexGravityMult)
    expect(gravityMult(T.apexThreshold - 1, T)).toBe(T.apexGravityMult)
    expect(gravityMult(-(T.apexThreshold - 1), T)).toBe(T.apexGravityMult)
  })
  it('is heavier while falling fast', () => {
    expect(gravityMult(T.apexThreshold + 500, T)).toBe(T.fallGravityMult)
  })
  it('is base (1) while rising fast', () => {
    expect(gravityMult(-(T.apexThreshold + 500), T)).toBe(1)
  })
})

describe('stepVy — gravity integration', () => {
  const dt = 1 / 120

  it('accelerates downward and clamps at terminal fall', () => {
    let v = 0
    for (let i = 0; i < 1000; i++) v = stepVy(v, dt, T)
    expect(v).toBe(T.maxFall)
  })

  it('a fast fall gains speed faster than the raw gravity step (fall mult)', () => {
    const fast = T.apexThreshold + 500
    const gained = stepVy(fast, dt, T) - fast
    expect(gained).toBeCloseTo(T.gravity * T.fallGravityMult * dt, 5)
  })
})

describe('PHYSICS_DEFAULTS — sanity of the shipped feel', () => {
  it('has a floaty apex and a weighty fall', () => {
    expect(PHYSICS_DEFAULTS.apexGravityMult).toBeLessThan(1)
    expect(PHYSICS_DEFAULTS.fallGravityMult).toBeGreaterThan(1)
  })
  it('cuts short hops (jumpCut in (0,1))', () => {
    expect(PHYSICS_DEFAULTS.jumpCut).toBeGreaterThan(0)
    expect(PHYSICS_DEFAULTS.jumpCut).toBeLessThan(1)
  })
  it('grounds harder than it drifts (ground accel/friction > air)', () => {
    expect(PHYSICS_DEFAULTS.groundAccel).toBeGreaterThan(PHYSICS_DEFAULTS.airAccel)
    expect(PHYSICS_DEFAULTS.groundFriction).toBeGreaterThan(PHYSICS_DEFAULTS.airFriction)
  })
})
