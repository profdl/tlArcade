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
 *   walk — two leg modes (Phase B toggle): STRAIGHT swings the thighs opposed (knee
 *          inline, distance-driven cadence); IK plants each foot at a world target and
 *          solves the two-bone chain (bending knee) so the feet really carry the walk.
 *          Both add the arm counter-swing, the SPINE bob + travel lean, and head nod.
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
import { solveTwoBoneIk } from './ik'

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
  /**
   * IK-leg tunables (Phase B, used only in `legMode: 'ik'`). `stepHeight` = how far the
   * foot lifts off the ground during its swing (px); `stanceReach` = how far ahead/
   * behind the hip the foot plants at the stride extremes (px, half the stride reach on
   * the ground); `footDrop` = the ground level below the hip the planted foot sits at
   * (px, ~full leg extension). These place the world foot TARGET the IK solves for.
   */
  stepHeight: number
  stanceReach: number
  footDrop: number
}

/**
 * Static per-side leg geometry the IK walk needs, measured once from the REST rig by
 * the runtime (entity-local). The pose uses it to place a foot target relative to the
 * hip and solve the two-bone chain. `hip` is the thigh pivot; `restThighWorld` /
 * `restShinLocal` are the rest angles the pose deltas are measured against; `thighLen`
 * / `shinLen` are the bone lengths; `bendSign` fixes the knee bend direction.
 */
export interface LegRig {
  hip: { x: number; y: number }
  restThighWorld: number
  restShinLocal: number
  thighLen: number
  shinLen: number
  bendSign: 1 | -1
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
  // Tuned to the builder's SHORT legs (thigh+shin ≈ 27px fully extended). footDrop MUST
  // sit inside that reach so the knee has to BEND to plant the foot — beyond it the IK
  // clamps to a dead-straight leg (no visible knee). ~20px ⇒ a clear, natural bend.
  stepHeight: 8, // foot lifts ~8px in swing
  stanceReach: 9, // foot plants ~9px fore/aft of the hip
  footDrop: 20, // planted foot ~20px below the hip (74% of full reach ⇒ bent knee)
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
  /**
   * Which leg animation to use (Phase B toggle). `'straight'` (or undefined) = the
   * distance-driven thigh swing with the knee kept inline (looks like the old one-piece
   * leg). `'ik'` = a bending-knee walk that plants each foot at a world target and
   * solves the two-bone chain to reach it. `'ik'` requires `legs` (the rig geometry).
   */
  legMode?: 'straight' | 'ik'
  /** Per-side leg rig geometry, required for `legMode: 'ik'` (see LegRig). */
  legs?: { L: LegRig; R: LegRig }
  /**
   * rig-play addition: the character is holding CROUCH (S). While grounded this beats
   * idle/walk — the figure ducks (spine compresses, thighs bend, arms drop). Ignored
   * airborne (a jump/fall pose wins).
   */
  crouch?: boolean
  /**
   * rig-play addition: a one-shot WAVE in progress (E), as a 0..1 phase (0/1 = not
   * waving). Layered ON TOP of whatever base state is active, so you can wave while
   * idle OR while walking — only the right arm is overridden, the rest keeps moving.
   */
  wave?: number
}

export type AnimState = 'idle' | 'walk' | 'jump' | 'fall' | 'climb' | 'crouch'

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
  // Crouch (held) beats idle/walk on the ground (rig-play).
  if (s.crouch) return 'crouch'
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
 * The world foot TARGET for one leg at stride `phase`, relative to the hip (entity-local,
 * +x = travel-forward already resolved by the sign of `strideDistance` → phase). The
 * cycle splits into STANCE (foot on the ground, sweeping fore→aft) and SWING (foot
 * lifted, arcing aft→fore). During stance the foot's forward offset is LINEAR in phase
 * — and phase is linear in distance — so the planted foot holds its WORLD position as
 * the body advances (true, IK-enforced planting; the solver places the foot exactly).
 *
 * `dir` is travel direction (±1) so "forward" is toward travel. Returns the target in
 * the hip's frame: +x forward, +y down (foot below the hip).
 */
export function footTarget(phase: number, dir: number, t: WalkTunables): { x: number; y: number } {
  const u = ((phase / (2 * Math.PI)) % 1 + 1) % 1
  const stance = 0.6 // stance-dominant duty (foot grounded 60% of the cycle)
  if (u < stance) {
    // Stance: foot forward-offset goes +reach (front) → −reach (rear), LINEAR in phase.
    const st = u / stance
    const forward = t.stanceReach * (1 - 2 * st)
    return { x: dir * forward, y: t.footDrop }
  }
  // Swing: arc the lifted foot from the rear plant back to the front, rising then
  // falling (a half-sine lift), forward-offset easing rear→front on a cosine.
  const sw = (u - stance) / (1 - stance)
  const forward = -t.stanceReach * Math.cos(Math.PI * sw)
  const lift = t.stepHeight * Math.sin(Math.PI * sw)
  return { x: dir * forward, y: t.footDrop - lift }
}

/**
 * IK pose for ONE leg: plant its foot at `footTarget` and solve the two-bone chain →
 * `rotation` deltas for the thigh and shin bones. The delta is measured against the
 * bone's REST local rotation (the evaluator ADDS the delta to rest). The thigh's world
 * angle from IK maps to a thigh delta of `thighWorld − restThighWorld` (both worlds
 * share the spine frame, so the spine's own pose cancels out here — the IK targets the
 * hip frame, and the spine pose carries the hip with it). The shin's LOCAL rotation is
 * `shinWorld − thighWorld`; its delta is that minus the rest shin-local.
 */
function ikLegPose(leg: LegRig, phase: number, dir: number, t: WalkTunables): { thigh: number; shin: number } {
  const target = footTarget(phase, dir, t)
  const sol = solveTwoBoneIk(target, leg.thighLen, leg.shinLen, leg.bendSign)
  const thighDelta = sol.thigh - leg.restThighWorld
  const shinLocal = sol.shin - sol.thigh
  const shinDelta = shinLocal - leg.restShinLocal
  return { thigh: thighDelta, shin: shinDelta }
}

/**
 * Walk: two leg modes. STRAIGHT — the thighs swing opposed on a DISTANCE-DRIVEN cycle
 * (the knee stays inline; reads like the old one-piece leg). IK — each foot plants at a
 * world target and the two-bone chain solves to reach it (bending knee, true planting).
 * Both share the arm counter-swing, the spine bob/lean, and the head counter-nod.
 */
function walkPose(s: WalkState, t: WalkTunables): Pose {
  const speed = Math.abs(s.vx)
  const drive = Math.min(1, speed / t.fullSpeed)
  const amp = t.amplitude * drive
  const phase = stridePhase(s, t)
  const dir = Math.sign(s.vx) || 1
  // The body dips on each footfall (twice per stride) and leans forward — |sin| peaks
  // as weight transfers between the feet.
  const dip = Math.abs(Math.sin(phase)) * t.bob * drive
  const spineHead: Pose = {
    spine: { y: dip, rotation: dir * t.lean * drive },
    head: { rotation: -dir * t.lean * 0.5 * drive },
  }

  if (s.legMode === 'ik' && s.legs) {
    // IK legs: plant each foot (legs half a cycle out of phase) and solve the chain.
    const l = ikLegPose(s.legs.L, phase, dir, t)
    const r = ikLegPose(s.legs.R, phase + Math.PI, dir, t)
    // Arms still counter-swing subtly, following the OPPOSITE thigh's fore/aft lean.
    const armLSwing = legSwing(phase + Math.PI, amp) * t.armSwing
    const armRSwing = legSwing(phase, amp) * t.armSwing
    return {
      thighL: { rotation: l.thigh },
      shinL: { rotation: l.shin },
      thighR: { rotation: r.thigh },
      shinR: { rotation: r.shin },
      armL: { rotation: -t.armDrop - armLSwing },
      armR: { rotation: t.armDrop + armRSwing },
      ...spineHead,
    }
  }

  // Straight legs: swing the thighs opposed, knee inline (shins ride the thigh rigidly,
  // no shin delta — looks like the pre-Phase-B one-piece leg).
  const legLSwing = legSwing(phase, amp)
  const legRSwing = legSwing(phase + Math.PI, amp)
  const armLSwing = legRSwing * t.armSwing
  const armRSwing = legLSwing * t.armSwing
  return {
    thighL: { rotation: legLSwing },
    thighR: { rotation: legRSwing },
    armL: { rotation: -t.armDrop - armLSwing },
    armR: { rotation: t.armDrop + armRSwing },
    ...spineHead,
  }
}

/** Jump (rising): arms sweep UP and OUT overhead, legs tuck, torso stretches. */
function jumpPose(): Pose {
  return {
    armL: { rotation: -1.4 },
    armR: { rotation: 1.4 },
    thighL: { rotation: 0.5 },
    thighR: { rotation: -0.5 },
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
    thighL: { rotation: legKick - reach * legKick },
    thighR: { rotation: -legKick + reach * legKick },
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
    thighL: { rotation: -0.3 },
    thighR: { rotation: 0.3 },
    spine: { scaleY: 0.94 },
  }
}

/**
 * Crouch (rig-play, held): the figure ducks — the spine sinks and squashes, the knees
 * bend (thighs forward, shins tucked under), and the arms drop to the sides. Held while
 * S is down; releasing returns to idle/walk. A subtle head dip keeps the face readable.
 */
function crouchPose(): Pose {
  return {
    spine: { y: 10, scaleY: 0.82 },
    head: { rotation: 0.12 },
    armL: { rotation: -1.4 },
    armR: { rotation: 1.4 },
    thighL: { rotation: 0.7 },
    shinL: { rotation: -1.1 },
    thighR: { rotation: -0.7 },
    shinR: { rotation: 1.1 },
  }
}

/**
 * Wave (rig-play, one-shot): a friendly right-arm wave, layered ON TOP of the base
 * state's pose so you can wave while idle or walking. `phase` is 0..1 across the wave;
 * the arm lifts overhead (a sine ease-in/out envelope) and oscillates side to side.
 * Returns ONLY the right-arm override (merged over the base pose by `poseForState`), so
 * the legs/spine keep doing whatever the base state does.
 */
function wavePose(phase: number): Pose {
  // Envelope: 0 at the ends, 1 in the middle — the arm rises, waves, and lowers.
  const lift = Math.sin(Math.PI * phase)
  // The right arm rests reaching right (+); bring it UP overhead (−) proportional to the
  // envelope, then oscillate a few times around that raised position.
  const raise = 2.4 // ~overhead
  const swing = Math.sin(phase * Math.PI * 6) * 0.35 * lift
  return {
    armR: { rotation: 1.4 - lift * raise + swing },
  }
}

/**
 * The pose for the current kinematic state. Dispatches to the per-state pose. Standing
 * still with `idleBob: 0` returns the empty pose (rest), so a resting figure is
 * byte-identical to as-drawn.
 */
export function poseForState(state: WalkState, t: WalkTunables = WALK_DEFAULTS): Pose {
  let base: Pose
  switch (selectState(state, t)) {
    case 'walk':
      base = walkPose(state, t)
      break
    case 'jump':
      base = jumpPose()
      break
    case 'fall':
      base = fallPose()
      break
    case 'climb':
      base = climbPose(state, t)
      break
    case 'crouch':
      base = crouchPose()
      break
    case 'idle':
    default:
      base = idlePose(state, t)
  }
  // Layer a one-shot wave (rig-play) over the base pose: only the right arm is
  // overridden, so the figure keeps doing its base state (idle bob / walk cycle) while
  // waving. phase 0/1 (or undefined) ⇒ not waving ⇒ base pose unchanged.
  if (state.wave && state.wave > 0 && state.wave < 1) {
    return { ...base, ...wavePose(state.wave) }
  }
  return base
}

/** Guard: the walk drives exactly the builder's limb bones (keeps them in sync). */
export const WALK_BONES = BUILDER_LIMB_BONES
