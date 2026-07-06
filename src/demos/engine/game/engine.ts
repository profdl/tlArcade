/**
 * Engine — the play-mode runtime (native-first).
 *
 * tldraw is an editor, not a game loop, so this class *is* the game loop. On
 * start() it snapshots authored state, collects the level from the NATIVE shapes
 * on the page (role read from a shape's color — see roles.ts → roleForColor),
 * and drives the player with a fixed-timestep sim (gravity + WASD/arrow movement
 * + geometry-accurate collision). On stop() it restores, so Play/Stop is
 * non-destructive and never touches the undo stack (all canvas writes go through
 * `editor.run(..., { history: 'ignore' })`).
 *
 * N-entity model (PLAN §1.3): the sim steps a LIST of entities; the player is
 * entity 0 with `motion: 'platformer'`. The per-substep physics, per-axis
 * collision resolution, and outline overlap tests are the pure, editor-free
 * functions in game/entities/step.ts (unit-tested in step.test.ts); this class
 * owns the editor glue — reading the level, reading input, writing shapes, firing
 * effects. Today there is exactly ONE entity (the player); movers (enemy, platform)
 * are added as further entities later. With a single platformer entity and no
 * others — the state when no meta.role/behavior is present — the loop is the
 * original player-only path, unchanged, so every existing level keeps working.
 *
 * Collision matches each shape's REAL perimeter, not its bounding box (see
 * game/collision.ts): a triangle collides as a triangle, a hand-drawn stroke as a
 * thin band along its path, and the player collides by points sampled around its
 * OWN outline. Resolution is per-axis (move X, separate; move Y, separate) for
 * crisp control and a reliable `grounded` flag.
 *
 * The player can be a single geo shape (blue), a blue shape drawn with the pencil,
 * OR a GROUP marked via "Set as Player" (see game/player.ts). It's sized/positioned
 * from its page bounds, not props.w/h; a group's parts merge into one rigid outline
 * for collision, and each part LEAF is repositioned every frame (not the group
 * container, whose transform is derived) to keep it rigid.
 *
 * MVP scope / known limits (see CLAUDE.md):
 *  - Only the player moves. The level is collected ONCE at start.
 *  - Solids are static: a wall's outline is captured once at start, in page space,
 *    so rotating/moving a wall mid-play won't update its collision.
 */
import type { Editor, TLDrawShape, TLGeoShape, TLShapeId, TLShapePartial } from 'tldraw'
import { roleForColor, type Role } from './roles'
import { collectPlayerBody, isPlayerMarked } from './player'
import { buildBody, type Body } from './collision'
import { SIM, type PhysicsTunables } from './physics'
import { tunablesAtom } from './state'
import { makeKinematic, type Entity, type EntityInput } from './entities/types'
import { stepEntity, touches, stompCheck, verticalBounds } from './entities/step'

/** Native tldraw shape types the engine reads: geo and draw carry a role via
 *  color; lines are always solid terrain. */
const LEVEL_TYPES = new Set(['geo', 'draw', 'line'])

export interface GameState {
  status: 'playing' | 'won' | 'no-player'
  collected: number
  total: number
  deaths: number
}

interface Trigger {
  id: TLShapeId
  type: string // geo or draw — a trigger can be drawn too
  role: Extract<Role, 'token' | 'hazard' | 'goal'>
  body: Body
}

export class GameRuntime {
  private raf = 0
  private lastTime = 0
  private acc = 0
  private playing = false // a play session is active (until stop() restores)
  private finished = false // the game ended (won); sim ticking stopped, session still active

  // The entities the sim steps. entities[0] is the player (motion 'platformer');
  // future movers are appended. Each entity carries its own kinematic state,
  // outline samples, and driven leaf parts (see entities/types.ts). Today there is
  // exactly one entity, so the loop is the original player-only path.
  private entities: Entity[] = []

  private spawn = { x: 0, y: 0 }
  private solids: Body[] = []
  private triggers: Trigger[] = []
  private collected = new Set<TLShapeId>()
  private deaths = 0

  /** id → authored { x, y, opacity } for non-destructive restore on stop. */
  private snapshot = new Map<TLShapeId, { x: number; y: number; opacity: number }>()

  private keys = new Set<string>()
  // Edge events since the last substep consumed them. `jumpPressed` is set on a
  // jump keydown (arms the jump buffer); `jumpReleased` on keyup while a jump is
  // live (arms the variable-height cut). step() reads and clears them each substep.
  private jumpPressed = false
  private jumpReleased = false

  private editor: Editor
  private onState: (s: GameState) => void

  constructor(editor: Editor, onState: (s: GameState) => void) {
    this.editor = editor
    this.onState = onState
  }

  /** The player is entity 0. Convenience accessor for the (currently only) mover. */
  private get player(): Entity | undefined {
    return this.entities[0]
  }

  /** The live physics tunables (edited by the debug panel; read every substep). */
  private tunables(): PhysicsTunables {
    return tunablesAtom.get()
  }

  get isPlaying() {
    return this.playing
  }

  /**
   * A shape's role. The player is identified by a marker — `meta.role ===
   * 'player'`, set via "Set as Player" — which WINS over color, so a stick figure
   * can be any colour. Failing that, a geo/draw shape's COLOR maps to a role. A
   * non-role color stays solid terrain; lines are always terrain.
   */
  private roleOf(shape: { type: string; meta?: Record<string, unknown> }): Role | null {
    if (isPlayerMarked(shape)) return 'player'
    if (shape.type === 'geo') return roleForColor((shape as TLGeoShape).props.color)
    if (shape.type === 'draw') return roleForColor((shape as TLDrawShape).props.color)
    return null
  }

  /** Begin play. Returns false (and does nothing) if there's no player on the page. */
  start(): boolean {
    const editor = this.editor
    const shapes = editor.getCurrentPageShapes()

    // Find the player. A MARKED shape (meta.role === 'player', the group the tray
    // creates) wins unconditionally — its blue children must NOT each be mistaken
    // for a player via the color fallback. Only if nothing is marked do we fall
    // back to a lone blue shape (legacy single-shape levels).
    const player =
      shapes.find((s) => isPlayerMarked(s)) ??
      shapes.find((s) => this.roleOf(s) === 'player')
    // The player may be a group (a drawn stick figure) — collect its bounds and
    // the merged outline of all its parts as one rigid body.
    const playerBody = player && collectPlayerBody(editor, player.id)

    if (!player || !playerBody) {
      this.onState({ status: 'no-player', collected: 0, total: 0, deaths: 0 })
      return false
    }
    const playerBounds = playerBody.bounds

    // The player's parts (a group's descendants) are NOT level geometry — skip the
    // whole subtree so a stick-figure limb isn't collected as terrain.
    const playerIds = editor.getShapeAndDescendantIds([player.id])

    // Collect the level once, and snapshot anything we might mutate. Every solid
    // and trigger becomes a real-outline body (polygon for closed shapes, a thin
    // band for open strokes) so collision follows the shape's perimeter.
    this.snapshot.clear()
    this.solids = []
    this.triggers = []
    // Enemy shape ids collected in the scan; turned into patrol entities below.
    const enemyIds: TLShapeId[] = []
    for (const s of shapes) {
      if (!LEVEL_TYPES.has(s.type)) continue
      if (playerIds.has(s.id)) continue
      const role = this.roleOf(s)
      // Enemies are MOVING entities, not static geometry — collect their ids and
      // build them as entities after the player (skip solids/triggers for them).
      if (role === 'enemy') {
        enemyIds.push(s.id)
        continue
      }
      const body = buildBody(editor, s.id)
      if (!body) continue
      if (role === 'token' || role === 'hazard' || role === 'goal') {
        this.triggers.push({ id: s.id, type: s.type, role, body })
        this.snapshot.set(s.id, { x: s.x, y: s.y, opacity: s.opacity })
      } else {
        // wall, unlabelled geo, or draw / line → solid terrain
        this.solids.push(body)
      }
    }

    // Build entity 0 (the player). Samples are stored relative to the bounds
    // top-left, so adding (kin.x, kin.y) each step yields their live page position.
    const kin = makeKinematic(playerBounds.minX, playerBounds.minY)
    const samples = playerBody.samples.map((p) => ({
      x: p.x - playerBounds.minX,
      y: p.y - playerBounds.minY,
    }))
    this.entities = [
      {
        id: player.id,
        motion: 'platformer',
        collision: 'solid',
        effect: 'none',
        params: {},
        kin,
        samples,
        parts: playerBody.parts,
      },
    ]

    // Build the enemy entities (motion 'patrol'). Each is a lone geo shape, so
    // collectPlayerBody gives us its bounds + merged outline + single leaf part
    // (offset 0) exactly as for a single-shape player. Snapshot its part so stop()
    // restores where it walked from.
    for (const id of enemyIds) {
      const body = collectPlayerBody(editor, id)
      if (!body) continue
      const eKin = makeKinematic(body.bounds.minX, body.bounds.minY)
      const eSamples = body.samples.map((p) => ({
        x: p.x - body.bounds.minX,
        y: p.y - body.bounds.minY,
      }))
      this.entities.push({
        id,
        motion: 'patrol',
        collision: 'trigger',
        effect: 'stomp',
        params: {},
        kin: eKin,
        samples: eSamples,
        parts: body.parts,
      })
    }
    this.spawn = { x: kin.x, y: kin.y }
    this.jumpPressed = false
    this.jumpReleased = false
    this.collected.clear()
    this.deaths = 0

    // NB: don't use `isReadonly` to lock editing — it also blocks our own
    // programmatic `updateShape` writes, so the player could never move. We just
    // clear selection; since the sim overwrites the player's position every frame,
    // a stray drag of the player self-heals on the next tick.
    editor.run(() => editor.selectNone(), { history: 'ignore' })

    window.addEventListener('keydown', this.onKeyDown, { capture: true })
    window.addEventListener('keyup', this.onKeyUp, { capture: true })

    this.playing = true
    this.finished = false
    this.lastTime = 0
    this.acc = 0
    this.emit('playing')
    this.raf = requestAnimationFrame(this.frame)
    return true
  }

  /** Stop play and restore the authored scene. */
  stop() {
    if (!this.playing) return
    this.playing = false
    this.finished = false
    cancelAnimationFrame(this.raf)
    window.removeEventListener('keydown', this.onKeyDown, { capture: true })
    window.removeEventListener('keyup', this.onKeyUp, { capture: true })
    this.keys.clear()

    const editor = this.editor
    editor.run(
      () => {
        // Restore triggers (opacity/position) …
        for (const [id, snap] of this.snapshot) {
          const s = editor.getShape(id)
          if (!s) continue
          editor.updateShape({
            id,
            type: s.type,
            x: snap.x,
            y: snap.y,
            opacity: snap.opacity,
          } as TLShapePartial)
        }
        // … and every entity's parts (each leaf, in its own coordinate space).
        for (const entity of this.entities) {
          for (const part of entity.parts) {
            if (!editor.getShape(part.id)) continue
            editor.updateShape({
              id: part.id,
              type: part.type,
              x: part.snap.x,
              y: part.snap.y,
              opacity: part.snap.opacity,
            } as TLShapePartial)
          }
        }
      },
      { history: 'ignore', ignoreShapeLock: true },
    )
  }

  private frame = (now: number) => {
    if (!this.playing || this.finished) return
    if (!this.lastTime) this.lastTime = now
    let dt = (now - this.lastTime) / 1000
    this.lastTime = now
    if (dt > SIM.MAX_FRAME) dt = SIM.MAX_FRAME

    this.acc += dt
    while (this.acc >= SIM.FIXED_DT) {
      this.step(SIM.FIXED_DT)
      this.acc -= SIM.FIXED_DT
    }

    this.writeEntities()
    this.checkEnemies() // stomp/kill against the player, before static triggers
    if (this.checkTriggers()) return // won → loop already stopped
    this.raf = requestAnimationFrame(this.frame)
  }

  /** One fixed substep: advance every entity, feeding the player its input. */
  private step(dt: number) {
    const t = this.tunables()

    // Consume this substep's jump edges (each physical press/release handled once).
    // These belong to the player (entity 0, the only input-reading entity).
    const left = this.keys.has('arrowleft') || this.keys.has('a')
    const right = this.keys.has('arrowright') || this.keys.has('d')
    const input: EntityInput = {
      dir: Number(right) - Number(left),
      jumpPressed: this.jumpPressed,
      jumpReleased: this.jumpReleased,
    }
    this.jumpPressed = false
    this.jumpReleased = false

    for (const entity of this.entities) {
      if (entity.defeated) continue // a stomped enemy stops stepping
      // Only the player reads input; other entities get a neutral input.
      const entityInput = entity.motion === 'platformer' ? input : NEUTRAL_INPUT
      stepEntity(
        entity.kin,
        entity.samples,
        this.solids,
        entityInput,
        entity.motion,
        entity.params,
        dt,
        t,
      )
    }
  }

  private writeEntities() {
    // The sim tracks each entity's bounds top-left (kin.x/kin.y). Each leaf part
    // sits at a fixed page offset from it (captured at start), so its target page
    // origin is (kin.x,kin.y)+offset. Write that back in the leaf's OWN space via
    // toLocal — identity for a top-level shape, group-local for a grouped child.
    // Moving every leaf (not the derived group container) keeps the figure rigid.
    this.editor.run(
      () => {
        for (const entity of this.entities) {
          if (entity.defeated) continue // hidden; leave it where it fell
          for (const part of entity.parts) {
            const local = part.toLocal.applyToPoint({
              x: entity.kin.x + part.offX,
              y: entity.kin.y + part.offY,
            })
            this.editor.updateShape({
              id: part.id,
              type: part.type,
              x: local.x,
              y: local.y,
            } as TLShapePartial)
          }
        }
      },
      { history: 'ignore', ignoreShapeLock: true },
    )
  }

  /**
   * @returns true if the game just ended (win), so the frame loop stops.
   *
   * Triggers are tested against the PLAYER (entity 0). The loop mutates inline
   * (opacity on collect, position on respawn) exactly as before, so a hazard
   * respawn mid-loop is seen by later triggers this frame — the original ordering.
   */
  private checkTriggers(): boolean {
    const player = this.player
    if (!player) return false
    const total = this.triggers.filter((t) => t.role === 'token').length

    for (const t of this.triggers) {
      if (!touches(player.kin, player.samples, t.body)) continue

      if (t.role === 'token') {
        if (!this.collected.has(t.id)) {
          this.collected.add(t.id)
          this.editor.run(
            () => this.editor.updateShape({ id: t.id, type: t.type, opacity: 0 } as TLShapePartial),
            { history: 'ignore', ignoreShapeLock: true },
          )
          this.emit('playing')
        }
      } else if (t.role === 'hazard') {
        this.respawn()
      } else if (t.role === 'goal') {
        // Must sweep every token first (if any exist) before the goal counts.
        if (this.collected.size >= total) {
          // End the sim but keep the session active, so the next Play/Stop toggle
          // routes to stop() → restore (not a fresh start() that re-snapshots the
          // won positions as the new authored scene).
          this.finished = true
          cancelAnimationFrame(this.raf)
          this.emit('won')
          return true
        }
      }
    }
    return false
  }

  /**
   * Player ↔ enemy interactions. For each live enemy overlapping the player,
   * `stompCheck` decides: STOMP (player was falling onto it from above → defeat the
   * enemy, hide it, bounce the player) or KILL (side/underneath hit → respawn).
   * Runs each frame against the settled positions, before the static triggers.
   */
  private checkEnemies() {
    const player = this.player
    if (!player || this.finished) return
    const pV = verticalBounds(player.kin, player.samples)
    const pBox = aabbOf(player.kin, player.samples)

    for (const enemy of this.entities) {
      if (enemy.motion !== 'patrol' || enemy.defeated) continue
      const eBox = aabbOf(enemy.kin, enemy.samples)
      if (!aabbOverlap(pBox, eBox)) continue

      const eV = verticalBounds(enemy.kin, enemy.samples)
      if (stompCheck(pV.bottom, player.kin.vy, eV.top, eV.bottom) === 'stomp') {
        // Defeat the enemy: stop stepping it, hide the shape, and bounce the player.
        enemy.defeated = true
        this.editor.run(
          () => this.editor.updateShape({ id: enemy.id, type: this.shapeType(enemy.id), opacity: 0 } as TLShapePartial),
          { history: 'ignore', ignoreShapeLock: true },
        )
        const bounce = this.tunables().jumpSpeed * STOMP_BOUNCE
        player.kin.vy = -bounce
        player.kin.jumpHeld = false
      } else {
        this.respawn()
        return // respawned — don't process further enemies this frame
      }
    }
  }

  /** The current shape type for an entity's record (for a typed updateShape). */
  private shapeType(id: TLShapeId): string {
    return this.editor.getShape(id)?.type ?? 'geo'
  }

  private respawn() {
    const player = this.player
    if (!player) return
    player.kin.x = this.spawn.x
    player.kin.y = this.spawn.y
    player.kin.vx = 0
    player.kin.vy = 0
    player.kin.grounded = false
    player.kin.touchingWall = false
    this.deaths++
    this.emit('playing')
  }

  private emit(status: GameState['status']) {
    this.onState({
      status,
      collected: this.collected.size,
      total: this.triggers.filter((t) => t.role === 'token').length,
      deaths: this.deaths,
    })
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase()
    if (GAME_KEYS.has(k)) {
      e.preventDefault()
      e.stopPropagation()
      // A jump keydown is an EDGE, not a held state — arm the buffer once per
      // press. `e.repeat` filters OS key-repeat so holding doesn't re-buffer.
      if (JUMP_KEYS.has(k) && !e.repeat) this.jumpPressed = true
      this.keys.add(k)
    }
  }

  private onKeyUp = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase()
    if (GAME_KEYS.has(k)) {
      e.preventDefault()
      // Releasing a jump key arms the variable-height cut — but only if NO jump
      // key is still held (you might jump with both Space and Up).
      if (JUMP_KEYS.has(k)) {
        this.keys.delete(k)
        if (![...JUMP_KEYS].some((j) => this.keys.has(j))) this.jumpReleased = true
      } else {
        this.keys.delete(k)
      }
    }
  }
}

/** Input for a non-player entity: no movement intent, no jump edges. */
const NEUTRAL_INPUT: EntityInput = { dir: 0, jumpPressed: false, jumpReleased: false }

/** Fraction of jumpSpeed applied as the upward bounce after stomping an enemy. */
const STOMP_BOUNCE = 0.7

/** A page-space AABB. */
interface Aabb {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** The page-space bounding box of an entity's outline at its current position. */
function aabbOf(kin: { x: number; y: number }, samples: { x: number; y: number }[]): Aabb {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const s of samples) {
    const x = s.x + kin.x
    const y = s.y + kin.y
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY }
}

/** True if two AABBs overlap (touching edges count as overlap). */
function aabbOverlap(a: Aabb, b: Aabb): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY
}

/** Keys the runtime owns while playing (so tldraw doesn't pan/scroll on them). */
const GAME_KEYS = new Set(['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd', 'w', ' '])
/** The subset that triggers a jump (edge-tracked for buffering + variable height). */
const JUMP_KEYS = new Set(['arrowup', 'w', ' '])
