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
import { tunablesAtom, gameStateAtom } from './state'
import { makeKinematic, type Entity, type EntityInput } from './entities/types'
import { stepEntity, touches, stompCheck, verticalBounds } from './entities/step'
import { springLaunchVy, shouldActivateCheckpoint } from './entities/props'
import {
  newSession,
  tickTime,
  onCollect,
  onStomp,
  onDeath,
  onWin,
  type Session,
  type SessionRules,
} from './session/session'
import { computeCamera, type CameraState } from './camera/camera'

/** Native tldraw shape types the engine reads: geo and draw carry a role via
 *  color; lines are always solid terrain. */
const LEVEL_TYPES = new Set(['geo', 'draw', 'line'])

export interface GameState {
  /** `lost` = out of lives (game over); `won` = reached the goal. */
  status: 'playing' | 'won' | 'lost' | 'no-player'
  collected: number
  total: number
  /** Deaths this session (kept for compatibility / the death counter). */
  deaths: number
  // --- M1 session rules (lean) ---
  /** Lives remaining; a hazard/enemy kill decrements it, 0 ⇒ game over. */
  lives: number
  /** Score: tokens + stomps + a time bonus on win. */
  score: number
  /** Elapsed play time this attempt, ms (drives the HUD timer). */
  timeMs: number
}

interface Trigger {
  id: TLShapeId
  type: string // geo or draw — a trigger can be drawn too
  role: Extract<Role, 'token' | 'hazard' | 'goal' | 'spring' | 'checkpoint'>
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

  // --- M1 session (lives/score/timer) + G3a checkpoint tracking ---
  private session: Session = newSession()
  /** Checkpoint ids already activated (each fires once — moves the spawn point). */
  private checkpoints = new Set<TLShapeId>()

  // --- M5 follow camera ---
  /** The camera at start(), restored on stop() so play doesn't move the author's view. */
  private authoredCamera: CameraState | null = null

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
  /** Session rules (lives/score/timer) for the current level. */
  private rules: SessionRules | undefined

  constructor(editor: Editor, onState: (s: GameState) => void, rules?: SessionRules) {
    this.editor = editor
    this.onState = onState
    this.rules = rules
  }

  /** Set the session rules for subsequent plays (e.g. loading a template). */
  setRules(rules: SessionRules | undefined) {
    this.rules = rules
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
      this.onState({
        status: 'no-player',
        collected: 0,
        total: 0,
        deaths: 0,
        lives: this.rules?.lives ?? 3,
        score: 0,
        timeMs: 0,
      })
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
      if (
        role === 'token' ||
        role === 'hazard' ||
        role === 'goal' ||
        role === 'spring' ||
        role === 'checkpoint'
      ) {
        // Overlap triggers: collect / kill / win / bounce / checkpoint.
        this.triggers.push({ id: s.id, type: s.type, role, body })
        this.snapshot.set(s.id, { x: s.x, y: s.y, opacity: s.opacity })
      } else if (role === 'oneway') {
        // A one-way platform: solid only from above (see collision.ts Body.oneWay).
        this.solids.push({ ...body, oneWay: true })
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
    this.checkpoints.clear()
    this.deaths = 0
    // Fresh session (lives/score/timer) for this attempt.
    this.session = newSession(this.rules)
    this.lastStatus = null // force the first emit('playing') to reach App
    // Remember the authored camera so stop() can restore the author's view.
    this.authoredCamera = { ...editor.getCamera() }

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

    // Restore the author's camera — play may have scrolled it to follow the player.
    if (this.authoredCamera) {
      editor.setCamera(this.authoredCamera)
      this.authoredCamera = null
    }
  }

  private frame = (now: number) => {
    if (!this.playing || this.finished) return
    if (!this.lastTime) this.lastTime = now
    let dt = (now - this.lastTime) / 1000
    this.lastTime = now
    if (dt > SIM.MAX_FRAME) dt = SIM.MAX_FRAME

    this.acc += dt
    while (this.acc >= SIM.FIXED_DT) {
      // Remember each entity's position BEFORE this substep so the render can
      // interpolate between the last two substeps (see below). Captured every
      // substep, so after the loop `renderPrev` holds the second-to-last position.
      for (const e of this.entities) {
        e.kin.prevX = e.kin.x
        e.kin.prevY = e.kin.y
      }
      this.step(SIM.FIXED_DT)
      this.acc -= SIM.FIXED_DT
    }

    // Advance the session clock (drives the HUD timer + any countdown loss).
    tickTime(this.session, dt * 1000)

    // Fixed-timestep render interpolation: the sim steps at 120Hz but the display
    // refreshes at ~60/144Hz, leaving a fractional `acc` remainder each frame.
    // Rendering the raw substep position makes the player advance a variable number
    // of substeps per frame → non-uniform on-screen spacing (residual stutter). So
    // render the player at the interpolated position between its last two substeps,
    // by the leftover fraction. alpha ∈ [0,1).
    const alpha = this.acc / SIM.FIXED_DT

    this.writeEntities(alpha)
    this.checkEnemies() // stomp/kill against the player, before static triggers
    if (this.checkTriggers()) return // won → loop already stopped
    // A countdown timeout or an out-of-lives death ends the game (game over).
    if (this.session.status === 'lost') {
      this.endGame('lost')
      return
    }
    this.emit('playing') // refresh the HUD (timer/score) each frame
    this.raf = requestAnimationFrame(this.frame)
  }

  /**
   * M5 follow camera: keep the player in a deadzone with velocity look-ahead.
   * `render` is the player's INTERPOLATED bounds top-left this frame (from
   * writeEntities), so the camera tracks the same smoothed position the player is
   * drawn at. Called inside writeEntities' editor.run so the scroll + move commit
   * together.
   */
  private updateCamera(render: { x: number; y: number }) {
    const player = this.player
    if (!player) return
    // Player half-extents from its outline, to turn the bounds top-left into a center.
    const local = aabbOf({ x: 0, y: 0 }, player.samples)
    const center = {
      x: render.x + (local.minX + local.maxX) / 2,
      y: render.y + (local.minY + local.maxY) / 2,
    }
    const vb = this.editor.getViewportScreenBounds()
    const prev = this.editor.getCamera()
    const next = computeCamera(
      { x: center.x, y: center.y, vx: player.kin.vx, vy: player.kin.vy },
      { w: vb.w, h: vb.h },
      { x: prev.x, y: prev.y, z: prev.z },
    )
    this.editor.setCamera(next)
  }

  /** End the game (won or lost): stop the sim, keep the session, emit the status. */
  private endGame(status: 'won' | 'lost') {
    this.finished = true
    cancelAnimationFrame(this.raf)
    this.emit(status)
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

  /**
   * Write every entity's leaves to the canvas AND move the follow camera, in ONE
   * editor.run batch so the world scroll and the player move commit in the same
   * paint (separate batches can render a frame out of sync at speed).
   *
   * `alpha` (0..1) is the fixed-timestep interpolation fraction: each leaf renders
   * at lerp(prev, cur, alpha) between the last two substeps, so the ~60Hz display
   * shows smooth motion over the 120Hz sim. The camera follows the same
   * interpolated player position, keeping the two perfectly in step.
   */
  private writeEntities(alpha: number) {
    this.editor.run(
      () => {
        let playerRender: { x: number; y: number } | null = null
        for (const entity of this.entities) {
          if (entity.defeated) continue // hidden; leave it where it fell
          // Interpolated bounds top-left for this frame.
          const rx = entity.kin.prevX + (entity.kin.x - entity.kin.prevX) * alpha
          const ry = entity.kin.prevY + (entity.kin.y - entity.kin.prevY) * alpha
          if (entity.motion === 'platformer') playerRender = { x: rx, y: ry }
          for (const part of entity.parts) {
            const local = part.toLocal.applyToPoint({ x: rx + part.offX, y: ry + part.offY })
            this.editor.updateShape({
              id: part.id,
              type: part.type,
              x: local.x,
              y: local.y,
            } as TLShapePartial)
          }
        }
        // Follow the interpolated player, in the same batch as its move.
        if (playerRender) this.updateCamera(playerRender)
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
          onCollect(this.session)
          this.editor.run(
            () => this.editor.updateShape({ id: t.id, type: t.type, opacity: 0 } as TLShapePartial),
            { history: 'ignore', ignoreShapeLock: true },
          )
          this.emit('playing')
        }
      } else if (t.role === 'hazard') {
        if (this.respawn()) return true // out of lives → game over, loop stops
      } else if (t.role === 'spring') {
        // A bounce pad: launch the player straight up (G3a).
        player.kin.vy = springLaunchVy(this.tunables().jumpSpeed * SPRING_LAUNCH)
        player.kin.jumpHeld = false
      } else if (t.role === 'checkpoint') {
        // Move the respawn point here, once per checkpoint (G3a).
        if (shouldActivateCheckpoint(t.id, this.checkpoints)) {
          this.checkpoints.add(t.id)
          this.spawn = { x: player.kin.x, y: player.kin.y }
        }
      } else if (t.role === 'goal') {
        // Must sweep every token first (if any exist) before the goal counts.
        if (this.collected.size >= total) {
          // Award the time bonus + end the game. Keep the session active so the
          // next Play/Stop toggle routes to stop() → restore (not a fresh start()
          // that re-snapshots the won positions as the new authored scene).
          onWin(this.session)
          this.endGame('won')
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
        // Defeat the enemy: stop stepping it, hide the shape, score it, bounce.
        enemy.defeated = true
        onStomp(this.session)
        this.editor.run(
          () => this.editor.updateShape({ id: enemy.id, type: this.shapeType(enemy.id), opacity: 0 } as TLShapePartial),
          { history: 'ignore', ignoreShapeLock: true },
        )
        const bounce = this.tunables().jumpSpeed * STOMP_BOUNCE
        player.kin.vy = -bounce
        player.kin.jumpHeld = false
      } else {
        // Side/underneath hit → lose a life and respawn (or game over).
        if (this.respawn()) this.endGame('lost')
        return // handled this frame; don't process further enemies
      }
    }
  }

  /** The current shape type for an entity's record (for a typed updateShape). */
  private shapeType(id: TLShapeId): string {
    return this.editor.getShape(id)?.type ?? 'geo'
  }

  /**
   * The player died. Costs a life (session); if lives remain, respawn at the
   * spawn point (moved by checkpoints). @returns true if that emptied lives —
   * i.e. the game is over — so the caller ends it.
   */
  private respawn(): boolean {
    const player = this.player
    if (!player) return false
    this.deaths++
    const { respawn } = onDeath(this.session)
    if (!respawn) return true // out of lives → game over (caller ends the game)
    player.kin.x = this.spawn.x
    player.kin.y = this.spawn.y
    // Snap the interpolation anchor too, or the render would lerp across the whole
    // level from where the player died to the spawn for one frame (a smear).
    player.kin.prevX = this.spawn.x
    player.kin.prevY = this.spawn.y
    player.kin.vx = 0
    player.kin.vy = 0
    player.kin.grounded = false
    player.kin.touchingWall = false
    this.emit('playing')
    return false
  }

  private lastStatus: GameState['status'] | null = null

  private buildState(status: GameState['status']): GameState {
    return {
      status,
      collected: this.collected.size,
      total: this.triggers.filter((t) => t.role === 'token').length,
      deaths: this.deaths,
      lives: this.session.lives,
      score: this.session.score,
      timeMs: Math.round(this.session.elapsedMs),
    }
  }

  /**
   * Emit game state. The HUD atom is updated every call (cheap reactive read).
   * The App callback (`onState` → React setState) fires ONLY when the `status`
   * changes — win/lose/playing transitions App actually renders on — NOT on the
   * per-frame timer/score tick. Calling setState 60×/s re-renders App every frame
   * and competes with the rAF sim loop (a source of movement stutter); the HUD
   * reads the atom instead, so the on-screen numbers still update smoothly.
   */
  private emit(status: GameState['status']) {
    const state = this.buildState(status)
    gameStateAtom.set(state) // HUD reads this every frame (cheap)
    if (status !== this.lastStatus) {
      this.lastStatus = status
      this.onState(state) // App re-renders only on a status transition
    }
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

/** Spring launch as a multiple of jumpSpeed (a spring throws you higher than a jump). */
const SPRING_LAUNCH = 1.6

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
