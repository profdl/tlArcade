/**
 * Engine — procedural animation state-machine unit tests.
 */
import { describe, expect, it } from 'vitest'
import { poseForState, selectState, WALK_DEFAULTS } from './walk'

const T = WALK_DEFAULTS
const grounded = (vx: number, simTime = 0.3) => ({ grounded: true, vx, vy: 0, touchingWall: false, simTime })
const airborne = (vy: number, vx = 0, simTime = 0.3) => ({ grounded: false, vx, vy, touchingWall: false, simTime })
const onWall = (simTime = 0.3) => ({ grounded: false, vx: 0, vy: 100, touchingWall: true, simTime })

describe('selectState', () => {
  it('idle when grounded and slow', () => {
    expect(selectState(grounded(0))).toBe('idle')
    expect(selectState(grounded(T.minSpeed - 1))).toBe('idle')
  })
  it('walk when grounded and moving', () => {
    expect(selectState(grounded(T.fullSpeed))).toBe('walk')
  })
  it('jump when airborne and rising (vy<0)', () => {
    expect(selectState(airborne(-200))).toBe('jump')
  })
  it('fall when airborne and descending (vy>0)', () => {
    expect(selectState(airborne(200))).toBe('fall')
  })
  it('climb when airborne AND pressed against a wall (wins over jump/fall)', () => {
    expect(selectState(onWall())).toBe('climb')
    // Even rising: touching a wall ⇒ climb, not jump.
    expect(selectState({ grounded: false, vx: 0, vy: -100, touchingWall: true, simTime: 0 })).toBe('climb')
  })
})

describe('poseForState — walk', () => {
  it('swings all four limbs when grounded and moving', () => {
    const t = Math.PI / 2 / T.cadence // sin = 1
    const pose = poseForState(grounded(T.fullSpeed, t), T)
    for (const b of ['legL', 'legR', 'armL', 'armR']) expect(pose[b]).toBeDefined()
  })

  it('legs swing OPPOSED', () => {
    const t = Math.PI / 2 / T.cadence
    const pose = poseForState(grounded(T.fullSpeed, t), T)
    expect(pose.legL!.rotation).toBeCloseTo(-pose.legR!.rotation!, 9)
  })

  it('arms are LOWERED to the sides (dropped from rest), not raised', () => {
    // At any phase, each arm sits within ~armSwing of its ±armDrop hang position.
    for (const st of [0, 0.1, 0.25, 0.4]) {
      const pose = poseForState(grounded(T.fullSpeed, st), T)
      // armR hangs at +armDrop (down), armL at −armDrop (mirror).
      expect(pose.armR!.rotation!).toBeGreaterThan(T.armDrop - T.amplitude)
      expect(pose.armL!.rotation!).toBeLessThan(-(T.armDrop - T.amplitude))
      // The swing magnitude stays under the leg swing (arms swing subtly).
      const armDev = Math.abs(pose.armR!.rotation! - T.armDrop)
      expect(armDev).toBeLessThanOrEqual(T.amplitude * T.armSwing + 1e-9)
    }
  })

  it('drives the SPINE (whole-body bob + lean) while walking', () => {
    const t = Math.PI / 2 / T.cadence
    const pose = poseForState(grounded(T.fullSpeed, t), T)
    expect(pose.spine).toBeDefined()
    // Bob (y) and lean (rotation) both present at full speed.
    expect(Math.abs(pose.spine!.y!)).toBeGreaterThan(0)
    expect(Math.abs(pose.spine!.rotation!)).toBeGreaterThan(0)
  })

  it('leans in the direction of travel (spine rotation sign follows vx)', () => {
    const t = Math.PI / 2 / T.cadence
    const right = poseForState(grounded(T.fullSpeed, t), T)
    const left = poseForState(grounded(-T.fullSpeed, t), T)
    expect(Math.sign(right.spine!.rotation!)).toBe(-Math.sign(left.spine!.rotation!))
  })

  it('amplitude scales with speed (slower ⇒ smaller swing)', () => {
    const t = Math.PI / 2 / T.cadence
    const fast = poseForState(grounded(T.fullSpeed, t), T)
    const slow = poseForState(grounded(T.fullSpeed / 2, t), T)
    expect(Math.abs(slow.legL!.rotation!)).toBeLessThan(Math.abs(fast.legL!.rotation!))
    expect(Math.abs(fast.legL!.rotation!)).toBeCloseTo(T.amplitude, 6)
  })

  it('the cycle oscillates over time (sign flips half a period later)', () => {
    const t1 = Math.PI / 2 / T.cadence
    const t2 = (Math.PI / 2 + Math.PI) / T.cadence
    const a = poseForState(grounded(T.fullSpeed, t1), T)
    const b = poseForState(grounded(T.fullSpeed, t2), T)
    expect(Math.sign(a.legL!.rotation!)).toBe(-Math.sign(b.legL!.rotation!))
  })
})

describe('poseForState — idle / jump / fall', () => {
  it('idle drops the arms to the sides and never moves the legs', () => {
    const pose = poseForState(grounded(0), T)
    // Arms hang at ±armDrop (down at the sides).
    expect(pose.armR!.rotation).toBeCloseTo(T.armDrop, 9)
    expect(pose.armL!.rotation).toBeCloseTo(-T.armDrop, 9)
    // Legs stay at rest (walking is the only thing that swings them).
    expect(pose.legL).toBeUndefined()
    expect(pose.spine).toBeDefined()
    expect(pose.head).toBeDefined()
  })

  it('idle arms hang at the sides even with breathing off (idleBob 0)', () => {
    const pose = poseForState(grounded(0), { ...T, idleBob: 0 })
    expect(pose.armR!.rotation).toBeCloseTo(T.armDrop, 9)
    // Breathing off ⇒ no spine/head motion.
    expect(pose.spine!.y).toBeCloseTo(0, 9)
    expect(pose.head!.rotation).toBeCloseTo(0, 9)
  })

  it('jump sweeps arms up and tucks legs (distinct from walk)', () => {
    const pose = poseForState(airborne(-300), T)
    // Arms swung up (opposite outward signs), legs tucked, torso stretched.
    expect(pose.armL!.rotation).toBeLessThan(0)
    expect(pose.armR!.rotation).toBeGreaterThan(0)
    expect(pose.spine!.scaleY).toBeGreaterThan(1)
  })

  it('fall spreads arms out and compresses the torso', () => {
    const pose = poseForState(airborne(300), T)
    expect(pose.spine!.scaleY).toBeLessThan(1)
    expect(pose.armL).toBeDefined()
  })

  it('jump and fall are different poses', () => {
    const jump = poseForState(airborne(-300), T)
    const fall = poseForState(airborne(300), T)
    expect(jump.spine!.scaleY).not.toBe(fall.spine!.scaleY)
  })
})

describe('poseForState — climb (wall-scramble)', () => {
  it('reaches both arms overhead while pressed to a wall', () => {
    const pose = poseForState(onWall(), T)
    // Arms up overhead (opposite outward signs, large magnitude).
    expect(pose.armL!.rotation!).toBeLessThan(-1)
    expect(pose.armR!.rotation!).toBeGreaterThan(1)
  })

  it('cycles over time (the reach oscillates)', () => {
    // Quarter period apart: sin goes 0 → 1, so the reach clearly differs.
    const a = poseForState(onWall(0.0), T)
    const b = poseForState(onWall(Math.PI / 2 / (T.cadence * 0.7)), T)
    expect(a.armL!.rotation).not.toBeCloseTo(b.armL!.rotation!, 3)
  })

  it('is distinct from the jump pose (climb ≠ jump)', () => {
    const climb = poseForState(onWall(), T)
    const jump = poseForState(airborne(-300), T)
    expect(climb.legL!.rotation).not.toBeCloseTo(jump.legL!.rotation!, 3)
  })
})
