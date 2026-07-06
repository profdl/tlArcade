import { describe, expect, it } from 'vitest'
import type { Body, Pt } from '../collision'
import { makeTunables, SIM } from '../physics'
import { makeKinematic, type MotionParams } from './types'
import { stepEntity, moverPosition, verticalBounds } from './step'

// Integration-level test of the T1e moving platform: it drives a real PLAYER entity
// through the real pure sim (stepEntity) while a `mover` platform travels its path,
// reproducing the runtime's per-frame "rebuild solids from the mover's live outline"
// so the player lands on and is carried by the moving platform — the one genuinely
// new physics path in Tier 1. No editor, same fixture style as the other *.integration.

const dt = SIM.FIXED_DT
const t = makeTunables()

const boundsOf = (pts: Pt[]) => ({
  minX: Math.min(...pts.map((p) => p.x)),
  minY: Math.min(...pts.map((p) => p.y)),
  maxX: Math.max(...pts.map((p) => p.x)),
  maxY: Math.max(...pts.map((p) => p.y)),
})

// A closed rectangle body whose top-left is (x,y).
function rect(x: number, y: number, w: number, h: number): Body {
  const pts = [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ]
  return { pts, closed: true, bounds: boundsOf(pts), margin: 0 }
}

function playerBox(w = 60, h = 120): Pt[] {
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ]
}

// The mover platform's slab size — same as the `platform` role default (120×30).
const PLAT_W = 120
const PLAT_H = 30

// The mover's live page-space Body at sim time — how the runtime rebuilds it each
// frame (moverBody in engine.ts): local samples translated by its current position.
function moverBodyAt(path: MotionParams['path'], tSec: number): Body {
  const pos = moverPosition(path, tSec)!
  return rect(pos.x, pos.y, PLAT_W, PLAT_H)
}

describe('moving platform (T1e) — the player rides it', () => {
  it('a standing player is CARRIED sideways by a horizontally moving platform (velocity inheritance)', () => {
    // Velocity inheritance (added per the "platforms should carry you" fix): the
    // runtime's step() shifts a grounded player by the delta of the mover it stands
    // on, BEFORE the player resolves — so the platform carries an idle player along
    // instead of sliding out from under them. This test replicates that runtime carry
    // step around the pure stepEntity (the carry lives in engine.ts step(), not
    // stepEntity), and asserts the standing player drifts with the slab.
    const path = { ax: 0, ay: 480, bx: 300, by: 480, speed: 60 } // slides right
    const samples = playerBox()
    const kin = makeKinematic(30, 300) // starts over the slab's left half, falling

    let simTime = 0
    let landed = false
    let landedX = 0
    for (let i = 0; i < 300; i++) {
      const before = moverPosition(path, simTime)! // slab pos before it advances
      simTime += dt
      const after = moverPosition(path, simTime)! // slab pos after
      // Runtime carry: if grounded on the slab, move the player by the slab's delta
      // BEFORE stepping (mirrors engine.ts carrierUnder + the carry shift).
      const feet = verticalBounds(kin, samples).bottom
      const onSlab = kin.grounded && feet >= 480 - 2 && feet <= 480 + 8
      if (onSlab) {
        kin.x += after.x - before.x
        kin.y += after.y - before.y
      }
      const solids = [moverBodyAt(path, simTime)]
      stepEntity(kin, samples, solids, { dir: 0, jumpPressed: false, jumpReleased: false }, 'platformer', {}, dt, t)
      if (!landed && kin.grounded) {
        landed = true
        landedX = kin.x
      }
    }
    expect(landed).toBe(true)
    // The standing player was carried well to the right of where it landed (rode the
    // slab), not left behind.
    expect(kin.x).toBeGreaterThan(landedX + 60)
  })

  it('a player stands on a vertically moving (elevator) platform and rides it up', () => {
    // Platform rises from y=480 up to y=300 and back, at 60px/s.
    const path = { ax: 300, ay: 480, bx: 300, by: 300, speed: 60 }
    const samples = playerBox()
    const kin = makeKinematic(320, 300) // above the platform, falls onto it

    let simTime = 0
    let minBottom = Infinity
    let landed = false
    for (let i = 0; i < 240; i++) {
      simTime += dt
      const solids = [moverBodyAt(path, simTime)]
      stepEntity(kin, samples, solids, { dir: 0, jumpPressed: false, jumpReleased: false }, 'platformer', {}, dt, t)
      if (kin.grounded) landed = true
      if (landed) minBottom = Math.min(minBottom, verticalBounds(kin, samples).bottom)
    }
    expect(landed).toBe(true)
    // The elevator lifted the player: its feet reached well above the start floor (480).
    expect(minBottom).toBeLessThan(440)
  })
})
