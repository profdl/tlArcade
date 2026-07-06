import { describe, expect, it } from 'vitest'
import type { Body, Pt } from '../collision'
import { makeTunables, SIM } from '../physics'
import { makeKinematic } from './types'
import { stepEntity, verticalBounds } from './step'
import { belowKillPlane } from './props'

// Integration-level test of the T0 kill-plane: it drives a REAL player entity
// through the REAL pure sim (stepEntity) off the edge of a floor and into a pit,
// then reproduces the engine's checkKillPlane decision — `belowKillPlane(
// verticalBounds(kin, samples).top, deathY)` — so the whole "walk off a ledge →
// fall → cross the plane → die" flow is exercised end-to-end without an editor,
// exactly like enemy.integration.test.ts does for stomp/kill.

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

// A player-sized outline (1×2 tiles = 60×120), sampled around the perimeter, in
// entity-local space (added to kin.x/kin.y at read time) — the same convention the
// engine uses for playerSamples.
function playerBox(w = 60, h = 120): Pt[] {
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ]
}

/** How the engine computes deathY at start(): a margin below the deepest solid. */
function killPlaneOf(solids: Body[], margin: number): number {
  const lowest = solids.reduce((m, b) => Math.max(m, b.bounds.maxY), -Infinity)
  return lowest + margin
}

describe('kill-plane (T0) — end-to-end fall into a pit', () => {
  it('a player that walks off a ledge falls and eventually crosses the kill-plane', () => {
    // A short floor that ENDS at x=200, then open space (a bottomless pit). Floor
    // top at y=480 (a tile row), 60px thick → maxY 540.
    const floor = rect(0, 480, 200, 60)
    const solids = [floor]
    const margin = 60 * 4 // KILL_PLANE_MARGIN (4 tiles), mirrored from engine.ts
    const deathY = killPlaneOf(solids, margin) // 540 + 240 = 780
    const samples = playerBox()

    // Start the player standing ON the floor at its right edge, walking right so it
    // steps off into the pit. Bounds top-left at (160, 360) → feet at y=480.
    const kin = makeKinematic(160, 360)
    kin.grounded = true

    // Sanity: on the floor, nowhere near the plane.
    expect(belowKillPlane(verticalBounds(kin, samples).top, deathY)).toBe(false)

    // Walk right and let gravity take over past the ledge. Run the real sim until
    // the whole body clears the plane (or a generous cap so a bug can't hang it).
    let died = false
    for (let i = 0; i < 600; i++) {
      stepEntity(kin, samples, solids, { dir: 1, jumpPressed: false, jumpReleased: false }, 'platformer', {}, dt, t)
      if (belowKillPlane(verticalBounds(kin, samples).top, deathY)) {
        died = true
        break
      }
    }
    expect(died).toBe(true)
    // It died by FALLING (below the floor), not by any sideways glitch.
    expect(kin.y).toBeGreaterThan(deathY)
  })

  it('a player standing on solid ground never crosses the kill-plane', () => {
    // A wide floor the player stays on; walking right stays grounded the whole time.
    const floor = rect(0, 480, 2000, 60)
    const solids = [floor]
    const deathY = killPlaneOf(solids, 60 * 4)
    const samples = playerBox()
    const kin = makeKinematic(100, 360) // on the floor

    for (let i = 0; i < 600; i++) {
      stepEntity(kin, samples, solids, { dir: 1, jumpPressed: false, jumpReleased: false }, 'platformer', {}, dt, t)
      expect(belowKillPlane(verticalBounds(kin, samples).top, deathY)).toBe(false)
    }
    // Stayed grounded on the floor the whole run.
    expect(kin.grounded).toBe(true)
  })

  it('a 2-tile gap jump clears the pit and lands safely (no false death)', () => {
    // Two floor runs split by a 2-tile (120px) gap — the canonical level shape. A
    // well-timed jump must clear it and land on the far side WITHOUT the kill-plane
    // firing (the behavior every existing template relies on).
    const left = rect(0, 480, 200, 60) // ends at x=200
    const right = rect(320, 480, 400, 60) // starts at x=320 (120px gap)
    const solids = [left, right]
    const deathY = killPlaneOf(solids, 60 * 4)
    const samples = playerBox()
    const kin = makeKinematic(20, 360) // on the left run, room to run up to speed
    kin.grounded = true

    let crossed = false
    let landedRight = false
    let jumped = false
    for (let i = 0; i < 400; i++) {
      // Run right; jump ONCE as the player's right edge nears the ledge at x=200
      // (buffer/coyote handle the exact frame). Player is 60px wide, so its right
      // edge is kin.x + 60.
      const doJump = !jumped && kin.grounded && kin.x + 60 > 175
      if (doJump) jumped = true
      stepEntity(
        kin,
        samples,
        solids,
        { dir: 1, jumpPressed: doJump, jumpReleased: false },
        'platformer',
        {},
        dt,
        t,
      )
      if (belowKillPlane(verticalBounds(kin, samples).top, deathY)) crossed = true
      // Landed on the far run past the gap → the jump succeeded; stop here (running
      // on would eventually walk off the FAR end of the finite floor, an unrelated
      // fall that would muddy the assertion).
      if (kin.grounded && kin.x > 320) {
        landedRight = true
        break
      }
    }
    // Made it across and never fell into the pit.
    expect(landedRight).toBe(true)
    expect(crossed).toBe(false)
  })
})
