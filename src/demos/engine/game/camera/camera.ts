/**
 * Engine — the pure, editor-free follow-camera math.
 *
 * A platformer camera does one job: keep the player comfortably on screen without
 * jitter. The FEEL of that is a small pipeline — a no-scroll deadzone, velocity
 * look-ahead so you see where you're going, and a per-frame smoothing lerp — and,
 * exactly like physics.ts, it's all plain numbers here: no tldraw import, no
 * editor. The runtime calls `computeCamera` each frame with the player's page
 * position and the viewport size, then applies the result via
 * `editor.setCamera({ x, y, z })`.
 *
 *  - `CAMERA_DEFAULTS` is the single source of truth for every tunable, following
 *    the same "tunables + defaults" shape physics.ts uses.
 *  - `computeCamera` is a pure function of (player, viewport, prev camera): it holds
 *    x/y while the player sits inside a centered deadzone, leads the player in the
 *    direction of travel, and lerps toward that target by `smooth`. `z` (zoom) is
 *    passed through unchanged — the runtime owns zoom.
 *
 * COORDINATE / SIGN CONVENTION (the one spot to flip if the runtime says so):
 * tldraw's screen position of a page point `p` is `(p + camera) * z`. So to place
 * a page point `p` at a given SCREEN position `s` (in screen px, before zoom), the
 * camera translation must be `camera = s / z - p`. We want the player's page center
 * to land at a target SCREEN position (screen-center, nudged by look-ahead), so:
 *
 *     targetCameraX = screenTargetX / z - playerPageX
 *
 * If the integrator finds the world scrolls the wrong way, flip the sign of
 * `screenTargetToCamera` below — it is the SINGLE, clearly-marked place that
 * encodes the mapping, and nothing else in this file assumes a direction.
 */

/** Every tunable that shapes how the follow camera feels. */
export interface CameraTunables {
  /** Horizontal no-scroll band width (screen px), centered — camera holds inside it. */
  deadzoneW: number
  /** Vertical no-scroll band height (screen px), centered — camera holds inside it. */
  deadzoneH: number
  /** How far (screen px) to lead the player per unit of speed, in the vx/vy direction. */
  lookAhead: number
  /** Clamp on the lead (screen px) so a fast player can't shove the target off-screen. */
  lookAheadMax: number
  /** Per-frame lerp factor toward the target, 0..1 (1 = snap instantly). */
  smooth: number
}

/** Smooth, roomy defaults. Source of truth for the camera tunables. */
export const CAMERA_DEFAULTS: CameraTunables = {
  deadzoneW: 240,
  deadzoneH: 180,
  lookAhead: 0.18,
  lookAheadMax: 160,
  smooth: 0.12,
} as const

/** The camera the runtime applies: page-space translation (x,y) + zoom (z). */
export interface CameraState {
  x: number
  y: number
  z: number
}

/** Viewport in screen px (the tldraw container size). */
export interface Viewport {
  w: number
  h: number
}

/**
 * Map a desired SCREEN target position (screen px, before zoom) for a page point
 * to the camera translation that places it there — the ONE spot encoding tldraw's
 * sign convention (see the module header). Flip the returned sign here if the
 * integrator finds the world scrolls the wrong way; nothing else in this file
 * assumes a direction.
 */
function screenTargetToCamera(screenTarget: number, pagePos: number, z: number): number {
  return screenTarget / z - pagePos
}

/**
 * Clamp `v` to ±limit (limit assumed ≥ 0). Used to bound the look-ahead lead.
 */
function clampAbs(v: number, limit: number): number {
  if (v > limit) return limit
  if (v < -limit) return -limit
  return v
}

/**
 * The follow-camera target + smoothing for one frame.
 *
 * Semantics:
 *  - **Deadzone**: the camera only scrolls when the player leaves a centered
 *    rectangle (deadzoneW × deadzoneH, screen px). While the player sits inside it,
 *    x/y HOLD (return equals prev on that axis, up to the lerp being a no-op). We
 *    detect this by asking where the player currently sits on screen under `prev`,
 *    and only moving the axis if that screen position is outside the band.
 *  - **Look-ahead**: the on-screen target is nudged from screen-center in the
 *    direction of travel by `clampAbs(vx * lookAhead, lookAheadMax)` (and a gentler
 *    y lead) — so you see where you're heading. x is the important axis for a
 *    platformer; y leads with the same knob so a dive/rise still reveals ahead.
 *  - **Smoothing**: lerp from `prev` toward the target by `smooth` (a `smooth` of 1
 *    snaps; a small value eases in over several frames).
 *  - **Zoom**: `z` is passed through from `prev` unchanged.
 */
export function computeCamera(
  player: { x: number; y: number; vx: number; vy: number },
  viewport: Viewport,
  prev: CameraState,
  t: CameraTunables = CAMERA_DEFAULTS,
): CameraState {
  const z = prev.z

  // Where does the player's page center sit on screen under the CURRENT camera?
  // screen = (page + camera) * z  →  in screen px.
  const screenX = (player.x + prev.x) * z
  const screenY = (player.y + prev.y) * z

  const centerX = viewport.w / 2
  const centerY = viewport.h / 2

  // Half-widths of the centered no-scroll band (screen px).
  const halfW = t.deadzoneW / 2
  const halfH = t.deadzoneH / 2

  // Look-ahead: lead the player in the direction of travel, clamped. Scales with
  // speed, so standing still leads nowhere and sprinting leads the most. y uses a
  // gentler lead (half) — vertical framing wants to be calmer than horizontal.
  const leadX = clampAbs(player.vx * t.lookAhead, t.lookAheadMax)
  const leadY = clampAbs(player.vy * t.lookAhead * 0.5, t.lookAheadMax * 0.5)

  // The SCREEN position we want the player to occupy: center, shifted by the lead.
  const screenTargetX = centerX + leadX
  const screenTargetY = centerY + leadY

  // Per axis: only pursue the target if the player is currently OUTSIDE the band on
  // that axis. Inside the band → keep prev (the camera holds, no scroll).
  const outsideX = Math.abs(screenX - centerX) > halfW
  const outsideY = Math.abs(screenY - centerY) > halfH

  const targetX = outsideX ? screenTargetToCamera(screenTargetX, player.x, z) : prev.x
  const targetY = outsideY ? screenTargetToCamera(screenTargetY, player.y, z) : prev.y

  // Smooth toward the target (lerp). `smooth` of 1 snaps; small values ease in.
  const s = t.smooth
  return {
    x: prev.x + (targetX - prev.x) * s,
    y: prev.y + (targetY - prev.y) * s,
    z,
  }
}
