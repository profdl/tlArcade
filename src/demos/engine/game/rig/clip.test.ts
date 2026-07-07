/**
 * Engine — keyframed clip sampler tests (R2b scaffold).
 */
import { describe, expect, it } from 'vitest'
import { sampleClip, mergePose, type Clip } from './clip'

const clip: Clip = {
  duration: 1,
  loop: true,
  tracks: {
    armL: [
      { t: 0, pose: { rotation: 0 } },
      { t: 0.5, pose: { rotation: 1 } },
      { t: 1, pose: { rotation: 0 } },
    ],
  },
}

describe('sampleClip', () => {
  it('returns the keyed value at an exact keyframe', () => {
    expect(sampleClip(clip, 0.5).armL!.rotation).toBeCloseTo(1, 9)
  })

  it('linearly interpolates between keyframes', () => {
    expect(sampleClip(clip, 0.25).armL!.rotation).toBeCloseTo(0.5, 9)
    expect(sampleClip(clip, 0.75).armL!.rotation).toBeCloseTo(0.5, 9)
  })

  it('wraps time into the loop period', () => {
    expect(sampleClip(clip, 1.25).armL!.rotation).toBeCloseTo(sampleClip(clip, 0.25).armL!.rotation!, 9)
  })

  it('only includes bones/channels the clip actually keys', () => {
    const pose = sampleClip(clip, 0.3)
    expect(Object.keys(pose)).toEqual(['armL'])
    expect(Object.keys(pose.armL!)).toEqual(['rotation'])
  })

  it('an empty clip yields an empty pose (rest)', () => {
    expect(sampleClip({ duration: 1, loop: true, tracks: {} }, 0.3)).toEqual({})
  })
})

describe('mergePose', () => {
  it('adds rotation deltas and multiplies scale', () => {
    const a = { spine: { rotation: 0.2, scaleY: 1.1 } }
    const b = { spine: { rotation: 0.1, scaleY: 2 } }
    const m = mergePose(a, b)
    expect(m.spine.rotation).toBeCloseTo(0.3, 9)
    expect(m.spine.scaleY).toBeCloseTo(2.2, 9)
  })

  it('carries bones present in only one input', () => {
    const m = mergePose({ armL: { rotation: 0.5 } }, { legR: { rotation: -0.5 } })
    expect(m.armL.rotation).toBeCloseTo(0.5, 9)
    expect(m.legR.rotation).toBeCloseTo(-0.5, 9)
  })
})
