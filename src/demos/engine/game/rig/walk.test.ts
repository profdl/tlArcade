/**
 * Engine — procedural animation state-machine unit tests.
 */
import { describe, expect, it } from 'vitest'
import { legSwing, poseForState, selectState, stridePhase, WALK_DEFAULTS } from './walk'

const T = WALK_DEFAULTS
const grounded = (vx: number, simTime = 0.3) => ({ grounded: true, vx, vy: 0, touchingWall: false, wallNx: 0, simTime })
// A grounded state at a given distance travelled (the real driver of the walk cycle).
const walking = (vx: number, strideDistance: number) => ({ grounded: true, vx, vy: 0, touchingWall: false, wallNx: 0, simTime: 0, strideDistance })
const airborne = (vy: number, vx = 0, simTime = 0.3) => ({ grounded: false, vx, vy, touchingWall: false, wallNx: 0, simTime })
// onWall: airborne + touching a wall. `wallNx` is the outward normal; default −1 (wall
// to the RIGHT) so the climb pose has a side to face. Pass +1 for a wall on the left.
const onWall = (simTime = 0.3, wallNx = -1) => ({ grounded: false, vx: 0, vy: 100, touchingWall: true, wallNx, simTime })

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
    expect(selectState({ grounded: false, vx: 0, vy: -100, touchingWall: true, wallNx: -1, simTime: 0 })).toBe('climb')
  })
})

describe('poseForState — walk', () => {
  it('swings all four limbs when grounded and moving', () => {
    const t = Math.PI / 2 / T.cadence // sin = 1
    const pose = poseForState(grounded(T.fullSpeed, t), T)
    for (const b of ['legL', 'legR', 'armL', 'armR']) expect(pose[b]).toBeDefined()
  })

  it('legs swing OPPOSED (exact negation — half a cycle apart on a sine)', () => {
    const d = T.strideLength * 0.2
    const pose = poseForState(walking(T.fullSpeed, d), T)
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
    // At a quarter stride the sine peaks (sin = 1) ⇒ the leg is at +amp — a clean
    // amplitude probe. Drive by DISTANCE.
    const quarter = T.strideLength / 4
    const fast = poseForState(walking(T.fullSpeed, quarter), T)
    const slow = poseForState(walking(T.fullSpeed / 2, quarter), T)
    expect(Math.abs(slow.legL!.rotation!)).toBeLessThan(Math.abs(fast.legL!.rotation!))
    expect(Math.abs(fast.legL!.rotation!)).toBeCloseTo(T.amplitude, 6)
  })

  it('the cycle oscillates over distance (sign flips half a stride later)', () => {
    const a = poseForState(walking(T.fullSpeed, T.strideLength / 4), T)
    const b = poseForState(walking(T.fullSpeed, (3 * T.strideLength) / 4), T)
    expect(Math.sign(a.legL!.rotation!)).toBe(-Math.sign(b.legL!.rotation!))
  })
})

describe('distance-driven stride (the anti-slide mechanism)', () => {
  it('drives the leg phase by DISTANCE travelled, not wall-clock time', () => {
    // With a strideDistance supplied, simTime is irrelevant to the leg phase — so the
    // legs no longer swing on a clock that keeps ticking when the body has stopped.
    const p1 = stridePhase({ ...walking(T.fullSpeed, T.strideLength / 4), simTime: 0 }, T)
    const p2 = stridePhase({ ...walking(T.fullSpeed, T.strideLength / 4), simTime: 999 }, T)
    expect(p1).toBeCloseTo(p2, 9)
    // One full stride length = one full 2π cycle.
    expect(stridePhase(walking(T.fullSpeed, T.strideLength), T)).toBeCloseTo(2 * Math.PI, 9)
  })

  it('advances the cycle in lockstep with distance (same distance ⇒ same phase)', () => {
    // Same distance covered ⇒ same point in the stride, regardless of speed. This is
    // what couples the swing rate to the actual body speed (fast and slow walks both
    // step once per stride length).
    const slowFar = stridePhase(walking(T.fullSpeed / 3, T.strideLength / 2), T)
    const fastFar = stridePhase(walking(T.fullSpeed, T.strideLength / 2), T)
    expect(slowFar).toBeCloseTo(fastFar, 9)
  })

  it('falls back to the simTime clock when no distance is supplied', () => {
    expect(stridePhase(grounded(T.fullSpeed, 0.5), T)).toBeCloseTo(0.5 * T.cadence, 9)
  })

  it('legSwing is a plain sine of the phase, scaled by amplitude', () => {
    expect(legSwing(0, 0.5)).toBeCloseTo(0, 9)
    expect(legSwing(Math.PI / 2, 0.5)).toBeCloseTo(0.5, 9)
    expect(legSwing(Math.PI, 0.5)).toBeCloseTo(0, 9)
    // Opposed legs (π apart) are exact negatives.
    expect(legSwing(1.2 + Math.PI, 0.5)).toBeCloseTo(-legSwing(1.2, 0.5), 9)
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
  it('reaches both arms up to grip the wall while pressed to it', () => {
    const pose = poseForState(onWall(), T)
    // Arms up overhead (opposite outward signs, large magnitude).
    expect(pose.armL!.rotation!).toBeLessThan(-1)
    expect(pose.armR!.rotation!).toBeGreaterThan(1)
  })

  it('leans the torso INTO the wall (faces the side it grips)', () => {
    // Wall to the RIGHT (wallNx −1) ⇒ lean right (spine rotation > 0); to the LEFT ⇒
    // lean left (< 0). The figure orients toward the wall it's climbing, not upright.
    const wallRight = poseForState(onWall(0.3, -1), T)
    const wallLeft = poseForState(onWall(0.3, 1), T)
    expect(wallRight.spine!.rotation!).toBeGreaterThan(0) // leans right, into the wall
    expect(wallLeft.spine!.rotation!).toBeLessThan(0) // leans left, into the wall
    expect(wallRight.head!.rotation!).toBeGreaterThan(0) // head tips toward the wall too
  })

  it('drives the arms hand-over-hand: they alternate high/low over the cycle', () => {
    // Quarter cycle apart (sin 0 → 1), the wall-side arm swaps between reaching high
    // and pulling low — the hallmark of a climb, not a static reach.
    const a = poseForState(onWall(0.0), T)
    const b = poseForState(onWall(Math.PI / 2 / (T.cadence * 0.75)), T)
    expect(a.armR!.rotation).not.toBeCloseTo(b.armR!.rotation!, 3)
    expect(a.legL!.rotation).not.toBeCloseTo(b.legL!.rotation!, 3) // legs kick too
  })

  it('is distinct from the jump pose (climb ≠ jump)', () => {
    const climb = poseForState(onWall(), T)
    const jump = poseForState(airborne(-300), T)
    expect(climb.legL!.rotation).not.toBeCloseTo(jump.legL!.rotation!, 3)
    // The lean/head orientation is climb-only — jump doesn't touch the spine rotation.
    expect(climb.spine!.rotation).toBeDefined()
    expect(jump.spine!.rotation).toBeUndefined()
  })
})
