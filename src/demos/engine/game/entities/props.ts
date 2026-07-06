/**
 * Engine — pure decision helpers for the static-prop roles (G3a): spring
 * (bounce pad), one-way platform, and checkpoint.
 *
 * Like `step.ts`, this is EDITOR-FREE and unit-tested: the runtime (engine.ts)
 * owns the glue (reading overlaps, mutating velocity, moving the respawn point),
 * and calls these tiny, obviously-correct functions to make each decision. No
 * tldraw import here — it's just arithmetic and set membership so the integrator
 * can wire it with confidence (see props.test.ts).
 */

/**
 * Spring / bounce pad: when the player overlaps a spring trigger, launch it
 * straight UP. Given the runtime's tunable base impulse, return the upward launch
 * velocity — always negative (page-space Y grows DOWNWARD, so up is negative vy),
 * regardless of the impulse's sign. The runtime assigns this to `kin.vy`.
 */
export function springLaunchVy(impulse: number): number {
  return -Math.abs(impulse)
}

/**
 * Angled spring launch vector (T1a): a generalization of `springLaunchVy` to a
 * direction. `angleDeg` is measured from straight-UP, positive tilting RIGHT: 0 =
 * straight up (identical to `springLaunchVy` — `{vx:0, vy:-|impulse|}`), +45 = up-
 * and-right, -45 = up-and-left, ±90 = horizontal. The magnitude is always
 * `|impulse|`. The runtime assigns `vx`/`vy` to the player.
 */
export function springLaunchV(impulse: number, angleDeg = 0): { vx: number; vy: number } {
  const mag = Math.abs(impulse)
  const rad = (angleDeg * Math.PI) / 180
  return { vx: mag * Math.sin(rad), vy: -mag * Math.cos(rad) }
}

/**
 * One-way platform: a platform you can jump UP through from below but LAND ON
 * from above. Given the player's bottom-Y last frame (`prevBottom`) and this frame
 * (`curBottom`) and the platform's top-Y (`platformTop`), decide whether this
 * Y-move should be treated as solid (a landing) or passed through.
 *
 * Block (land) iff the player was ABOVE the platform top last frame and is at or
 * below it now, AND is moving downward. Any other case — rising up through it, or
 * already below it last frame (you came from underneath) — passes through.
 *
 * @returns true = treat as solid this step (land on it); false = pass through.
 */
export function oneWayBlocks(
  prevBottom: number,
  curBottom: number,
  platformTop: number,
  movingDown: boolean,
): boolean {
  return movingDown && prevBottom <= platformTop && curBottom >= platformTop
}

/**
 * Checkpoint: a checkpoint only "activates" the first time the player touches it.
 * Given a checkpoint's id and the set of already-activated ids, return whether
 * this touch should activate it (move the respawn point here). The runtime adds
 * the id to the set after acting, so subsequent touches are no-ops.
 *
 * @returns true = activate (id not yet in the set); false = already activated.
 */
export function shouldActivateCheckpoint(id: string, activated: ReadonlySet<string>): boolean {
  return !activated.has(id)
}

/**
 * Blink platform (T1f): is it solid at sim time `t` (seconds)? It cycles solid for
 * `onMs`, gone for `offMs`, forever; `phaseMs` shifts the cycle so a row of
 * blinkers can alternate. Pure — the runtime includes the platform in the player's
 * solids only when this is true.
 *
 * @returns true = present (solid) this frame; false = gone (pass through / fall).
 */
export function blinkSolidAt(tSec: number, onMs: number, offMs: number, phaseMs = 0): boolean {
  const period = onMs + offMs
  if (period <= 0) return true // degenerate config ⇒ always solid
  const ms = ((tSec * 1000 + phaseMs) % period + period) % period
  return ms < onMs
}

/**
 * Crumble platform (T1f): has it fallen away? Once the player first stands on it at
 * `standStartMs`, it stays solid for `crumbleMs`, then drops out. Given the first-
 * stand time (or null if never stood on) and the current time, decide if it's gone.
 * Pure.
 *
 * @param standStartMs sim ms when the player first stood on it, or null if not yet.
 * @param nowMs current sim ms.
 * @param crumbleMs delay from first-stand to falling away.
 * @returns true = crumbled away (no longer solid).
 */
export function crumbleGone(standStartMs: number | null, nowMs: number, crumbleMs: number): boolean {
  if (standStartMs == null) return false // never triggered ⇒ still solid
  return nowMs - standStartMs >= crumbleMs
}

/**
 * Kill-plane / bottomless pit (T0): a horizontal death line below the level. An
 * entity has fallen off once its ENTIRE body is below the plane — i.e. its outline
 * TOP (the highest point, smallest y; page-space y grows DOWNWARD) is past it. We
 * use the top rather than the bottom so the whole body must clear the plane before
 * it fires, matching the "fall all the way off the screen" feel — a body still
 * straddling the line hasn't fallen yet.
 *
 * @param topY the entity outline's topmost (minimum) page-space Y this frame.
 * @param deathY the kill-plane's page-space Y (anything strictly below dies).
 * @returns true = the entity has fallen off (past the plane).
 */
export function belowKillPlane(topY: number, deathY: number): boolean {
  return topY > deathY
}
