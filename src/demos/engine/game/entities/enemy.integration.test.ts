import { describe, expect, it } from 'vitest'
import type { Body, Pt } from '../collision'
import { makeTunables, SIM } from '../physics'
import { makeKinematic, DEFAULT_PATROL_SPEED } from './types'
import { stepEntity, stompCheck, verticalBounds } from './step'

// Integration-level test of the G2a enemy: it drives a player entity AND a patrol
// enemy entity through the REAL pure sim (stepEntity) and reproduces the engine's
// checkEnemies stomp/kill decision, so the whole "patrol + land-on-it + bounce"
// and "walk-into-it + die" flows are exercised end-to-end without an editor.

const dt = SIM.FIXED_DT
const t = makeTunables()

const boundsOf = (pts: Pt[]) => ({
  minX: Math.min(...pts.map((p) => p.x)),
  minY: Math.min(...pts.map((p) => p.y)),
  maxX: Math.max(...pts.map((p) => p.x)),
  maxY: Math.max(...pts.map((p) => p.y)),
})
function rect(x: number, y: number, w: number, h: number): Body {
  const pts = [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ]
  return { pts, closed: true, bounds: boundsOf(pts), margin: 0 }
}
function box(w: number, h: number): Pt[] {
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

/** Mirror of engine.ts aabbOf / aabbOverlap (kept in sync by these tests). */
function aabb(kin: { x: number; y: number }, s: Pt[]) {
  const b = boundsOf(s.map((p) => ({ x: p.x + kin.x, y: p.y + kin.y })))
  return b
}
function overlap(a: ReturnType<typeof aabb>, b: ReturnType<typeof aabb>) {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY
}

describe('enemy G2a — integration', () => {
  const floor = rect(-200, 300, 900, 40) // ground top at y=300
  const pSamples = box(30, 40)
  const eSamples = box(44, 40)

  it('a patroller walks the floor and turns at both ends', () => {
    // Floor spans x∈[-200,700]. Enemy starts mid-floor facing right.
    const e = makeKinematic(0, 260) // 260+40 = 300 = floor top
    e.facing = 1
    let flips = 0
    let prevFacing = e.facing
    for (let i = 0; i < 2400; i++) {
      stepEntity(e, eSamples, [floor], neutral(), 'patrol', {}, dt, t)
      if (e.facing !== prevFacing) {
        flips++
        prevFacing = e.facing
      }
    }
    // Over ~20s at 90px/s across an 900px floor it must have turned at least twice.
    expect(flips).toBeGreaterThanOrEqual(2)
    // Never fell through the floor.
    expect(e.grounded).toBe(true)
  })

  it('STOMP: a player falling onto the enemy defeats it and bounces up', () => {
    const player = makeKinematic(0, 230) // above the enemy, will fall
    const enemy = makeKinematic(5, 260) // on the floor, overlapping x with player
    enemy.facing = 1
    let defeated = false
    let bounced = false

    for (let i = 0; i < 200 && !defeated; i++) {
      stepEntity(player, pSamples, [floor], neutral(), 'platformer', {}, dt, t)
      if (!defeated) stepEntity(enemy, eSamples, [floor], neutral(), 'patrol', {}, dt, t)

      if (overlap(aabb(player, pSamples), aabb(enemy, eSamples))) {
        const pV = verticalBounds(player, pSamples)
        const eV = verticalBounds(enemy, eSamples)
        if (stompCheck(pV.bottom, player.vy, eV.top, eV.bottom) === 'stomp') {
          defeated = true
          player.vy = -t.jumpSpeed * 0.7 // the bounce the engine applies
          bounced = true
        }
      }
    }
    expect(defeated).toBe(true)
    expect(bounced).toBe(true)
    expect(player.vy).toBeLessThan(0) // launched upward by the bounce
  })

  it('KILL: a player walking into the enemy from the side is killed (side hit)', () => {
    // Player already grounded, running right INTO an enemy at the same level.
    const player = makeKinematic(0, 260) // on the floor
    const enemy = makeKinematic(40, 260) // just to the right, same level
    let killed = false

    for (let i = 0; i < 200 && !killed; i++) {
      stepEntity(player, pSamples, [floor], { dir: 1, jumpPressed: false, jumpReleased: false }, 'platformer', {}, dt, t)
      stepEntity(enemy, eSamples, [floor], neutral(), 'patrol', {}, dt, t)
      if (overlap(aabb(player, pSamples), aabb(enemy, eSamples))) {
        const pV = verticalBounds(player, pSamples)
        const eV = verticalBounds(enemy, eSamples)
        if (stompCheck(pV.bottom, player.vy, eV.top, eV.bottom) === 'kill') killed = true
        else break // if it registered a stomp instead, the test's premise is wrong
      }
    }
    expect(killed).toBe(true)
  })

  it('default patrol speed is used when no param given', () => {
    const e = makeKinematic(0, 260)
    e.facing = 1
    stepEntity(e, eSamples, [floor], neutral(), 'patrol', {}, dt, t)
    // First substep sets vx = facing * DEFAULT_PATROL_SPEED before integration.
    // After one step it has moved ~ DEFAULT_PATROL_SPEED * dt.
    expect(e.x).toBeGreaterThan(0)
    expect(e.x).toBeLessThan(DEFAULT_PATROL_SPEED * dt * 2)
  })
})

function neutral() {
  return { dir: 0, jumpPressed: false, jumpReleased: false }
}
