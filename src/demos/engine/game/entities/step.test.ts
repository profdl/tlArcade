import { describe, expect, it } from 'vitest'
import type { Body, Pt } from '../collision'
import { makeTunables, SIM } from '../physics'
import { makeKinematic, type EntityInput, type MotionParams, type Motion } from './types'
import { stepEntity, deepestShift, touches, stompCheck, verticalBounds } from './step'

// Characterization tests for the pure entity sim (S3). These PIN the behavior the
// N-entity refactor must preserve — extracted verbatim from GameRuntime.step. They
// use hand-built Body fixtures like collision.test.ts (no editor). Never edit these
// to make a change pass; a failure means behavior drifted.

const boundsOf = (pts: Pt[]) => ({
  minX: Math.min(...pts.map((p) => p.x)),
  minY: Math.min(...pts.map((p) => p.y)),
  maxX: Math.max(...pts.map((p) => p.x)),
  maxY: Math.max(...pts.map((p) => p.y)),
})

/** A filled rectangle body at (x,y) size (w,h). */
function rect(x: number, y: number, w: number, h: number): Body {
  const pts = [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ]
  return { pts, closed: true, bounds: boundsOf(pts), margin: 0 }
}

/**
 * A small box "player" outline: 8 sample points around a w×h box whose top-left is
 * the entity origin (so samples are entity-local, added to kin.x/kin.y like the
 * real playerSamples).
 */
function boxSamples(w = 20, h = 24): Pt[] {
  return [
    { x: 0, y: 0 },
    { x: w / 2, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h / 2 },
    { x: w, y: h },
    { x: w / 2, y: h },
    { x: 0, y: h },
    { x: 0, y: h / 2 },
  ]
}

const noInput: EntityInput = { dir: 0, jumpPressed: false, jumpReleased: false }
const dt = SIM.FIXED_DT

/** Run n substeps with fixed input (defaults to the player: platformer motion). */
function run(
  kin: ReturnType<typeof makeKinematic>,
  samples: Pt[],
  solids: Body[],
  input: EntityInput,
  n: number,
  motion: Motion = 'platformer',
  params: MotionParams = {},
) {
  const t = makeTunables()
  for (let i = 0; i < n; i++) stepEntity(kin, samples, solids, input, motion, params, dt, t)
}

describe('stepEntity — gravity & grounding', () => {
  it('falls under gravity when nothing is below', () => {
    const kin = makeKinematic(0, 0)
    run(kin, boxSamples(), [], noInput, 10)
    expect(kin.vy).toBeGreaterThan(0)
    expect(kin.y).toBeGreaterThan(0)
    expect(kin.grounded).toBe(false)
  })

  it('lands on a floor and becomes grounded', () => {
    const samples = boxSamples(20, 24)
    // Floor top at y=200; player box (h=24) starts just above so it lands quickly.
    const floor = rect(-100, 200, 400, 40)
    const kin = makeKinematic(0, 150)
    run(kin, samples, [floor], noInput, 60)
    expect(kin.grounded).toBe(true)
    // Box bottom (kin.y + 24) should rest at ~the floor top (200).
    expect(kin.y + 24).toBeGreaterThan(199)
    expect(kin.y + 24).toBeLessThan(201.5)
    expect(kin.vy).toBeLessThanOrEqual(0.001)
  })
})

describe('stepEntity — jump feel pipeline (platformer only)', () => {
  const samples = boxSamples(20, 24)
  const floor = rect(-100, 200, 400, 40)

  it('jumps when a buffered press meets coyote time on the ground', () => {
    const kin = makeKinematic(0, 150)
    run(kin, samples, [floor], noInput, 60) // settle grounded
    expect(kin.grounded).toBe(true)
    const t = makeTunables()
    // Press jump this substep.
    stepEntity(kin, samples, [floor], { dir: 0, jumpPressed: true, jumpReleased: false }, 'platformer', {}, dt, t)
    expect(kin.vy).toBeLessThan(0) // launched upward
    expect(kin.grounded).toBe(false)
    expect(kin.jumpHeld).toBe(true)
  })

  it('variable-height cut: releasing while rising keeps only jumpCut fraction', () => {
    const t = makeTunables()
    const kin = makeKinematic(0, 150)
    run(kin, samples, [floor], noInput, 60)
    stepEntity(kin, samples, [floor], { dir: 0, jumpPressed: true, jumpReleased: false }, 'platformer', {}, dt, t)
    const rising = kin.vy
    expect(rising).toBeLessThan(0)
    stepEntity(kin, samples, [floor], { dir: 0, jumpPressed: false, jumpReleased: true }, 'platformer', {}, dt, t)
    // vy was cut (× jumpCut) then gravity added a little; still a large reduction.
    expect(kin.vy).toBeGreaterThan(rising * t.jumpCut - 5)
    expect(kin.jumpHeld).toBe(false)
  })

  it('coyote time: a jump still fires shortly after leaving a ledge', () => {
    const t = makeTunables()
    const kin = makeKinematic(0, 150)
    run(kin, samples, [floor], noInput, 60)
    expect(kin.grounded).toBe(true)
    // Walk off: remove the floor and take one ungrounded step (still in coyote window).
    stepEntity(kin, samples, [], noInput, 'platformer', {}, dt, t)
    expect(kin.grounded).toBe(false)
    expect(kin.coyoteTimer).toBeGreaterThan(0)
    // Now press: should still jump off the vanished ledge.
    stepEntity(kin, samples, [], { dir: 0, jumpPressed: true, jumpReleased: false }, 'platformer', {}, dt, t)
    expect(kin.vy).toBeLessThan(0)
  })

  it('does NOT jump midair once coyote time has lapsed', () => {
    const kin = makeKinematic(0, 0) // in the air from the start
    run(kin, boxSamples(), [], noInput, 40) // long enough to bleed coyote to 0
    expect(kin.coyoteTimer).toBeLessThanOrEqual(0)
    const t = makeTunables()
    const before = kin.vy
    stepEntity(kin, boxSamples(), [], { dir: 0, jumpPressed: true, jumpReleased: false }, 'platformer', {}, dt, t)
    // No jump: vy only increased by gravity, never went sharply negative.
    expect(kin.vy).toBeGreaterThan(before)
  })
})

describe('stepEntity — walls & slopes', () => {
  it('a near-vertical wall blocks horizontal motion and records a wall contact', () => {
    const samples = boxSamples(20, 24)
    const floor = rect(-100, 200, 600, 40)
    const wall = rect(120, 100, 30, 100) // vertical wall to the right, sitting on floor
    const kin = makeKinematic(60, 150)
    run(kin, samples, [floor, wall], { dir: 1, jumpPressed: false, jumpReleased: false }, 120)
    // Player box right edge (kin.x+20) can't pass the wall's left face (x=120).
    expect(kin.x + 20).toBeLessThanOrEqual(121)
    expect(kin.touchingWall).toBe(true)
    expect(kin.wallNx).toBeLessThan(0) // outward normal points left (away from wall)
  })

  it('input does nothing on a non-platformer entity (vx stays 0)', () => {
    const t = makeTunables()
    const kin = makeKinematic(0, 0)
    stepEntity(kin, boxSamples(), [], { dir: 1, jumpPressed: true, jumpReleased: false }, 'static', {}, dt, t)
    expect(kin.vx).toBe(0) // no input read, no jump — only gravity applied
    expect(kin.vy).toBeGreaterThan(0)
  })
})

describe('deepestShift / touches — pure geometry helpers', () => {
  it('deepestShift on Y pushes a box resting inside a floor upward', () => {
    const samples = boxSamples(20, 24)
    const floor = rect(-100, 100, 400, 40)
    // Box overlapping the floor top by a few px.
    const { shift, ny } = deepestShift(samples, [floor], 'y', 0, 80)
    expect(shift).toBeLessThan(0) // pushed up
    expect(-ny).toBeGreaterThanOrEqual(SIM.GROUND_NY) // floor-ish normal
  })

  it('touches: a sample inside a closed body reports true; outside reports false', () => {
    const samples = boxSamples(20, 24)
    const token = rect(200, 200, 30, 30)
    const inside = makeKinematic(195, 195) // box overlaps the token
    const outside = makeKinematic(0, 0)
    expect(touches(inside, samples, token)).toBe(true)
    expect(touches(outside, samples, token)).toBe(false)
  })
})

describe('stepEntity — patrol motion (enemy)', () => {
  const samples = boxSamples(30, 24)

  it('walks in its facing direction at patrolSpeed', () => {
    const floor = rect(-200, 200, 800, 40)
    const kin = makeKinematic(0, 176) // resting on the floor (176+24 = 200)
    kin.facing = 1
    run(kin, samples, [floor], noInput, 30, 'patrol', { patrolSpeed: 100 })
    expect(kin.x).toBeGreaterThan(0) // moved right
    expect(kin.grounded).toBe(true)
  })

  it('reverses at a wall', () => {
    const floor = rect(-200, 200, 800, 40)
    const wall = rect(120, 100, 20, 100) // wall to the right
    const kin = makeKinematic(60, 176)
    kin.facing = 1
    run(kin, samples, [floor, wall], noInput, 120, 'patrol', { patrolSpeed: 120 })
    // After hitting the wall it should have flipped to face left.
    expect(kin.facing).toBe(-1)
    // And its right edge never punched through the wall's left face (x=120).
    expect(kin.x + 30).toBeLessThanOrEqual(121)
  })

  it('reverses at a ledge instead of walking off', () => {
    // A floor that ends at x=200; nothing beyond → a right-facing patroller must
    // turn before its outline clears the edge.
    const floor = rect(-200, 200, 400, 40) // spans x∈[-200,200]
    const kin = makeKinematic(150, 176)
    kin.facing = 1
    run(kin, samples, [floor], noInput, 240, 'patrol', { patrolSpeed: 120 })
    expect(kin.facing).toBe(-1) // turned back from the ledge
    // Never fell: still grounded near the floor top, not plummeting.
    expect(kin.grounded).toBe(true)
    expect(kin.y + 24).toBeLessThan(210)
  })
})

describe('stompCheck / verticalBounds', () => {
  it('a downward-moving player above the enemy midpoint is a STOMP', () => {
    // enemy top=200 bottom=240 → mid=220. Player feet at 210 (above mid), vy>0.
    expect(stompCheck(210, 300, 200, 240)).toBe('stomp')
  })

  it('a rising player is a KILL even if positioned high', () => {
    expect(stompCheck(210, -300, 200, 240)).toBe('kill')
  })

  it('a side hit (feet below the enemy midpoint) is a KILL', () => {
    expect(stompCheck(235, 300, 200, 240)).toBe('kill')
  })

  it('verticalBounds returns the outline top/bottom in page space', () => {
    const samples = boxSamples(30, 24)
    const kin = makeKinematic(0, 100)
    expect(verticalBounds(kin, samples)).toEqual({ top: 100, bottom: 124 })
  })
})
