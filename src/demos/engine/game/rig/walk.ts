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
  /**
   * The forward distance (px) the body travels per FULL leg cycle — one stride length.
   * The leg phase is driven by DISTANCE TRAVELLED, not wall-clock (see `stridePhase`),
   * so `strideLength` px of travel = one 2π swing. This is what removes the worst of
   * the "player slides" look: the swing rate now tracks actual speed, and the legs
   * STOP swinging the instant the body stops (a wall-clock cycle kept them waving).
   * Roughly one leg-reach of travel per step; tuned for the 1×2 builder.
   *
   * Note: this does NOT fully pin the foot to the world — the builder's single-bone
   * legs can't travel a full stride along the ground, and the hip bobs/leans each
   * frame. True foot planting needs 2-bone IK with a world foot target (Phase B).
   */
  strideLength: number
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
  strideLength: 55, // ~one leg-reach of travel per step (distance-driven cadence)
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
  /**
   * Outward horizontal normal of the wall contact (sign = the way OFF the wall), so
   * the climb pose can face/reach TOWARD the wall. < 0 ⇒ wall is to the RIGHT (normal
   * points left), > 0 ⇒ wall is to the LEFT. 0 when not touching a wall.
   */
  wallNx: number
  /** The runtime's fixed-substep clock, seconds. */
  simTime: number
  /**
   * Signed horizontal distance the body has travelled while grounded (px), accumulated
   * by the runtime. This — NOT `simTime` — drives the leg cycle during a walk, so the
   * stride advances with actual travel and the planted foot stays fixed in the world
   * (no slide). Defaults to 0 for callers/tests that don't set it (falls back to a
   * `simTime`-driven cycle so those callers behave as before).
   */
  strideDistance?: number
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
 * The stride phase (radians) that drives the walk cycle. Driven by DISTANCE
 * TRAVELLED (`strideDistance / strideLength · 2π`) so the swing advances with actual
 * travel — the swing rate tracks the body's speed and the legs stop the instant the
 * body stops (the fix for the worst of the "player slides" look). Falls back to the
 * old `simTime · cadence` clock when the runtime hasn't supplied a distance (tests,
 * unrigged callers), so those paths are unchanged.
 */
export function stridePhase(s: WalkState, t: WalkTunables): number {
  if (s.strideDistance === undefined) return s.simTime * t.cadence
  return (s.strideDistance / t.strideLength) * 2 * Math.PI
}

/**
 * The leg swing angle (radians about the hip) at cycle position `phase` and amplitude
 * `amp`. A plain sine sweep — but `phase` is DISTANCE-driven (see `stridePhase`), so
 * the swing advances with real travel: it speeds up with the body, and stops the
 * instant the body stops (a wall-clock cycle kept the legs waving in place — the main
 * "slide" tell). True world-fixed foot planting needs 2-bone IK (Phase B); this is the
 * distance-coupled cycle that removes the worst of the skating.
 */
export function legSwing(phase: number, amp: number): number {
  return Math.sin(phase) * amp
}

/**
 * Walk: legs swing opposed on a DISTANCE-DRIVEN cycle (see `legSwing`/`stridePhase` —
 * the fix for the worst of the "player slides" look); arms counter them; the spine
 * bobs on each footfall and leans into travel; the head counter-nods. The rig faces
 * travel via a lean sign flip — a light "mirror" without rebuilding the rig (true
 * left/right art mirroring is a follow-up; the lean+swing already reads as direction).
 */
function walkPose(s: WalkState, t: WalkTunables): Pose {
  const speed = Math.abs(s.vx)
  const drive = Math.min(1, speed / t.fullSpeed)
  const amp = t.amplitude * drive
  const phase = stridePhase(s, t)
  const dir = Math.sign(s.vx) || 1
  // Legs are half a cycle out of phase (opposed): one swings forward as the other back.
  const legLSwing = legSwing(phase, amp)
  const legRSwing = legSwing(phase + Math.PI, amp)
  // The body dips on each footfall (twice per stride) and leans forward — |sin| peaks
  // as weight transfers between the feet.
  const dip = Math.abs(Math.sin(phase)) * t.bob * drive
  // Arms hang at the sides (dropped from their outstretched rest) and swing subtly,
  // countering the legs (arm follows the OPPOSITE leg, as in a real gait). armR drops
  // with +armDrop, armL with −armDrop (mirror), each swinging by armSwing around it.
  const armLSwing = legRSwing * t.armSwing
  const armRSwing = legLSwing * t.armSwing
  return {
    legL: { rotation: legLSwing },
    legR: { rotation: legRSwing },
    armL: { rotation: -t.armDrop - armLSwing },
    armR: { rotation: t.armDrop + armRSwing },
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
 * Climb (wall-scramble): the figure FACES the wall it's gripping and hauls itself up
 * hand-over-hand. Unlike the old symmetric "arms overhead" pose (which read as a cheer),
 * this leans the torso INTO the wall and drives the two arms in OPPOSITION — the
 * wall-side pair reaching high to grab while the other pulls down, the legs kicking in
 * counter-phase to push off the face. `wallNx` tells us which side the wall is on so
 * the whole figure orients toward it; with no wall side known (wallNx 0) it falls back
 * to a wall-on-the-right lean so the pose still reads as climbing.
 */
function climbPose(s: WalkState, t: WalkTunables): Pose {
  const phase = s.simTime * t.cadence * 0.75 // a touch slower than a run
  const reach = Math.sin(phase)
  // toWall: +1 ⇒ wall is to the RIGHT, −1 ⇒ to the LEFT. The outward normal points
  // AWAY from the wall, so the wall is on the opposite side (−sign(wallNx)). Default
  // to +1 (wall on the right) when the side is unknown.
  const toWall = s.wallNx !== 0 ? -Math.sign(s.wallNx) : 1
  // Arm angles: the bone rotations that make an arm reach UP overhead differ by side
  // (armL rests reaching left, armR reaching right — see builderRig). Reach the
  // wall-side arm high and the off-side arm low, swapping hand-over-hand each cycle.
  const grabHigh = 1.5 // magnitude that brings an arm up overhead
  const pullLow = 0.4 // how far the pulling arm drops from overhead
  // Per side, +reach lifts and −reach drops so the two arms alternate.
  const armL = -grabHigh + (toWall < 0 ? reach : -reach) * pullLow // wall-side (left) grabs on +reach
  const armR = grabHigh + (toWall > 0 ? reach : -reach) * -pullLow // wall-side (right) grabs on +reach
  // Legs kick against the face in counter-alternation to the arms (opposite phase).
  const legKick = 0.35
  return {
    armL: { rotation: armL },
    armR: { rotation: armR },
    legL: { rotation: legKick - reach * legKick },
    legR: { rotation: -legKick + reach * legKick },
    // Lean the torso INTO the wall (toward toWall) + a slight stretch as it reaches up.
    spine: { rotation: toWall * t.lean * 1.5, scaleY: 1.04 },
    // Head tips toward the wall too, looking up the face.
    head: { rotation: toWall * t.lean * 0.5 },
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
