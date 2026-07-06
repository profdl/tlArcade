import { describe, expect, it } from 'vitest'
import {
  springLaunchVy,
  springLaunchV,
  oneWayBlocks,
  shouldActivateCheckpoint,
  belowKillPlane,
  blinkSolidAt,
  crumbleGone,
} from './props'

// Unit tests for the static-prop decision helpers (G3a). Pure arithmetic / set
// membership — the value is that the integrator can wire the runtime against
// named, pinned behavior. Mirrors the step.test.ts fixture-free style.

describe('springLaunchVy', () => {
  it('always returns a negative (upward) vy of the given magnitude', () => {
    expect(springLaunchVy(600)).toBe(-600)
    // Sign of the impulse doesn't matter — up is always negative.
    expect(springLaunchVy(-600)).toBe(-600)
    expect(springLaunchVy(0)).toBe(-0)
    expect(springLaunchVy(600)).toBeLessThan(0)
  })
})

describe('oneWayBlocks', () => {
  const top = 200

  it('lands: was above last frame, at/below now, moving down', () => {
    // prevBottom above the platform top, curBottom at/below it, falling.
    expect(oneWayBlocks(198, 205, top, true)).toBe(true)
    // Exactly on the top this frame still blocks.
    expect(oneWayBlocks(198, 200, top, true)).toBe(true)
  })

  it('passes through when moving up (jumping through from below)', () => {
    expect(oneWayBlocks(198, 205, top, false)).toBe(false)
  })

  it('passes through when already below last frame (came from underneath)', () => {
    // prevBottom already past the top → you were inside/below; don't snap onto it.
    expect(oneWayBlocks(210, 215, top, true)).toBe(false)
  })

  it('passes through when still fully above (never reached the top)', () => {
    expect(oneWayBlocks(180, 195, top, true)).toBe(false)
  })
})

describe('shouldActivateCheckpoint', () => {
  it('is true for a new id', () => {
    expect(shouldActivateCheckpoint('cp1', new Set())).toBe(true)
    expect(shouldActivateCheckpoint('cp1', new Set(['cp2']))).toBe(true)
  })

  it('is false for an id already in the set', () => {
    expect(shouldActivateCheckpoint('cp1', new Set(['cp1']))).toBe(false)
  })
})

describe('springLaunchV (T1a — angled spring)', () => {
  it('angle 0 launches straight up, matching the original springLaunchVy', () => {
    const v = springLaunchV(600, 0)
    expect(v.vx).toBeCloseTo(0)
    expect(v.vy).toBeCloseTo(-600)
    expect(v.vy).toBeCloseTo(springLaunchVy(600))
  })

  it('positive angle tilts right (up-and-right), negative tilts left', () => {
    const right = springLaunchV(600, 45)
    expect(right.vx).toBeGreaterThan(0)
    expect(right.vy).toBeLessThan(0)
    const left = springLaunchV(600, -45)
    expect(left.vx).toBeLessThan(0)
    expect(left.vy).toBeLessThan(0)
    // Symmetric magnitudes.
    expect(right.vx).toBeCloseTo(-left.vx)
    expect(right.vy).toBeCloseTo(left.vy)
  })

  it('preserves magnitude at any angle', () => {
    for (const a of [0, 30, 45, 90, -60]) {
      const v = springLaunchV(600, a)
      expect(Math.hypot(v.vx, v.vy)).toBeCloseTo(600)
    }
  })

  it('±90° launches horizontally', () => {
    const v = springLaunchV(600, 90)
    expect(v.vx).toBeCloseTo(600)
    expect(v.vy).toBeCloseTo(0)
  })
})

describe('blinkSolidAt (T1f — blink platform)', () => {
  it('is solid during the on-window, gone during the off-window', () => {
    // onMs 1000, offMs 1000, no phase. t in seconds.
    expect(blinkSolidAt(0.0, 1000, 1000)).toBe(true) // 0ms → on
    expect(blinkSolidAt(0.5, 1000, 1000)).toBe(true) // 500ms → on
    expect(blinkSolidAt(1.5, 1000, 1000)).toBe(false) // 1500ms → off
    expect(blinkSolidAt(2.0, 1000, 1000)).toBe(true) // 2000ms → on again (wraps)
  })

  it('phase shifts the cycle', () => {
    // With a 1000ms phase, t=0 lands 1000ms in → the off-window.
    expect(blinkSolidAt(0, 1000, 1000, 1000)).toBe(false)
  })

  it('degenerate zero period is always solid', () => {
    expect(blinkSolidAt(5, 0, 0)).toBe(true)
  })
})

describe('crumbleGone (T1f — crumble platform)', () => {
  it('stays solid until stood on', () => {
    expect(crumbleGone(null, 5000, 500)).toBe(false)
  })

  it('falls away crumbleMs after the first stand', () => {
    expect(crumbleGone(1000, 1000, 500)).toBe(false) // just stood on
    expect(crumbleGone(1000, 1400, 500)).toBe(false) // 400ms later, still solid
    expect(crumbleGone(1000, 1500, 500)).toBe(true) // 500ms later → gone
    expect(crumbleGone(1000, 2000, 500)).toBe(true) // stays gone
  })
})

describe('belowKillPlane', () => {
  const deathY = 1000 // page-space Y; anything strictly below (greater) dies

  it('fires only once the whole body (its TOP) is past the plane', () => {
    // Body top well above the plane → alive.
    expect(belowKillPlane(400, deathY)).toBe(false)
    // Body top exactly on the plane → not yet past it (still straddling).
    expect(belowKillPlane(1000, deathY)).toBe(false)
    // Body top below the plane → the whole body has cleared it → dead.
    expect(belowKillPlane(1001, deathY)).toBe(true)
  })

  it('a body straddling the plane (top above, would-be bottom below) is still alive', () => {
    // topY above the plane means part of the body is still above it — no death yet.
    expect(belowKillPlane(999, deathY)).toBe(false)
  })
})
