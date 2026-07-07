/**
 * Engine — the pure, editor-free entity sim (extracted from engine.ts, S3).
 *
 * This is the load-bearing core the N-entity refactor makes testable: exactly the
 * math that used to live on GameRuntime (step / resolveAxis / deepestShift /
 * tryCornerCorrect / the trigger-overlap decision), moved off `this.*` onto a
 * mutable EntityKinematic + plain `Body[]`, so it can be unit-tested with the same
 * hand-built fixtures collision.test.ts uses — no editor, no tldraw.
 *
 * It is a FAITHFUL extraction: the statements, ordering, thresholds, and the
 * platformer feel pipeline are unchanged (see the behavior inventory B9-B23). The
 * runtime (engine.ts) owns the editor glue (reading input, writing shapes, firing
 * effects) and calls these functions per entity per substep.
 *
 * The platformer feel pipeline (input read → jump/coyote/buffer/variable-cut/
 * slope-jump) runs only for `motion === 'platformer'` entities; gravity and
 * per-axis collision resolution run for every entity, so a future mover reuses the
 * same integrate+resolve path.
 */
import { penetration, pointInPolygon, type Body, type Pt } from '../collision'
import { SIM, stepVx, stepVy, type PhysicsTunables } from '../physics'
import {
  DEFAULT_PATROL_SPEED,
  type EntityKinematic,
  type EntityInput,
  type Motion,
  type MotionParams,
  type MoverPath,
} from './types'

/** How far ahead (px) a patroller probes for a ledge before turning. */
const LEDGE_PROBE = 8

/**
 * Advance one entity by a fixed substep against static `solids`. Mutates `kin` in
 * place. Dispatches on `motion`:
 *  - `platformer` — the player: input-driven accel + the full jump/coyote/buffer
 *    feel pipeline. `input` is consulted only here.
 *  - `patrol` — a walker: constant walk speed in `kin.facing`, reversing at walls
 *    and ledges. No input, no jump.
 *  - anything else (`static`) — falls under gravity and resolves, nothing more.
 * Gravity + per-axis collision resolution run for EVERY motion, so every mover
 * reuses the same integrate+resolve path.
 */
export function stepEntity(
  kin: EntityKinematic,
  samples: Pt[],
  solids: Body[],
  input: EntityInput,
  motion: Motion,
  params: MotionParams,
  dt: number,
  t: PhysicsTunables,
): void {
  const isPlatformer = motion === 'platformer'

  // --- sine / mover: position-driven tracks (no gravity, no collision) ----------
  // These entities ride a fixed path off the sim clock — they don't fall or resolve
  // against solids (they ARE the moving geometry). Compute the new position and
  // return early, before the gravity/integrate/resolve path every other motion uses.
  if (motion === 'sine') {
    const p = sinePosition(params, params.simTime ?? 0)
    if (p) {
      kin.vx = (p.x - kin.x) / dt // report velocity so a stomp/overlap reads motion
      kin.vy = (p.y - kin.y) / dt
      kin.x = p.x
      kin.y = p.y
    }
    return
  }
  if (motion === 'mover') {
    const p = moverPosition(params.path, params.simTime ?? 0)
    if (p) {
      kin.vx = (p.x - kin.x) / dt
      kin.vy = (p.y - kin.y) / dt
      kin.x = p.x
      kin.y = p.y
    }
    return
  }

  if (isPlatformer) {
    // --- horizontal: accelerate toward the target, or rub off with friction ---
    kin.vx = stepVx(kin.vx, input.dir, kin.grounded, dt, t)
  } else if (motion === 'patrol') {
    // --- patrol: walk at a constant speed in the current facing direction ---
    kin.vx = kin.facing * (params.patrolSpeed ?? DEFAULT_PATROL_SPEED)
  }

  // --- gravity: heavier falling, floaty apex (see physics.ts) — every entity ---
  kin.vy = stepVy(kin.vy, dt, t)

  if (isPlatformer) {
    // --- jump: buffer the press, then fire it if coyote time allows -----------
    // A press arms the buffer; ANY buffered press keeps ticking down. We jump on
    // the first substep where the buffer is live AND we're within coyote time of
    // solid ground — folding "jump on landing" (buffer) and "jump just after a
    // ledge" (coyote) into one check.
    if (input.jumpPressed) kin.bufferTimer = t.jumpBuffer
    if (kin.bufferTimer > 0 && kin.coyoteTimer > 0) {
      kin.vy = -t.jumpSpeed
      kin.grounded = false
      kin.jumpHeld = true // this jump is live until released or landed
      kin.bufferTimer = 0
      kin.coyoteTimer = 0
    } else if (kin.bufferTimer > 0 && kin.touchingWall) {
      // Slope/wall jump: not on walkable ground, but pressed against a surface too
      // steep to climb. Jump UP and AWAY from it (along the outward normal) so a
      // steep hillside can't trap you. NB: unlike the coyote jump this does NOT set
      // grounded=false or clear coyoteTimer — preserve that asymmetry.
      kin.vy = -t.jumpSpeed
      kin.vx = kin.wallNx * t.moveSpeed
      kin.jumpHeld = true
      kin.bufferTimer = 0
    }
    // Variable height: releasing the key while still rising cuts the ascent, so a
    // tap is a short hop and a hold is a full jump. Only bites once per jump.
    if (input.jumpReleased && kin.jumpHeld && kin.vy < 0) {
      kin.vy *= t.jumpCut
      kin.jumpHeld = false
    }
  }

  // Move + resolve one axis at a time so a corner can't wedge the entity. Resolve
  // Y first (gravity seats it on the surface), then X — so on the X pass it's
  // already sitting on a slope and only a genuine WALL blocks horizontal motion.
  kin.y += kin.vy * dt
  kin.grounded = false
  kin.touchingWall = false // re-detected each step by resolveAxis
  resolveAxis(kin, samples, solids, 'y', t)
  kin.x += kin.vx * dt
  resolveAxis(kin, samples, solids, 'x', t)

  if (isPlatformer) {
    // Coyote time: refreshed to full whenever grounded, else bleeds down. AFTER
    // resolution so it reflects this step's true grounded state.
    if (kin.grounded) {
      kin.coyoteTimer = t.coyoteTime
      kin.jumpHeld = false // landing ends any live jump (so the next is fresh)
    } else if (kin.coyoteTimer > 0) {
      kin.coyoteTimer -= dt
    }
    if (kin.bufferTimer > 0) kin.bufferTimer -= dt
  }

  if (motion === 'patrol') {
    // Turn around at a wall (the X pass recorded a wall contact) or at a ledge
    // (grounded, but no ground just ahead in the walk direction). Only flip when
    // grounded so an airborne patroller doesn't jitter mid-fall.
    if (kin.grounded) {
      if (kin.touchingWall || !groundAhead(kin, samples, solids, kin.facing)) {
        kin.facing = -kin.facing
        kin.vx = 0 // stop this frame; next step walks the new way
      }
    }
  }
}

/**
 * A patroller's ledge probe: would the entity still be grounded if it stepped
 * `dir * LEDGE_PROBE` px forward? Nudges the outline forward and checks whether a
 * downward push-out still finds a floor-ish surface. False ⇒ a ledge is ahead.
 */
function groundAhead(kin: EntityKinematic, samples: Pt[], solids: Body[], dir: number): boolean {
  // Probe slightly forward and a hair below, then look for a floor-ish contact.
  const probeX = kin.x + dir * LEDGE_PROBE
  const { shift, ny } = deepestShift(samples, solids, 'y', probeX, kin.y + 1)
  // Grounded-ahead iff a downward move would be pushed UP out of a floor-ish
  // surface (shift < 0 with a floor normal) — i.e. there's ground under the step.
  return shift < 0 && -ny >= SIM.GROUND_NY
}

/**
 * Sine oscillator position (T1d): the entity's bounds top-left at sim time `t`,
 * = base + sin(2π·frequency·t + phase)·amplitude along the configured axis. Pure;
 * returns null if there's no sine config or captured base. Unit-tested.
 */
export function sinePosition(params: MotionParams, t: number): { x: number; y: number } | null {
  const s = params.sine
  const base = params.sineBase
  if (!s || !base) return null
  const off = Math.sin(2 * Math.PI * s.frequency * t + (s.phase ?? 0)) * s.amplitude
  return s.axis === 'x' ? { x: base.x + off, y: base.y } : { x: base.x, y: base.y + off }
}

/**
 * Ping-pong mover position (T1e): the bounds top-left at sim time `t` as the mover
 * travels A→B→A→… at `path.speed` px/s. A triangle wave over the round trip, so the
 * platform eases through each endpoint and reverses (no teleport/snap). Pure;
 * returns null if there's no path or the endpoints coincide. Unit-tested.
 */
export function moverPosition(path: MoverPath | undefined, t: number): { x: number; y: number } | null {
  if (!path) return null
  const dx = path.bx - path.ax
  const dy = path.by - path.ay
  const legLen = Math.hypot(dx, dy)
  if (legLen < 1e-6 || path.speed <= 0) return { x: path.ax, y: path.ay }
  const legTime = legLen / path.speed // seconds A→B (one leg)
  const period = legTime * 2 // full round trip A→B→A
  const phase = ((t % period) + period) % period // 0..period
  // Triangle wave 0..1..0: fraction along A→B, ramping up then back down.
  const frac = phase <= legTime ? phase / legTime : 2 - phase / legTime
  return { x: path.ax + dx * frac, y: path.ay + dy * frac }
}

/**
 * Push the entity out of every solid it overlaps, correcting along ONE axis.
 * Mutates `kin`. On the Y pass an upward floor-ish correction grounds the entity;
 * a steep-surface contact records a wall (for the slope jump).
 */
export function resolveAxis(
  kin: EntityKinematic,
  samples: Pt[],
  solids: Body[],
  axis: 'x' | 'y',
  t: PhysicsTunables,
): void {
  const { shift, nx, ny } = deepestShift(samples, solids, axis, kin.x, kin.y)

  if (shift === 0) return

  if (axis === 'x') {
    kin.x += shift
    // Pushed sideways out of a near-vertical WALL — record it as a wall contact
    // (outward normal points the way OFF it) so a steep hill can still be jumped
    // off. Only cancel horizontal velocity if the push opposed our motion.
    if (Math.abs(nx) >= SIM.WALL_NX) {
      kin.touchingWall = true
      kin.wallNx = nx
    }
    if ((kin.vx > 0 && shift < 0) || (kin.vx < 0 && shift > 0)) kin.vx = 0
  } else {
    if (shift > 0 && kin.vy < 0) {
      // Pushed DOWN while rising → a ceiling bonk. Try corner correction first: a
      // small sideways nudge that lets the head slip past keeps the jump alive.
      if (tryCornerCorrect(kin, samples, solids, t)) return
      kin.vy = 0
    }
    kin.y += shift
    if (shift < 0 && -ny >= SIM.GROUND_NY) {
      // Pushed up out of a floor-ish surface → grounded (enables jumping).
      kin.grounded = true
      if (kin.vy > 0) kin.vy = 0
    } else if (kin.vy > 0 && shift < 0) {
      // Pushed up while falling against a STEEP surface (too steep to ground) —
      // stop the fall and record a wall contact so a steep hillside can be jumped
      // off instead of trapping you. nx is the way off the slope.
      kin.vy = 0
      if (Math.abs(nx) > 1e-3) {
        kin.touchingWall = true
        kin.wallNx = nx
      }
    }
  }
}

/**
 * The deepest per-axis push-out for the outline `samples` at (ox,oy), across every
 * solid — the "largest correction governs" rule, factored out so corner correction
 * can probe hypothetical positions. Returns the signed axis shift and the nx/ny of
 * the governing contact.
 */
export function deepestShift(
  samples: Pt[],
  solids: Body[],
  axis: 'x' | 'y',
  ox: number,
  oy: number,
): { shift: number; nx: number; ny: number } {
  let bestShift = 0
  let bestNx = 0
  let bestNy = 0
  for (const local of samples) {
    const p: Pt = { x: local.x + ox, y: local.y + oy }
    for (const body of solids) {
      const hit = penetration(p, body)
      if (!hit) continue
      // One-way platform (G3a): solid only from ABOVE. It never blocks sideways
      // motion (skip on X) and only produces a Y contact that is a floor normal
      // LIFTING the entity up (a landing) — never a ceiling bonk from below. The
      // runtime additionally only feeds one-way bodies to a DESCENDING entity, so
      // together this is "jump up through, land on top".
      if (body.oneWay) {
        if (axis === 'x') continue
        if (-hit.ny < SIM.GROUND_NY) continue // not a floor-ish top surface
      }
      // On the X pass, ignore floor-ish/slope contacts: a surface you can walk UP
      // (normal mostly vertical) shouldn't block sideways motion — the Y pass
      // lifts you up it instead. Only a near-vertical WALL normal stops you here.
      if (axis === 'x' && Math.abs(hit.nx) < SIM.WALL_NX) continue
      // On the Y pass, ignore near-vertical WALL contacts (the symmetric guard).
      // A sample jammed into a wall's SIDE resolves to that wall's nearest edge —
      // often its top corner — giving a wall-ish (near-horizontal) normal. Turning
      // that into a Y shift divides depth by a tiny |ny|, flinging the entity UP the
      // wall face (the "auto-slide up walls" glitch). A wall is the X pass's job; the
      // Y pass handles only floors/ceilings and walkable slopes (normal mostly
      // vertical). Steep-but-not-vertical slopes still pass (|nx| < WALL_NX) so the
      // slope-jump machinery in resolveAxis keeps working.
      if (axis === 'y' && Math.abs(hit.nx) >= SIM.WALL_NX) continue
      const comp = axis === 'x' ? hit.nx : hit.ny
      if (Math.abs(comp) < 1e-3) continue
      const axisShift = (hit.depth / Math.abs(comp)) * Math.sign(comp)
      if (Math.abs(axisShift) > Math.abs(bestShift)) {
        bestShift = axisShift
        bestNx = hit.nx
        bestNy = hit.ny
      }
    }
  }
  return { shift: bestShift, nx: bestNx, ny: bestNy }
}

/**
 * On a ceiling bonk, look for a small horizontal offset (±1..cornerCorrect px) at
 * which the entity would NOT be pushed on Y — i.e. the head clears the corner. If
 * found, slide there (keeping upward velocity) and return true. Prefers the
 * smallest nudge; tries the side matching current horizontal motion first.
 */
export function tryCornerCorrect(
  kin: EntityKinematic,
  samples: Pt[],
  solids: Body[],
  t: PhysicsTunables,
): boolean {
  const max = Math.round(t.cornerCorrect)
  if (max <= 0) return false
  const firstSign = kin.vx < 0 ? -1 : 1
  const order = firstSign === 1 ? [1, -1] : [-1, 1]
  for (let d = 1; d <= max; d++) {
    for (const sign of order) {
      const nudged = deepestShift(samples, solids, 'y', kin.x + sign * d, kin.y)
      if (nudged.shift === 0) {
        kin.x += sign * d
        return true
      }
    }
  }
  return false
}

/**
 * True if any of the entity's outline samples (at kin.x/kin.y) is inside/within
 * `body`. Closed bodies use point-in-polygon; open (band) bodies use penetration.
 *
 * The runtime's checkTriggers keeps its own inline effect loop (it must call the
 * editor and mutate position on respawn, in the original order) and uses THIS
 * helper only for the overlap test — so trigger ordering/effects stay byte-for-byte
 * the original while the geometry is shared and unit-testable.
 */
export function touches(kin: EntityKinematic, samples: Pt[], body: Body): boolean {
  for (const local of samples) {
    const p: Pt = { x: local.x + kin.x, y: local.y + kin.y }
    if (body.closed) {
      if (pointInPolygon(p, body.pts)) return true
    } else if (penetration(p, body)) {
      return true
    }
  }
  return false
}

/**
 * Decide a player↔enemy overlap: a STOMP (player defeats the enemy, bounces) vs a
 * KILL (side/underneath hit, player respawns). It's a stomp iff the player is
 * moving DOWN (`playerVy > 0`) and the player's FEET (bounds bottom) are above the
 * enemy's vertical midpoint at contact — the standard Mario rule. Pure: caller
 * passes the two page-space vertical bounds and the player's vy.
 *
 * @returns 'stomp' | 'kill'.
 */
export function stompCheck(
  playerBottom: number,
  playerVy: number,
  enemyTop: number,
  enemyBottom: number,
): 'stomp' | 'kill' {
  const enemyMid = (enemyTop + enemyBottom) / 2
  return playerVy > 0 && playerBottom <= enemyMid ? 'stomp' : 'kill'
}

/** The page-space vertical bounds of an entity's outline at its current position. */
export function verticalBounds(kin: EntityKinematic, samples: Pt[]): { top: number; bottom: number } {
  let top = Infinity
  let bottom = -Infinity
  for (const s of samples) {
    const y = s.y + kin.y
    if (y < top) top = y
    if (y > bottom) bottom = y
  }
  return { top, bottom }
}
