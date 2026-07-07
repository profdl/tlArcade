/**
 * Engine — the generalized entity model (PLAN §1.3).
 *
 * Today the sim moves only the player; this type is the seam that makes "the sim
 * steps a LIST of entities" true, with the player as entity 0 (`motion:
 * 'platformer'`). It is a PURE type module — no tldraw import — so the editor-free
 * step logic (entities/step.ts) and future motion modules can depend on it without
 * pulling in the editor, exactly as physics.ts stays editor-free.
 *
 * Behavior-preserving invariant (S3): with a single `platformer` entity and no
 * others — the state when no meta.role/behavior is present — the entity loop is a
 * mechanical regroup of today's player-only path, byte-for-byte.
 *
 * NB on offsets (risk R3): the player can be a GROUP whose leaves each sit at their
 * own page offset from the body's bounds top-left. Those per-leaf offsets live in
 * `parts` (PlayerPart), NOT flattened onto the entity — flattening would deform a
 * group figure. `EntityKinematic` carries only the body's bounds top-left (x,y);
 * each part reconstructs its page origin as (x,y)+part.offX/offY at write time.
 */
import type { TLShapeId } from 'tldraw'
import type { Pt } from '../collision'
import type { PlayerPart } from '../player'
import type { Rig } from '../rig/types'
import type { Pose } from '../rig/evaluate'
import type { Motion, Collision, Effect } from '../roles'

export type { Motion, Collision, Effect } from '../roles'

/**
 * The live kinematic + feel state of one entity, mutated in place each substep by
 * `stepEntity`. Separated from the identity/config fields (Entity) so the pure sim
 * can be tested on plain data with no editor, no ids, no tldraw.
 *
 * The feel timers (coyote/buffer/jumpHeld) are only *read/written* under the
 * `platformer` branch of stepEntity, so a non-player entity simply carries them
 * unused — no need for a separate struct per motion kind.
 */
export interface EntityKinematic {
  /** Body bounds top-left, page space — what the sim integrates (matches today's px/py). */
  x: number
  y: number
  /**
   * The position one substep ago, for fixed-timestep render interpolation (the
   * runtime captures it each substep and renders at lerp(prev, cur, alpha) so the
   * ~60Hz display shows smooth motion over the 120Hz sim). Sim math never reads it.
   */
  prevX: number
  prevY: number
  vx: number
  vy: number
  grounded: boolean
  /** Touching a steep (wall-ish) surface this substep — re-detected every step. */
  touchingWall: boolean
  /** Outward horizontal normal of that wall contact (sign = the way off it). */
  wallNx: number
  // --- platformer feel timers (see physics.ts) ---
  coyoteTimer: number
  bufferTimer: number
  jumpHeld: boolean
  // --- patrol state ---
  /** Current facing/walk direction for a patroller: -1 left, +1 right. */
  facing: number
}

/** A fresh, zeroed kinematic state at a given start position. */
export function makeKinematic(x: number, y: number): EntityKinematic {
  return {
    x,
    y,
    prevX: x,
    prevY: y,
    vx: 0,
    vy: 0,
    grounded: false,
    touchingWall: false,
    wallNx: 0,
    coyoteTimer: 0,
    bufferTimer: 0,
    jumpHeld: false,
    facing: 1,
  }
}

/**
 * A straight-line ping-pong path for a `mover` (T1e): the entity travels from A to
 * B and back forever, at `speed` px/s. Coordinates are the body bounds TOP-LEFT in
 * page space (same frame as `kin.x/kin.y`), so a mover is placed by its A endpoint.
 */
export interface MoverPath {
  ax: number
  ay: number
  bx: number
  by: number
  /** Travel speed along the path, px/s. */
  speed: number
}

/**
 * A sine oscillation for a `sine` mover (T1d, e.g. a Piranha rising from a pipe):
 * position = base + sin(2π·frequency·t + phase)·amplitude along `axis`. `base` is
 * the entity's start bounds top-left (captured at start()).
 */
export interface SineParams {
  amplitude: number
  /** Cycles per second. */
  frequency: number
  /** 'y' (rise/fall, the default) or 'x' (side to side). */
  axis: 'x' | 'y'
  /** Phase offset in radians (stagger multiple oscillators). */
  phase?: number
}

/**
 * A blink platform's on/off phase clock (T1f): solid for `onMs`, gone for `offMs`,
 * repeating; `phaseMs` staggers it so a row of blinkers alternates.
 */
export interface BlinkParams {
  onMs: number
  offMs: number
  phaseMs?: number
}

/** Per-motion tuning params carried on an entity (patrol / sine / mover). */
export interface MotionParams {
  /** Patrol walk speed, px/s. */
  patrolSpeed?: number
  /**
   * The monotonic sim time (s) at the CURRENT substep, set by the runtime each step
   * before calling stepEntity. Deterministic (a function of substep count, never
   * wall-clock), so sine/mover motion stays reproducible. Absent (undefined) ⇒ 0,
   * so existing callers/tests that don't set it are unchanged.
   */
  simTime?: number
  /** `sine` motion config (T1d). */
  sine?: SineParams
  /** The base bounds top-left a `sine` oscillates around (captured at start()). */
  sineBase?: { x: number; y: number }
  /** `mover` path (T1e). */
  path?: MoverPath
  /** `blink` platform config (T1f): present/absent on a phase clock. */
  blink?: BlinkParams
  /** `crumble` platform config (T1f): drops out this many ms after first stood on. */
  crumbleMs?: number
}

/** Default patrol speed (px/s) for an enemy with no explicit param. */
export const DEFAULT_PATROL_SPEED = 90

/**
 * One entity the runtime drives. `kin` is the mutable live state; the rest is the
 * identity/config read once at start(). For S3 there is exactly one entity — the
 * player — with `motion: 'platformer'`; later phases add movers with other motions.
 */
export interface Entity {
  /** The shape (or group) record this entity drives. */
  id: TLShapeId
  motion: Motion
  collision: Collision
  effect: Effect
  /** Per-motion tuning (patrol speed, …). */
  params: MotionParams
  /** Live kinematic + feel state (mutated each step). */
  kin: EntityKinematic
  /**
   * Outline sample points RELATIVE to the body bounds top-left. Adding (kin.x,
   * kin.y) yields their live page position — same convention as today's
   * playerSamples. The merged outline for a group.
   */
  samples: Pt[]
  /**
   * The writable leaves to reposition each frame (one for a lone shape, all parts
   * for a group). Per-leaf page offsets live HERE (risk R3), not on the entity.
   */
  parts: PlayerPart[]
  /**
   * Live flag: a defeated entity (e.g. a stomped enemy) stops stepping and is
   * hidden. NOT persisted — stop() restores the shape from its part snapshot.
   */
  defeated?: boolean
  /**
   * Crumble platform (T1f) runtime state: the sim time (ms) the player FIRST stood
   * on it, or null until then. Once set, `crumbleGone` drops it out after
   * `params.crumbleMs`. NOT persisted; cleared on start().
   */
  crumbleStandMs?: number | null
  /**
   * The baked rig (R1, from meta.rig / bakeRig) driving this entity's leaf parts,
   * or undefined for a rigid whole-body entity (today's default). Present ⇒ the
   * runtime evaluates it each frame and applies per-leaf transforms on top of the
   * base translation (see engine.ts writeEntities). Collision still uses the merged
   * rest outline (§6) — the rig is cosmetic. Maps a rig leafId → the part it drives.
   */
  rig?: Rig
  /**
   * The live pose driving the rig this frame (R2 clips will set this; R1 leaves it
   * empty ⇒ rest ⇒ identity deltas ⇒ byte-identical to an unrigged player). The
   * editor sets it for scrub-preview.
   */
  pose?: Pose
}

/** Per-substep input for the platformer entity (edges consumed once, see stepEntity). */
export interface EntityInput {
  /** Horizontal intent: -1 left, 0 none, +1 right. */
  dir: number
  /** A jump was pressed since last substep (arms the buffer). */
  jumpPressed: boolean
  /** A jump was released since last substep (arms the variable-height cut). */
  jumpReleased: boolean
}
