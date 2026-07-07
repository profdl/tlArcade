import { describe, expect, it } from 'vitest'
import type { Body, Pt } from '../collision'
import { makeTunables, SIM } from '../physics'
import { makeKinematic, type EntityInput, type MotionParams, type Motion } from './types'
import {
  stepEntity,
  deepestShift,
  touches,
  stompCheck,
  verticalBounds,
  sinePosition,
  moverPosition,
} from './step'

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

  it('walking into a wall does NOT slide the player up its face (regression)', () => {
    // A grounded player holding INTO a tall wall must stay pinned at its start
    // height — not ratchet up the wall face. Two failure modes this pins: (1) the
    // Y pass turning a wall-ish (near-horizontal) contact into a huge upward shift,
    // and (2) a sample flush on the wall's vertical edge getting a hardcoded 0.5px
    // "nudge up" from penetration()'s dead-on-edge fallback. Both let the player
    // creep up the wall each frame (the "auto-slide up walls" glitch).
    const samples = boxSamples(20, 24)
    const floor = rect(-200, 200, 800, 40) // floor top at y=200
    const wall = rect(120, 60, 40, 140) // wall y=60..200, sitting on the floor
    const kin = makeKinematic(60, 176) // player resting on the floor (176+24=200)
    let minY = kin.y
    for (let i = 0; i < 600; i++) {
      stepEntity(kin, samples, [floor, wall], { dir: 1, jumpPressed: false, jumpReleased: false }, 'platformer', {}, dt, makeTunables())
      if (kin.y < minY) minY = kin.y
    }
    expect(minY).toBeGreaterThanOrEqual(175) // never rose above the start height
    expect(kin.x + 20).toBeLessThanOrEqual(121) // blocked flat at the wall face
    expect(kin.touchingWall).toBe(true) // still records the wall (enables wall-jump)
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

describe('stepEntity — one-way platform (G3a)', () => {
  const samples = boxSamples(20, 24)
  /** A one-way platform body. */
  function oneWay(x: number, y: number, w: number, h: number): Body {
    return { ...rect(x, y, w, h), oneWay: true }
  }

  it('lands on a one-way platform from above (like a floor)', () => {
    const plat = oneWay(-100, 200, 400, 12)
    const kin = makeKinematic(0, 150) // above the platform, falls onto it
    run(kin, samples, [plat], noInput, 60)
    expect(kin.grounded).toBe(true)
    expect(kin.y + 24).toBeGreaterThan(199)
    expect(kin.y + 24).toBeLessThan(201.5)
  })

  it('passes UP through a one-way platform (no ceiling bonk)', () => {
    // Player starts just below the platform, launched upward hard.
    const plat = oneWay(-100, 100, 400, 12)
    const kin = makeKinematic(0, 130) // below the platform top (100)
    kin.vy = -600 // rising fast
    // One Y-resolve step: rising through it should NOT be blocked (vy stays negative).
    const t = makeTunables()
    stepEntity(kin, samples, [plat], noInput, 'platformer', {}, dt, t)
    expect(kin.vy).toBeLessThan(0) // still rising — passed through, no bonk
  })

  it('does not block sideways motion (walk past it horizontally)', () => {
    // A one-way to the right at the same level — a normal wall would stop the walk.
    const plat = oneWay(120, 150, 30, 60)
    const floor = rect(-200, 200, 600, 40)
    const kin = makeKinematic(60, 176)
    run(kin, samples, [floor, plat], { dir: 1, jumpPressed: false, jumpReleased: false }, 120)
    // Walked past x=120 (a one-way never blocks horizontally).
    expect(kin.x + 20).toBeGreaterThan(121)
    expect(kin.touchingWall).toBe(false)
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

describe('sinePosition (T1d — oscillating mover)', () => {
  const base = { x: 100, y: 200 }

  it('returns null without a sine config or base', () => {
    expect(sinePosition({}, 0)).toBeNull()
    expect(sinePosition({ sine: { amplitude: 10, frequency: 1, axis: 'y' } }, 0)).toBeNull()
  })

  it('oscillates on the Y axis around the base (default phase)', () => {
    const params: MotionParams = { sine: { amplitude: 60, frequency: 0.5, axis: 'y' }, sineBase: base }
    // t=0 → sin(0)=0 → at base.
    expect(sinePosition(params, 0)).toEqual({ x: 100, y: 200 })
    // Quarter period (freq 0.5 → period 2s → quarter 0.5s) → sin(π/2)=1 → +amplitude.
    const q = sinePosition(params, 0.5)!
    expect(q.x).toBe(100)
    expect(q.y).toBeCloseTo(260)
    // Three-quarters → sin(3π/2)=-1 → -amplitude.
    expect(sinePosition(params, 1.5)!.y).toBeCloseTo(140)
  })

  it('oscillates on the X axis when axis is x', () => {
    const params: MotionParams = { sine: { amplitude: 30, frequency: 0.5, axis: 'x' }, sineBase: base }
    const q = sinePosition(params, 0.5)!
    expect(q.y).toBe(200)
    expect(q.x).toBeCloseTo(130)
  })
})

describe('moverPosition (T1e — ping-pong platform)', () => {
  const path = { ax: 0, ay: 0, bx: 100, by: 0, speed: 100 } // 100px leg at 100px/s → 1s per leg

  it('returns null without a path', () => {
    expect(moverPosition(undefined, 0)).toBeNull()
  })

  it('sits at A when speed is 0 or endpoints coincide', () => {
    expect(moverPosition({ ...path, speed: 0 }, 5)).toEqual({ x: 0, y: 0 })
    expect(moverPosition({ ax: 7, ay: 8, bx: 7, by: 8, speed: 100 }, 5)).toEqual({ x: 7, y: 8 })
  })

  it('ping-pongs A→B→A as a triangle wave', () => {
    expect(moverPosition(path, 0)).toEqual({ x: 0, y: 0 }) // at A
    expect(moverPosition(path, 0.5)!.x).toBeCloseTo(50) // halfway to B
    expect(moverPosition(path, 1)!.x).toBeCloseTo(100) // at B
    expect(moverPosition(path, 1.5)!.x).toBeCloseTo(50) // heading back
    expect(moverPosition(path, 2)!.x).toBeCloseTo(0) // back at A (period 2s)
    expect(moverPosition(path, 2.5)!.x).toBeCloseTo(50) // repeats
  })

  it('moves along a diagonal path', () => {
    const diag = { ax: 0, ay: 0, bx: 100, by: 100, speed: 141.42 } // ~1s per leg
    const mid = moverPosition(diag, 0.5)!
    expect(mid.x).toBeCloseTo(50, 0)
    expect(mid.y).toBeCloseTo(50, 0)
  })
})
