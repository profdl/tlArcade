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
