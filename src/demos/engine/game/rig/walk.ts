/**
 * Engine — procedural walk cycle (R2, sine-driven).
 *
 * PURE, editor-free (like physics.ts): given the player's live sim state it returns
 * a `Pose` (per-bone rotation overrides) that swings the arms and legs. No keyframe
 * data — the walk emerges from a sine, so it's cheap and instantly tunable. A
 * keyframed Clip system can layer on later (R2b); this is the immediate default so
 * the builder player visibly walks the moment you Play.
 *
 * The cycle: `phase = simTime · cadence`. Legs swing OPPOSED (one forward while the
 * other's back); arms COUNTER the legs (natural gait). Amplitude scales with speed
 * (|vx| → 0..1 of maxSpeed) and is ZERO unless grounded AND moving — so standing
 * still, jumping, and falling all rest (empty pose ⇒ the evaluator yields identity ⇒
 * the figure looks exactly as drawn). Determinism: `simTime` is the runtime's fixed
 * substep clock (never wall-clock), so the walk is reproducible.
 */
import type { Pose } from './evaluate'
import { BUILDER_LIMB_BONES } from './builderRig'

/** Tunables for the walk cycle. Defaults chosen for the 1×2 builder at moveSpeed 340. */
export interface WalkTunables {
  /** Max limb swing at full speed, radians (~30°). */
  amplitude: number
  /** Cycle rate: radians of phase per second at full speed. */
  cadence: number
  /** Speed (px/s) at/above which the swing is at full amplitude. */
  fullSpeed: number
  /** Below this speed (px/s) the player is treated as standing (rest pose). */
  minSpeed: number
}

export const WALK_DEFAULTS: WalkTunables = {
  amplitude: 0.52, // ~30°
  cadence: 9,
  fullSpeed: 340, // matches PHYSICS_DEFAULTS.moveSpeed
  minSpeed: 20,
}

/** Live inputs from the player's kinematic state. */
export interface WalkState {
  grounded: boolean
  /** Horizontal velocity, px/s (sign = facing; magnitude = speed). */
  vx: number
  /** The runtime's fixed-substep clock, seconds. */
  simTime: number
}

const REST: Pose = {}

/**
 * The pose for the current state. Returns the empty (rest) pose unless the player is
 * grounded and moving faster than `minSpeed`. Otherwise swings arms/legs on a sine.
 */
export function poseForState(state: WalkState, t: WalkTunables = WALK_DEFAULTS): Pose {
  const speed = Math.abs(state.vx)
  if (!state.grounded || speed < t.minSpeed) return REST

  // Amplitude scales 0..1 with speed up to fullSpeed.
  const drive = Math.min(1, speed / t.fullSpeed)
  const amp = t.amplitude * drive
  const swing = Math.sin(state.simTime * t.cadence) * amp

  // Legs opposed; arms counter the legs. (Keys match BUILDER_LIMB_BONES.)
  return {
    legL: { rotation: swing },
    legR: { rotation: -swing },
    armL: { rotation: -swing },
    armR: { rotation: swing },
  }
}

/** Guard: the walk drives exactly the builder's limb bones (keeps them in sync). */
export const WALK_BONES = BUILDER_LIMB_BONES
