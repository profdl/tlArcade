import { describe, expect, it } from 'vitest'
import { springLaunchVy, oneWayBlocks, shouldActivateCheckpoint } from './props'

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
