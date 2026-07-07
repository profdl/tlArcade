/**
 * Engine — procedural character animation state machine (R2, Phase 1').
 *
 * PURE, editor-free (like physics.ts): given the player's live sim state it selects a
 * STATE (idle / walk / jump / fall) and returns a `Pose` — per-bone LOCAL deltas the
 * evaluator layers on the rest rig. No keyframe data yet; each state is a small sine/
 * offset function, so it's cheap and instantly tunable. Keyframed clips (clip.ts) can
 * layer on later; both paths just return a `Pose`, so the machine treats them alike.
 *
 * What animates now (the whole body, not just stick limbs):
 *   idle — a slow breathing bob (spine rise/fall + tiny head nod), arms/legs at rest.
 *   walk — legs swing opposed, arms counter them, the SPINE bobs twice per stride and
 *          leans into the direction of travel, the head counter-nods. Amplitude scales
 *          with speed; the whole rig MIRRORS by facing so it faces the way it moves.
 *   jump — rising: arms sweep up, legs tuck, torso stretches slightly (anticipation).
 *   fall — descending airborne: arms out for balance, legs trail, torso compresses.
 *
 * Determinism: `simTime` is the runtime's fixed-substep clock (never wall-clock), so
 * every state is reproducible. Standing still on the ground returns the EMPTY pose ⇒
 * the evaluator yields identity ⇒ the figure is byte-identical to as-drawn (so idle's
 * bob is opt-in: it only kicks in once `idleBob > 0`).
 */
import type { Pose } from './evaluate'
import { BUILDER_LIMB_BONES } from './builderRig'

/** Tunables for the whole animation set. Defaults chosen for the 1×2 builder. */
export interface WalkTunables {
  /** Max limb swing at full speed, radians (~30°). */
  amplitude: number
  /** Cycle rate: radians of phase per second at full speed. */
  cadence: number
  /** Speed (px/s) at/above which the swing is at full amplitude. */
  fullSpeed: number
  /** Below this speed (px/s) the player is treated as standing (idle, not walk). */
  minSpeed: number
  /** Vertical spine bob at full walk speed, px (rises/falls with the stride). */
  bob: number
  /** Spine lean into the travel direction at full speed, radians. */
  lean: number
  /** Idle breathing amplitude, radians of head nod (0 ⇒ idle rests, byte-identical). */
  idleBob: number
  /** Idle breathing rate, radians/s. */
  idleRate: number
  /**
   * How far the arms drop from their outstretched rest to hang at the sides while
   * walking, radians (the arm bones rest ~horizontal; +armDrop rotates armR down and
   * −armDrop rotates armL down, so both hang and then swing subtly from there).
   */
  armDrop: number
  /** Fraction of the leg swing the (lowered) arms swing by. Arms swing less. */
  armSwing: number
}

export const WALK_DEFAULTS: WalkTunables = {
  amplitude: 0.52, // ~30°
  cadence: 9,
  fullSpeed: 340, // matches PHYSICS_DEFAULTS.moveSpeed
  minSpeed: 20,
  bob: 3,
  lean: 0.12,
  idleBob: 0.05,
  idleRate: 2.2,
  armDrop: 1.2, // ~70°: from ~horizontal rest down to the sides
  armSwing: 0.55,
}

/** Live inputs from the player's kinematic state. */
export interface WalkState {
  grounded: boolean
  /** Horizontal velocity, px/s (sign = facing; magnitude = speed). */
  vx: number
  /** Vertical velocity, px/s (sim convention: vy < 0 is rising, vy > 0 falling). */
  vy: number
  /** Pressed against a wall this substep (drives the climb/scramble pose). */
  touchingWall: boolean
  /** The runtime's fixed-substep clock, seconds. */
  simTime: number
}

export type AnimState = 'idle' | 'walk' | 'jump' | 'fall' | 'climb'

/**
 * Which state the kinematics imply. Airborne AND pressed against a wall ⇒ climb
 * (wall-scramble); otherwise airborne rising ⇒ jump, falling ⇒ fall; grounded ⇒
 * walk (moving) or idle.
 */
export function selectState(s: WalkState, t: WalkTunables = WALK_DEFAULTS): AnimState {
  if (!s.grounded) {
    if (s.touchingWall) return 'climb'
    return s.vy < 0 ? 'jump' : 'fall'
  }
  return Math.abs(s.vx) < t.minSpeed ? 'idle' : 'walk'
}

/**
 * Idle: a slow breathing bob — the spine rises/falls a hair and the head nods with
 * it. Returns REST when `idleBob` is 0 (so idle is opt-out to byte-identical rest).
 */
function idlePose(s: WalkState, t: WalkTunables): Pose {
  // Arms rest OUTSTRETCHED as drawn; idle drops them to hang at the sides (same
  // ±armDrop as walk, but static). Always applied so a standing figure has natural
  // arms-down posture; the breathing bob layers on when idleBob > 0.
  const breath = t.idleBob > 0 ? Math.sin(s.simTime * t.idleRate) : 0
  return {
    armL: { rotation: -t.armDrop },
    armR: { rotation: t.armDrop },
    spine: { y: breath * t.bob * 0.4 },
    head: { rotation: breath * t.idleBob },
  }
}

/**
 * Walk: legs swing opposed, arms counter them; the spine bobs twice per stride (a
 * gait dips on each footfall) and leans into travel; the head counter-nods. The rig
 * faces travel via a lean sign flip — a light "mirror" without rebuilding the rig
 * (true left/right art mirroring is a follow-up; the lean+swing already reads as
 * direction).
 */
function walkPose(s: WalkState, t: WalkTunables): Pose {
  const speed = Math.abs(s.vx)
  const drive = Math.min(1, speed / t.fullSpeed)
  const amp = t.amplitude * drive
  const phase = s.simTime * t.cadence
  const swing = Math.sin(phase) * amp
  const dir = Math.sign(s.vx) || 1
  // The body dips twice per stride (|sin| at 2× phase) and leans forward.
  const dip = Math.abs(Math.sin(phase)) * t.bob * drive
  // Arms hang at the sides (dropped from their outstretched rest) and swing subtly,
  // countering the legs. armR drops with +armDrop, armL with −armDrop (mirror), and
  // each swings by armSwing·swing around that lowered position.
  const armSwing = swing * t.armSwing
  return {
    legL: { rotation: swing },
    legR: { rotation: -swing },
    armL: { rotation: -t.armDrop - armSwing },
    armR: { rotation: t.armDrop + armSwing },
    spine: { y: dip, rotation: dir * t.lean * drive },
    head: { rotation: -dir * t.lean * 0.5 * drive },
  }
}

/** Jump (rising): arms sweep UP and OUT overhead, legs tuck, torso stretches. */
function jumpPose(): Pose {
  return {
    armL: { rotation: -1.4 },
    armR: { rotation: 1.4 },
    legL: { rotation: 0.5 },
    legR: { rotation: -0.5 },
    spine: { scaleY: 1.08 },
  }
}

/**
 * Climb (wall-scramble): the figure hugs a wall and reaches hand-over-hand, legs
 * pushing in alternation. Arms reach UP overhead (one higher than the other, phased);
 * legs alternate a push. Cycled by simTime so it animates while pressed to the wall.
 */
function climbPose(s: WalkState, t: WalkTunables): Pose {
  const phase = s.simTime * t.cadence * 0.7 // a touch slower than a run
  const reach = Math.sin(phase)
  // Both arms up overhead; hand-over-hand — one reaches higher as the other pulls
  // down (OPPOSED via ±reach), the legs pushing in counter-alternation.
  return {
    armL: { rotation: -1.5 + reach * 0.4 },
    armR: { rotation: 1.5 - reach * 0.4 },
    legL: { rotation: 0.35 - reach * 0.35 },
    legR: { rotation: -0.35 + reach * 0.35 },
    spine: { scaleY: 1.04 },
  }
}

/** Fall (descending): arms out for balance, legs trail down, torso compresses. */
function fallPose(): Pose {
  return {
    armL: { rotation: -0.6 },
    armR: { rotation: 0.6 },
    legL: { rotation: -0.3 },
    legR: { rotation: 0.3 },
    spine: { scaleY: 0.94 },
  }
}

/**
 * The pose for the current kinematic state. Dispatches to the per-state pose. Standing
 * still with `idleBob: 0` returns the empty pose (rest), so a resting figure is
 * byte-identical to as-drawn.
 */
export function poseForState(state: WalkState, t: WalkTunables = WALK_DEFAULTS): Pose {
  switch (selectState(state, t)) {
    case 'walk':
      return walkPose(state, t)
    case 'jump':
      return jumpPose()
    case 'fall':
      return fallPose()
    case 'climb':
      return climbPose(state, t)
    case 'idle':
    default:
      return idlePose(state, t)
  }
}

/** Guard: the walk drives exactly the builder's limb bones (keeps them in sync). */
export const WALK_BONES = BUILDER_LIMB_BONES
