import { describe, expect, it } from 'vitest'
import { penetration, pointInPolygon, type Body } from './collision'

// These tests exercise the pure collision math directly. Bodies are plain data
// (page-space outline + closed/margin), so no editor is needed — the risky part
// of the geometry-accurate collision is the push-out NORMAL and DEPTH, and in
// particular that a slope's normal is mostly-vertical (which is what lets the
// engine treat a hill as walkable in both directions rather than a wall).

const boundsOf = (pts: { x: number; y: number }[]) => ({
  minX: Math.min(...pts.map((p) => p.x)),
  minY: Math.min(...pts.map((p) => p.y)),
  maxX: Math.max(...pts.map((p) => p.x)),
  maxY: Math.max(...pts.map((p) => p.y)),
})

/** A filled rectangle from (0,0) to (w,h). */
function rectBody(w: number, h: number): Body {
  const pts = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ]
  return { pts, closed: true, bounds: boundsOf(pts), margin: 0 }
}

/** An open stroke (band) along the given polyline, half-thickness `margin`. */
function bandBody(pts: { x: number; y: number }[], margin: number): Body {
  return { pts, closed: false, bounds: boundsOf(pts), margin }
}

describe('penetration — closed polygon (filled wall)', () => {
  const wall = rectBody(100, 40)

  it('returns null for a point outside', () => {
    expect(penetration({ x: -5, y: 20 }, wall)).toBeNull()
    expect(penetration({ x: 50, y: 50 }, wall)).toBeNull()
  })

  it('pushes a point just below the top edge straight UP (floor normal)', () => {
    const hit = penetration({ x: 50, y: 6 }, wall)
    expect(hit).not.toBeNull()
    expect(hit!.ny).toBeLessThan(0) // outward normal points up
    expect(Math.abs(hit!.nx)).toBeLessThan(1e-6) // straight up, no sideways
    expect(hit!.depth).toBeCloseTo(6, 5) // distance back to the top surface
  })

  it('pushes a point near the left edge straight LEFT (wall normal)', () => {
    const hit = penetration({ x: 4, y: 20 }, wall)
    expect(hit).not.toBeNull()
    expect(hit!.nx).toBeLessThan(0) // outward normal points left
    expect(Math.abs(hit!.ny)).toBeLessThan(1e-6)
    expect(hit!.depth).toBeCloseTo(4, 5)
  })
})

describe('penetration — open band (drawn hill)', () => {
  // A 45°-down-to-the-right ramp: from (0,0) to (100,100). Its surface normal
  // is diagonal, so |nx| ~ |ny| ~ 0.707 — mostly-neither, but crucially NOT a
  // near-vertical wall normal, which is why the engine lets the player climb it.
  const ramp = bandBody(
    [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ],
    9,
  )

  it('is null well away from the line', () => {
    expect(penetration({ x: 80, y: 0 }, ramp)).toBeNull()
  })

  it('pushes a point above the ramp up-and-right, off the surface', () => {
    // Point (50,44) sits just ABOVE the line y=x (smaller y for its x). The
    // nearest surface point is (47,47), so the outward normal (p - pt) is
    // up-and-right: nx>0, ny<0.
    const hit = penetration({ x: 50, y: 44 }, ramp)
    expect(hit).not.toBeNull()
    expect(hit!.nx).toBeGreaterThan(0)
    expect(hit!.ny).toBeLessThan(0)
    // Diagonal normal: neither component dominates (it's a slope, not a wall) —
    // so on the engine's X pass |nx| stays below WALL_NX and the hill is climbable.
    expect(Math.abs(hit!.nx)).toBeCloseTo(Math.abs(hit!.ny), 5)
    expect(Math.abs(hit!.nx)).toBeLessThan(0.82) // engine's WALL_NX
  })

  it('pushes a point below the ramp down-and-left (two-sided band)', () => {
    const hit = penetration({ x: 50, y: 56 }, ramp)
    expect(hit).not.toBeNull()
    expect(hit!.nx).toBeLessThan(0)
    expect(hit!.ny).toBeGreaterThan(0)
  })
})

describe('pointInPolygon', () => {
  const tri = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 50, y: 100 },
  ]
  it('is true for the centroid, false outside the slanted edges', () => {
    expect(pointInPolygon({ x: 50, y: 30 }, tri)).toBe(true)
    // A point inside the triangle's AABB but outside its actual left edge — the
    // whole point of perimeter collision vs. bounding-box collision.
    expect(pointInPolygon({ x: 5, y: 90 }, tri)).toBe(false)
  })
})
