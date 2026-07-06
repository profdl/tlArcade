/**
 * Engine — the physics tunables and the pure "game feel" math.
 *
 * The FEEL of a platformer lives almost entirely in the input→velocity→jump
 * pipeline, not in collision. This module isolates that:
 *
 *  - `PHYSICS_DEFAULTS` is the single source of truth for every tunable, tuned
 *    "tight & snappy" (Celeste-like): fast ground accel, high friction, short
 *    coyote/buffer windows, a hard jump-cut for crisp short hops.
 *  - `PhysicsTunables` is the shape of that object; the runtime holds a MUTABLE
 *    copy so the live debug panel (render/PhysicsPanel.tsx) can dial values in
 *    during play without a rebuild. Find the feel, then paste the numbers back
 *    here as the new defaults.
 *  - The pure helpers (`approach`, `applyGravity`, jump/coyote/buffer logic) are
 *    editor-free so they can be unit-tested directly (see physics.test.ts).
 *
 * Nothing here touches tldraw or the editor — it's all plain numbers. The engine
 * (engine.ts) owns the timers/velocity state and calls these each substep.
 */

/** Every tunable that shapes how the player moves. All live-editable. */
export interface PhysicsTunables {
  // --- gravity / fall ---
  /** Base downward acceleration, px/s². */
  gravity: number
  /** Extra gravity multiplier while falling (vy > 0) — a snappy, weighty fall. */
  fallGravityMult: number
  /** Reduced gravity multiplier near the apex (|vy| small) — a floaty peak. */
  apexGravityMult: number
  /** Speed band (px/s) around vy=0 that counts as "the apex". */
  apexThreshold: number
  /** Terminal downward speed, px/s. */
  maxFall: number

  // --- horizontal movement ---
  /** Target horizontal speed, px/s. */
  moveSpeed: number
  /** How fast vx climbs toward the target on the ground, px/s². */
  groundAccel: number
  /** How fast vx bleeds to 0 with no input on the ground, px/s². */
  groundFriction: number
  /** Horizontal accel toward target while airborne, px/s² (usually < ground). */
  airAccel: number
  /** Horizontal decel with no input while airborne, px/s² (usually < ground). */
  airFriction: number

  // --- jump ---
  /** Initial upward velocity of a jump, px/s. */
  jumpSpeed: number
  /**
   * Fraction of upward velocity KEPT when the jump key is released while still
   * rising — the variable-jump-height cut. 0.4 = releasing early keeps 40% of
   * the rise (short hop); 1 disables the feature (every jump is full height).
   */
  jumpCut: number
  /** Grace window (s) after leaving a ledge in which a jump still fires (coyote time). */
  coyoteTime: number
  /** Window (s) before landing in which a jump press is remembered and fires on touchdown. */
  jumpBuffer: number

  // --- collision feel (read by the engine's resolver) ---
  /**
   * Max horizontal nudge (px) applied to slip past a corner on a ceiling bonk,
   * so clipping a corner by a few px doesn't kill an otherwise-clean jump.
   */
  cornerCorrect: number
}

/** Tight & snappy (Celeste-like) defaults. Source of truth for the tunables. */
export const PHYSICS_DEFAULTS: PhysicsTunables = {
  gravity: 2600,
  fallGravityMult: 1.35,
  apexGravityMult: 0.55,
  apexThreshold: 90,
  maxFall: 1800,

  moveSpeed: 340,
  groundAccel: 4200,
  groundFriction: 3600,
  airAccel: 2600,
  airFriction: 900,

  jumpSpeed: 860,
  jumpCut: 0.4,
  coyoteTime: 0.09,
  jumpBuffer: 0.1,

  cornerCorrect: 8,
} as const

/** Non-feel constants that never need live tuning. */
export const SIM = {
  FIXED_DT: 1 / 120, // sim substep
  MAX_FRAME: 0.05, // clamp real dt so a stall can't spiral the sim
  // A push-out whose normal is at least this far from horizontal (|ny| above it)
  // counts as "floor-ish" and grounds the player when it opposes a downward move.
  GROUND_NY: 0.64,
  // On the X pass, only a contact this horizontal (|nx| above it) is a WALL that
  // stops sideways motion; a slope's normal is mostly vertical, so it's ignored
  // on X and the player walks up it via the Y pass.
  WALL_NX: 0.82,
} as const

/** A fresh mutable copy of the defaults (what the runtime edits live). */
export function makeTunables(): PhysicsTunables {
  return { ...PHYSICS_DEFAULTS }
}

/** One slider's metadata for the live debug panel. */
export interface TunableSpec {
  key: keyof PhysicsTunables
  label: string
  min: number
  max: number
  step: number
}

/**
 * The debug panel's layout: sliders grouped by feel category, in tuning order.
 * Ranges are chosen to span "clearly too little" → "clearly too much" around
 * each default, so the panel is a usable exploration space, not just a nudge.
 */
export const TUNABLE_GROUPS: { title: string; specs: TunableSpec[] }[] = [
  {
    title: 'Move',
    specs: [
      { key: 'moveSpeed', label: 'Speed', min: 60, max: 700, step: 10 },
      { key: 'groundAccel', label: 'Ground accel', min: 200, max: 12000, step: 100 },
      { key: 'groundFriction', label: 'Ground friction', min: 200, max: 12000, step: 100 },
      { key: 'airAccel', label: 'Air accel', min: 0, max: 12000, step: 100 },
      { key: 'airFriction', label: 'Air friction', min: 0, max: 6000, step: 50 },
    ],
  },
  {
    title: 'Jump',
    specs: [
      { key: 'jumpSpeed', label: 'Jump power', min: 200, max: 1600, step: 20 },
      { key: 'jumpCut', label: 'Short-hop cut', min: 0, max: 1, step: 0.05 },
      { key: 'coyoteTime', label: 'Coyote time', min: 0, max: 0.3, step: 0.01 },
      { key: 'jumpBuffer', label: 'Jump buffer', min: 0, max: 0.3, step: 0.01 },
      { key: 'cornerCorrect', label: 'Corner correct', min: 0, max: 20, step: 1 },
    ],
  },
  {
    title: 'Gravity',
    specs: [
      { key: 'gravity', label: 'Gravity', min: 400, max: 6000, step: 50 },
      { key: 'fallGravityMult', label: 'Fall mult', min: 1, max: 3, step: 0.05 },
      { key: 'apexGravityMult', label: 'Apex mult', min: 0.2, max: 1, step: 0.05 },
      { key: 'apexThreshold', label: 'Apex band', min: 0, max: 300, step: 10 },
      { key: 'maxFall', label: 'Terminal fall', min: 400, max: 4000, step: 50 },
    ],
  },
]

/**
 * Move `current` toward `target` by at most `maxDelta` (an accel/friction step).
 * Never overshoots — the classic "approach"/"move-towards" used for smooth but
 * bounded velocity changes.
 */
export function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(current + maxDelta, target)
  if (current > target) return Math.max(current - maxDelta, target)
  return target
}

/**
 * Next horizontal velocity given input direction (-1/0/1), whether the player is
 * on the ground, and dt. Accelerates toward `dir * moveSpeed`; with no input,
 * applies friction toward 0. Ground and air use different rates so air control
 * feels lighter (a hallmark of tight platformers).
 */
export function stepVx(
  vx: number,
  dir: number,
  grounded: boolean,
  dt: number,
  t: PhysicsTunables,
): number {
  if (dir !== 0) {
    const accel = grounded ? t.groundAccel : t.airAccel
    return approach(vx, dir * t.moveSpeed, accel * dt)
  }
  const friction = grounded ? t.groundFriction : t.airFriction
  return approach(vx, 0, friction * dt)
}

/**
 * The gravity multiplier for this instant: heavier while falling, lighter near
 * the apex (so the top of the arc hangs). Rising fast uses base gravity (1).
 */
export function gravityMult(vy: number, t: PhysicsTunables): number {
  if (Math.abs(vy) < t.apexThreshold) return t.apexGravityMult
  if (vy > 0) return t.fallGravityMult
  return 1
}

/** Next vertical velocity after one gravity step (clamped to terminal fall). */
export function stepVy(vy: number, dt: number, t: PhysicsTunables): number {
  const g = t.gravity * gravityMult(vy, t) * dt
  return Math.min(vy + g, t.maxFall)
}
