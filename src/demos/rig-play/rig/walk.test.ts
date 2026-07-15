/**
 * rig-play — tests for the NEW walk.ts behavior this demo adds over the Engine copy:
 * the `crouch` state and the one-shot `wave` overlay. The rest of walk.ts is unchanged
 * from Engine (covered there); here we pin only the rig-play-specific additions.
 */
import { describe, expect, it } from 'vitest'
import { poseForState, selectState, type WalkState } from './walk'

const grounded: WalkState = {
  grounded: true,
  vx: 0,
  vy: 0,
  touchingWall: false,
  wallNx: 0,
  simTime: 0,
}

describe('crouch', () => {
  it('selects crouch when grounded + crouch held (beats idle)', () => {
    expect(selectState({ ...grounded, crouch: true })).toBe('crouch')
    expect(selectState({ ...grounded, crouch: false })).toBe('idle')
  })

  it('is ignored airborne (a jump/fall pose wins)', () => {
    expect(selectState({ ...grounded, grounded: false, vy: -100, crouch: true })).toBe('jump')
    expect(selectState({ ...grounded, grounded: false, vy: 100, crouch: true })).toBe('fall')
  })

  it('crouch pose sinks the spine and bends the knees', () => {
    const pose = poseForState({ ...grounded, crouch: true })
    expect(pose.spine?.y).toBeGreaterThan(0) // spine sinks down (+y)
    expect((pose.spine?.scaleY ?? 1)).toBeLessThan(1) // and squashes
    // Knees bend: thigh + shin both get a nonzero rotation delta.
    expect(Math.abs(pose.thighL?.rotation ?? 0)).toBeGreaterThan(0.1)
    expect(Math.abs(pose.shinL?.rotation ?? 0)).toBeGreaterThan(0.1)
  })
})

describe('wave (one-shot overlay)', () => {
  it('phase 0 / 1 / undefined leaves the base pose unchanged (right arm at idle rest)', () => {
    const base = poseForState({ ...grounded })
    expect(poseForState({ ...grounded, wave: 0 }).armR?.rotation).toBe(base.armR?.rotation)
    expect(poseForState({ ...grounded, wave: 1 }).armR?.rotation).toBe(base.armR?.rotation)
  })

  it('mid-wave lifts the right arm overhead (rotation swings away from rest)', () => {
    const base = poseForState({ ...grounded })
    const mid = poseForState({ ...grounded, wave: 0.5 })
    expect(mid.armR?.rotation).toBeDefined()
    // The arm rises well away from its resting angle at the wave's peak.
    expect(Math.abs((mid.armR!.rotation ?? 0) - (base.armR?.rotation ?? 0))).toBeGreaterThan(1)
  })

  it('layers over WALK: legs still animate while waving', () => {
    const walking: WalkState = { ...grounded, vx: 300, strideDistance: 20, legMode: 'straight' }
    const waveWalk = poseForState({ ...walking, wave: 0.5 })
    // The walk's leg swing is preserved (thigh delta present) AND the wave overrides armR.
    expect(waveWalk.thighL?.rotation).toBeDefined()
    expect(waveWalk.armR?.rotation).toBeDefined()
  })
})
