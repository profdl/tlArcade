import { describe, expect, it } from 'vitest'
import { CAMERA_DEFAULTS, computeCamera, type CameraState, type Viewport } from './camera'

// Characterization tests for the pure follow-camera math. Like step.test.ts these
// use plain hand-built inputs (no editor, no tldraw) and PIN the deadzone / look-
// ahead / smoothing / zoom-passthrough semantics. Never edit these to make a change
// pass; a failure means the camera feel drifted.

const viewport: Viewport = { w: 800, h: 600 }

/** A camera at (x,y,z). z=1 (100%) unless a test needs a zoomed passthrough. */
const cam = (x: number, y: number, z = 1): CameraState => ({ x, y, z })

/** The player's page center under `cam` sits at page point p where (p+cam)*z = screenCenter. */
function centeredPlayerX(c: CameraState): number {
  // screen center = viewport.w/2; screen = (page + cam.x)*z → page = screenCenter/z - cam.x
  return viewport.w / 2 / c.z - c.x
}
function centeredPlayerY(c: CameraState): number {
  return viewport.h / 2 / c.z - c.y
}

describe('computeCamera — deadzone hold', () => {
  it('holds x/y when the player sits centered in the deadzone', () => {
    const prev = cam(-100, -50)
    const player = { x: centeredPlayerX(prev), y: centeredPlayerY(prev), vx: 0, vy: 0 }
    const next = computeCamera(player, viewport, prev)
    // Player is dead-center and not moving → nothing to pursue, camera holds.
    expect(next.x).toBeCloseTo(prev.x, 6)
    expect(next.y).toBeCloseTo(prev.y, 6)
  })

  it('holds x while the player is still inside the horizontal band', () => {
    const prev = cam(0, 0)
    // Nudge the player just inside the half-band (deadzoneW/2) from center.
    const nudge = CAMERA_DEFAULTS.deadzoneW / 2 - 10 // screen px, inside the band
    const player = { x: centeredPlayerX(prev) + nudge, y: centeredPlayerY(prev), vx: 0, vy: 0 }
    const next = computeCamera(player, viewport, prev)
    expect(next.x).toBeCloseTo(prev.x, 6)
  })
})

describe('computeCamera — follow (deadzone exit)', () => {
  it('scrolls x to follow once the player leaves the band, monotonically with player x', () => {
    const prev = cam(0, 0)
    const base = centeredPlayerX(prev)
    const far = CAMERA_DEFAULTS.deadzoneW / 2 + 200 // well outside the band, screen px
    const a = computeCamera({ x: base + far, y: centeredPlayerY(prev), vx: 0, vy: 0 }, viewport, prev)
    const b = computeCamera({ x: base + far + 300, y: centeredPlayerY(prev), vx: 0, vy: 0 }, viewport, prev)
    // Camera moved off its held x…
    expect(a.x).not.toBeCloseTo(prev.x, 3)
    // …and a further-right player yields a more-negative camera x (target = s/z - p,
    // so larger page x ⇒ smaller camera x). Monotonic in player x.
    expect(b.x).toBeLessThan(a.x)
  })
})

describe('computeCamera — look-ahead', () => {
  it('same position, +vx vs -vx leads the camera target in opposite directions', () => {
    // Put the player OUTSIDE the band so the target (with look-ahead) is pursued.
    const prev = cam(0, 0)
    const px = centeredPlayerX(prev) + CAMERA_DEFAULTS.deadzoneW / 2 + 300
    const py = centeredPlayerY(prev) + CAMERA_DEFAULTS.deadzoneH / 2 + 300
    const right = computeCamera({ x: px, y: py, vx: 400, vy: 0 }, viewport, prev)
    const left = computeCamera({ x: px, y: py, vx: -400, vy: 0 }, viewport, prev)
    const none = computeCamera({ x: px, y: py, vx: 0, vy: 0 }, viewport, prev)
    // Look-ahead shifts the SCREEN target by leadX = vx*lookAhead. targetX = s/z - p,
    // so a larger screen target ⇒ larger camera x. Thus +vx leads camera x ABOVE the
    // no-lead case and -vx leads it BELOW — opposite sides of the neutral target.
    expect(right.x).toBeGreaterThan(none.x)
    expect(left.x).toBeLessThan(none.x)
    expect(right.x).toBeGreaterThan(left.x)
  })
})

describe('computeCamera — smoothing (lerp)', () => {
  it('smooth < 1 moves only partway toward the target in one call', () => {
    const prev = cam(0, 0)
    const base = centeredPlayerX(prev)
    const far = CAMERA_DEFAULTS.deadzoneW / 2 + 500
    const player = { x: base + far, y: centeredPlayerY(prev), vx: 0, vy: 0 }
    // With the shipped smooth (<1) the camera should not reach the full target in one step.
    const eased = computeCamera(player, viewport, prev, CAMERA_DEFAULTS)
    // With smooth = 1 it should snap all the way — that's the "full target".
    const snapped = computeCamera(player, viewport, prev, { ...CAMERA_DEFAULTS, smooth: 1 })
    // Eased is strictly between prev and the snapped target.
    expect(CAMERA_DEFAULTS.smooth).toBeLessThan(1)
    expect(eased.x).not.toBeCloseTo(prev.x, 3)
    expect(eased.x).not.toBeCloseTo(snapped.x, 3)
    // Partway: |eased - prev| ≈ smooth * |snapped - prev|.
    const frac = (eased.x - prev.x) / (snapped.x - prev.x)
    expect(frac).toBeCloseTo(CAMERA_DEFAULTS.smooth, 5)
  })

  it('smooth = 1 snaps the player to the band EDGE, not screen center', () => {
    const prev = cam(10, 20)
    const base = centeredPlayerX(prev)
    const player = { x: base + CAMERA_DEFAULTS.deadzoneW, y: centeredPlayerY(prev), vx: 0, vy: 0 }
    const snapped = computeCamera(player, viewport, prev, { ...CAMERA_DEFAULTS, smooth: 1 })
    // The deadzone is a BOUNDARY, not a snap-to-center: a player pushed past the
    // right edge lands exactly on the edge (center + halfW), NOT at screen center.
    // This is what prevents the fast-move stutter (chase-to-center → overshoot →
    // fall back inside band → hold → repeat).
    const screenX = (player.x + snapped.x) * snapped.z
    expect(screenX).toBeCloseTo(viewport.w / 2 + CAMERA_DEFAULTS.deadzoneW / 2, 4)
  })
})

describe('computeCamera — anti-stutter (deadzone is a boundary)', () => {
  it('a player riding steadily past the edge does NOT oscillate in/out of the band', () => {
    // Simulate a fast right-runner over many frames at smooth=1 (worst case for
    // overshoot). Each frame the player advances a fixed page step; feed the camera
    // its own previous output. The player's on-screen x must not bounce back and
    // forth across the band edge — with edge-correction it converges to the edge and
    // stays pinned there (drift within one page-step), never overshooting to center.
    const t = { ...CAMERA_DEFAULTS, smooth: 1 }
    let prev = cam(0, 0)
    const step = 6 // page px advanced per frame (a fast run)
    let px = centeredPlayerX(prev)
    // Band edge including the constant look-ahead lead (vx*lookAhead, clamped).
    const lead = Math.min(400 * CAMERA_DEFAULTS.lookAhead, CAMERA_DEFAULTS.lookAheadMax)
    const edge = viewport.w / 2 + lead + t.deadzoneW / 2
    const screensAtEdge: number[] = []
    for (let i = 0; i < 200; i++) {
      px += step
      const next = computeCamera({ x: px, y: centeredPlayerY(prev), vx: 400, vy: 0 }, viewport, prev, t)
      prev = next
      const screenX = (px + next.x) * next.z
      if (i > 60) screensAtEdge.push(screenX) // sample well after convergence
    }
    // Once converged, the player sits pinned at the leading edge every frame — the
    // spread across frames is ~0 (a fixed point), NOT oscillating. A snap-to-center
    // camera would instead swing the player by ~deadzoneW/2 each frame.
    const min = Math.min(...screensAtEdge)
    const max = Math.max(...screensAtEdge)
    expect(max - min).toBeLessThan(1) // pinned steady — no stutter
    expect(min).toBeCloseTo(edge, 0) // pinned AT the leading edge, not center
  })
})

describe('computeCamera — zoom passthrough', () => {
  it('passes z through unchanged for any zoom', () => {
    for (const z of [0.5, 1, 2, 3.5]) {
      const prev = cam(0, 0, z)
      const player = { x: centeredPlayerX(prev) + 1000, y: centeredPlayerY(prev) + 1000, vx: 200, vy: 200 }
      const next = computeCamera(player, viewport, prev)
      expect(next.z).toBe(z)
    }
  })
})
