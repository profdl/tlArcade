/**
 * Engine — procedural walk cycle unit tests.
 */
import { describe, expect, it } from 'vitest'
import { poseForState, WALK_DEFAULTS } from './walk'

const T = WALK_DEFAULTS

describe('poseForState — walk cycle', () => {
  it('rests (empty pose) when standing still', () => {
    expect(poseForState({ grounded: true, vx: 0, simTime: 0.3 }, T)).toEqual({})
  })

  it('rests when below the min speed threshold', () => {
    expect(poseForState({ grounded: true, vx: T.minSpeed - 1, simTime: 0.3 }, T)).toEqual({})
  })

  it('rests when airborne even if moving fast (jump/fall)', () => {
    expect(poseForState({ grounded: false, vx: 300, simTime: 0.3 }, T)).toEqual({})
  })

  it('swings all four limbs when grounded and moving', () => {
    // Pick a simTime where sin(t·cadence) is clearly non-zero.
    const t = Math.PI / 2 / T.cadence // sin = 1
    const pose = poseForState({ grounded: true, vx: T.fullSpeed, simTime: t }, T)
    expect(pose.legL).toBeDefined()
    expect(pose.legR).toBeDefined()
    expect(pose.armL).toBeDefined()
    expect(pose.armR).toBeDefined()
  })

  it('legs swing OPPOSED (one forward, one back)', () => {
    const t = Math.PI / 2 / T.cadence
    const pose = poseForState({ grounded: true, vx: T.fullSpeed, simTime: t }, T)
    expect(pose.legL!.rotation).toBeCloseTo(-pose.legR!.rotation!, 9)
    expect(pose.legL!.rotation).not.toBe(0)
  })

  it('arms COUNTER the legs (arm sign opposes the same-side leg)', () => {
    const t = Math.PI / 2 / T.cadence
    const pose = poseForState({ grounded: true, vx: T.fullSpeed, simTime: t }, T)
    // Left arm counters left leg; right arm counters right leg.
    expect(Math.sign(pose.armL!.rotation!)).toBe(-Math.sign(pose.legL!.rotation!))
    expect(Math.sign(pose.armR!.rotation!)).toBe(-Math.sign(pose.legR!.rotation!))
  })

  it('amplitude scales with speed (slower ⇒ smaller swing)', () => {
    const t = Math.PI / 2 / T.cadence // sin = 1, so swing == amplitude·drive
    const fast = poseForState({ grounded: true, vx: T.fullSpeed, simTime: t }, T)
    const slow = poseForState({ grounded: true, vx: T.fullSpeed / 2, simTime: t }, T)
    expect(Math.abs(slow.legL!.rotation!)).toBeLessThan(Math.abs(fast.legL!.rotation!))
    // Full speed → full amplitude.
    expect(Math.abs(fast.legL!.rotation!)).toBeCloseTo(T.amplitude, 6)
  })

  it('amplitude clamps at full speed (faster than fullSpeed ⇒ same swing)', () => {
    const t = Math.PI / 2 / T.cadence
    const atFull = poseForState({ grounded: true, vx: T.fullSpeed, simTime: t }, T)
    const overFull = poseForState({ grounded: true, vx: T.fullSpeed * 3, simTime: t }, T)
    expect(overFull.legL!.rotation).toBeCloseTo(atFull.legL!.rotation!, 9)
  })

  it('the cycle oscillates over time (sign flips half a period later)', () => {
    const cadence = T.cadence
    const t1 = Math.PI / 2 / cadence // sin = +1
    const t2 = (Math.PI / 2 + Math.PI) / cadence // half period later, sin = -1
    const a = poseForState({ grounded: true, vx: T.fullSpeed, simTime: t1 }, T)
    const b = poseForState({ grounded: true, vx: T.fullSpeed, simTime: t2 }, T)
    expect(Math.sign(a.legL!.rotation!)).toBe(-Math.sign(b.legL!.rotation!))
  })
})
