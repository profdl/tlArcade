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
import { createShapeId } from 'tldraw'
import type { Editor, TLDrawShape, TLGeoShape, TLShapeId, TLShapePartial } from 'tldraw'
import { roleForColor, shapeForRole, ROLES, TILE, type Role } from './roles'
import type { PlacementMeta } from './level'
import { collectPlayerBody, isPlayerMarked, type PlayerPart } from './player'
import { evaluateRig } from './rig/evaluate'
import { poseForState } from './rig/walk'
import type { Rig } from './rig/types'
import { compose, fromTRS, type Mat2D } from './rig/mat2d'
import { buildBody, type Body, type Pt } from './collision'
import { SIM, type PhysicsTunables } from './physics'
import { tunablesAtom, gameStateAtom } from './state'
import { makeKinematic, type Entity, type EntityInput } from './entities/types'
import { stepEntity, touches, stompCheck, verticalBounds } from './entities/step'
import {
  springLaunchV,
  shouldActivateCheckpoint,
  belowKillPlane,
  blinkSolidAt,
  crumbleGone,
} from './entities/props'
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
import { createAudioEngine, type AudioEngine } from './audio'

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
  role: Extract<Role, 'token' | 'hazard' | 'goal' | 'spring' | 'checkpoint' | 'portal'>
  body: Body
  /** Tier-1 behavior config off the shape's meta (spring launchAngle, portal channel). */
  meta?: PlacementMeta
}

/**
 * A hittable block (T1b): a solid you bonk from BELOW to eject a token (or just
 * break). It's in `this.solids` too (so you can stand on / bonk it); this record
 * carries the bonk-trigger state + what it contains.
 */
interface Block {
  id: TLShapeId
  type: string
  body: Body
  meta?: PlacementMeta
  /** Fires once: true after it's been bonked (ejected/broken). */
  hit: boolean
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
  /**
   * Monotonic sim time (s), advanced by FIXED_DT each substep. DETERMINISTIC — a
   * function of substep count, never wall-clock — so `sine`/`mover` motion (T1d/T1e)
   * is reproducible. Threaded into each mover entity's params before stepEntity.
   */
  private simTime = 0
  private solids: Body[] = []
  /** Hittable blocks (T1b) — solid + bonk-trigger; also in `solids`. */
  private blocks: Block[] = []
  /** Portals already used this pass, to debounce the arrival (see checkTriggers). */
  private portalCooldown = 0
  /**
   * Kill-plane (T0): a page-space Y below which an entity has fallen off the level
   * (a bottomless pit). Computed at start() from the lowest solid + a margin, so a
   * fall through a gap in the floor is a death — not just a walk into empty space.
   * Author-overridable later via SessionRules.
   */
  private deathY = Infinity
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

  /**
   * Event sounds (game/audio.ts). Framework-free; the runtime calls `play()` at
   * each event site. Defaults to a real engine, but it's a no-op until `resume()`
   * (a user gesture) loads the samples, so an un-resumed runtime is silent and
   * every existing test/flow that never calls resume() is behavior-identical.
   */
  private audio: AudioEngine

  constructor(editor: Editor, onState: (s: GameState) => void, rules?: SessionRules) {
    this.editor = editor
    this.onState = onState
    this.rules = rules
    this.audio = createAudioEngine()
  }

  /** Resume audio (call from the Play user gesture; Tone requires a gesture). */
  resumeAudio() {
    this.audio.resume()
  }

  /** Mute/unmute event sounds (fades, doesn't cut). */
  setMuted(muted: boolean) {
    this.audio.setMuted(muted)
  }

  /** Release audio resources (call when the runtime is torn down). */
  disposeAudio() {
    this.audio.dispose()
  }

  /** Set the session rules for subsequent plays (e.g. loading a template). */
  setRules(rules: SessionRules | undefined) {
    this.rules = rules
  }

  /** The player is entity 0. Convenience accessor for the (currently only) mover. */
  private get player(): Entity | undefined {
    return this.entities[0]
  }

  /** The moving-platform entities (motion 'mover', T1e/T1f) — solids that move. */
  private get movers(): Entity[] {
    return this.entities.filter((e) => e.motion === 'mover')
  }

  /** The live physics tunables (edited by the debug panel; read every substep). */
  private tunables(): PhysicsTunables {
    return tunablesAtom.get()
  }

  get isPlaying() {
    return this.playing
  }

  /**
   * A shape's role. A `meta.role` MARKER wins over color (PLAN §1.3: meta.role is
   * the primary mechanism for roles the color budget can't fit). The player is the
   * original marker (`meta.role === 'player'`, set via "Set as Player") — so a stick
   * figure can be any colour; the `platform` role also uses it, so it can render
   * GREY + dashed (visually "a wall-like surface, but different") without grey being
   * misread as a wall. Failing a marker, a geo/draw shape's COLOR maps to a role; a
   * non-role color stays solid terrain, and lines are always terrain.
   */
  private roleOf(shape: { type: string; meta?: Record<string, unknown> }): Role | null {
    if (isPlayerMarked(shape)) return 'player'
    const marked = shape.meta?.role
    if (typeof marked === 'string' && marked in ROLES) return marked as Role
    if (shape.type === 'geo') return roleForColor((shape as TLGeoShape).props.color)
    if (shape.type === 'draw') return roleForColor((shape as TLDrawShape).props.color)
    return null
  }

  /** A shape's Tier-1 behavior config (path/sine/blink/channel/…) off its meta. */
  private metaOf(shape: { meta?: Record<string, unknown> }): PlacementMeta {
    return (shape.meta ?? {}) as PlacementMeta
  }

  /**
   * The rig driving the player (R1), or undefined for a rigid whole-body player.
   * Read from the character's baked `meta.rig` (authored by the RigOverlay's "Bake
   * to player" — game/rig/authoring.ts). No rig ⇒ the rigid whole-body path.
   */
  private readRig(playerId: TLShapeId): Rig | undefined {
    const shape = this.editor.getShape(playerId)
    const baked = (shape?.meta as { rig?: Rig } | undefined)?.rig
    return baked && baked.version === 1 ? baked : undefined
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
    this.blocks = []
    this.portalCooldown = 0
    // Movers (enemy patrol, platform, sine oscillator) collected in the scan; turned
    // into entities after the player. Each carries its shape id + the meta config.
    const moverIds: TLShapeId[] = []
    for (const s of shapes) {
      if (!LEVEL_TYPES.has(s.type)) continue
      if (playerIds.has(s.id)) continue
      const role = this.roleOf(s)
      // Enemies and moving platforms are MOVING entities, not static geometry —
      // collect their ids and build them as entities after the player.
      if (role === 'enemy' || role === 'platform') {
        moverIds.push(s.id)
        continue
      }
      const body = buildBody(editor, s.id)
      if (!body) continue
      if (
        role === 'token' ||
        role === 'hazard' ||
        role === 'goal' ||
        role === 'spring' ||
        role === 'checkpoint' ||
        role === 'portal'
      ) {
        // Overlap triggers: collect / kill / win / bounce / checkpoint / teleport.
        // Carry the shape's meta so the spring's launchAngle (T1a) and the portal's
        // channel (T1c) reach checkTriggers — without it those read undefined and
        // the angled launch / warp silently no-op.
        this.triggers.push({ id: s.id, type: s.type, role, body, meta: this.metaOf(s) })
        this.snapshot.set(s.id, { x: s.x, y: s.y, opacity: s.opacity })
      } else if (role === 'block') {
        // Hittable block (T1b): a SOLID (so you stand on / bonk it) that ALSO fires a
        // head-bonk effect. Collect it as a solid AND as a bonk trigger; snapshot so
        // an ejected/broken block restores on stop().
        this.solids.push(body)
        this.blocks.push({ id: s.id, type: s.type, body, meta: this.metaOf(s), hit: false })
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
    // Rig (R1): a baked meta.rig, else bake it from the live joints/bindings. Build
    // leafId → part so writeEntities can apply each bone's delta to its leaf. No rig
    // ⇒ undefined ⇒ the rigid whole-body path (unchanged). Joint markers were
    // already excluded from the body by collectPlayerBody.
    const rig = this.readRig(player.id)
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
        rig,
      },
    ]

    // Build the MOVER entities (enemy patrol / sine oscillator / moving platform).
    // Each is a lone geo shape, so collectPlayerBody gives us its bounds + merged
    // outline + single leaf part (offset 0) exactly as for a single-shape player.
    // Snapshot its part so stop() restores where it started.
    for (const id of moverIds) {
      const body = collectPlayerBody(editor, id)
      if (!body) continue
      const shape = editor.getShape(id)
      const role = shape ? this.roleOf(shape) : null
      const meta = shape ? this.metaOf(shape) : {}
      const eKin = makeKinematic(body.bounds.minX, body.bounds.minY)
      const eSamples = body.samples.map((p) => ({
        x: p.x - body.bounds.minX,
        y: p.y - body.bounds.minY,
      }))
      this.snapshot.set(id, {
        x: shape?.x ?? body.bounds.minX,
        y: shape?.y ?? body.bounds.minY,
        opacity: shape?.opacity ?? 1,
      })

      if (role === 'platform') {
        // Moving platform (T1e): a mover with an A↔B path. A blink/crumble platform
        // stays put (it toggles/falls in place). A plain platform with NO authored
        // path — e.g. one just dragged from the tray — gets a sensible DEFAULT
        // horizontal ping-pong (a few tiles wide from its spot) so it actually moves
        // out of the box instead of sitting still.
        const stationary = meta.blink != null || meta.crumbleMs != null
        const path =
          meta.path ??
          (stationary
            ? { ax: eKin.x, ay: eKin.y, bx: eKin.x, by: eKin.y, speed: 0 }
            : {
                ax: eKin.x,
                ay: eKin.y,
                bx: eKin.x + DEFAULT_PLATFORM_TRAVEL,
                by: eKin.y,
                speed: DEFAULT_PLATFORM_SPEED,
              })
        this.entities.push({
          id,
          motion: 'mover',
          collision: 'solid',
          effect: meta.blink ? 'blink' : meta.crumbleMs != null ? 'crumble' : 'none',
          params: { path, blink: meta.blink, crumbleMs: meta.crumbleMs },
          kin: eKin,
          samples: eSamples,
          parts: body.parts,
          crumbleStandMs: null,
        })
      } else if (role === 'enemy' && meta.sine) {
        // Oscillating enemy (T1d, e.g. a Piranha rising from a pipe): a sine mover.
        this.entities.push({
          id,
          motion: 'sine',
          collision: 'trigger',
          effect: 'stomp',
          params: { sine: meta.sine, sineBase: { x: eKin.x, y: eKin.y } },
          kin: eKin,
          samples: eSamples,
          parts: body.parts,
        })
      } else {
        // Default enemy: a ground patroller (motion 'patrol').
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
    }
    this.spawn = { x: kin.x, y: kin.y }
    // Kill-plane (T0): a death line a margin below the DEEPEST solid, so falling
    // through a gap in the floor kills the player (a bottomless pit) instead of
    // falling forever. With no solids at all, anchor it below the player's spawn so
    // a floorless level still bounds the fall. The margin gives a beat of "falling"
    // before the death registers, which reads better than an instant cut at the floor.
    const lowestSolid = this.solids.reduce((m, b) => Math.max(m, b.bounds.maxY), -Infinity)
    const floor = lowestSolid > -Infinity ? lowestSolid : playerBounds.maxY
    this.deathY = floor + KILL_PLANE_MARGIN
    this.jumpPressed = false
    this.jumpReleased = false
    this.simTime = 0
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
      if (this.portalCooldown > 0) this.portalCooldown-- // debounce a fresh warp (T1c)
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
    if (this.checkKillPlane()) return // player fell out of the world → game over
    this.checkBlocks() // bonk a hittable block from below (T1b)
    this.checkCrumble() // arm a crumble platform once stood on (T1f)
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

    // Snapshot the player's pre-step state so we can sonify jump/land transitions
    // (both happen inside the PURE stepEntity, which can't make sound — so the
    // runtime detects them by diffing kinematic state across the substep). Capture
    // the descending speed BEFORE the step: on a landing substep the resolver
    // zeroes vy, so reading it after would always be 0 on the frame we need it.
    const player = this.player
    const wasGrounded = player?.kin.grounded ?? false
    const fallSpeedIn = player && player.kin.vy > 0 ? player.kin.vy : 0

    // Advance the deterministic sim clock, then hand it to every entity that reads
    // it (sine/mover). Set it on params up front so stepEntity's time-driven
    // branches see the current time.
    this.simTime += dt

    // Step the MOVERS (mover/sine) FIRST, so their new positions are known before
    // the player resolves against them this substep. A `mover` is a SOLID that
    // moves (T1e), so after stepping we rebuild the solids the player sees =
    // static solids + each present mover's live outline. This is the ONE place the
    // "solids captured once at start" rule bends — deliberately, for tagged movers.
    // While stepping each mover, remember its per-substep DELTA (dx,dy) so a player
    // standing on it can inherit that motion below (a platform should carry you).
    const playerEntity = this.player
    const carrier = playerEntity ? this.carrierUnder(playerEntity) : null
    for (const entity of this.entities) {
      if (entity.defeated || entity.motion === 'platformer') continue
      if (entity.motion === 'sine' || entity.motion === 'mover') {
        entity.params.simTime = this.simTime
      }
      const beforeX = entity.kin.x
      const beforeY = entity.kin.y
      stepEntity(entity.kin, entity.samples, this.solids, NEUTRAL_INPUT, entity.motion, entity.params, dt, t)
      // Carry a grounded player riding THIS mover by its delta (velocity
      // inheritance): move the player with the platform BEFORE it steps, so it
      // resolves from the carried position and rides along instead of being left
      // behind (the platform sliding out from under it).
      if (entity === carrier && playerEntity) {
        playerEntity.kin.x += entity.kin.x - beforeX
        playerEntity.kin.y += entity.kin.y - beforeY
      }
    }
    const playerSolids = this.solidsWithMovers()

    // Then step the PLAYER against the up-to-date solids (incl. live movers).
    if (playerEntity && !playerEntity.defeated) {
      stepEntity(
        playerEntity.kin,
        playerEntity.samples,
        playerSolids,
        input,
        playerEntity.motion,
        playerEntity.params,
        dt,
        t,
      )
    }

    // Jump: was on the ground, is now rising off it (a jump fired this substep).
    // Land: was airborne, is now grounded — the descending speed carried IN scales
    // the thud (jumpSpeed as the reference full-intensity fall).
    if (playerEntity) {
      const k = playerEntity.kin
      if (wasGrounded && !k.grounded && k.vy < 0) this.audio.play('jump')
      else if (!wasGrounded && k.grounded && fallSpeedIn > 0) {
        this.audio.play('land', Math.min(1, fallSpeedIn / t.jumpSpeed))
      }
      // R2: if the player is rigged, drive its pose from the walk cycle (grounded +
      // moving → swing arms/legs; else rest). writeEntities evaluates the rig with
      // this pose. Unrigged players carry no rig, so this is a cheap no-op for them.
      if (playerEntity.rig) {
        playerEntity.pose = poseForState({ grounded: k.grounded, vx: k.vx, simTime: this.simTime })
      }
    }
  }

  /**
   * The solids the PLAYER resolves against this substep: the static solids captured
   * at start(), plus each PRESENT `mover` platform's live page-space outline (T1e).
   * A blink/crumble mover (T1f) contributes only while `platformPresent` says it's
   * solid this frame. Rebuilt every substep — the deliberate exception to "solids
   * captured once".
   */
  private solidsWithMovers(): Body[] {
    if (!this.movers.length) return this.solids
    const live: Body[] = this.solids.slice()
    for (const m of this.movers) {
      if (m.defeated) continue
      if (!platformPresent(m, this.simTime)) continue
      live.push(moverBody(m))
    }
    return live
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

          // Rig (R1): evaluate the pose → per-leaf delta transforms (entity-local).
          // Absent for an unrigged entity, so the loop below stays the pure
          // translation path (byte-identical to before).
          const deltas = entity.rig ? evaluateRig(entity.rig, entity.pose) : null

          for (const part of entity.parts) {
            const delta = deltas?.get(part.id as string)
            if (delta) {
              // Rig-driven leaf: the rig delta D (entity-local rest→posed) moves the
              // leaf's rest origin and rotates it. Posed origin (entity-local) →
              // +（rx,ry) page → parent-local; rotation adds D's rotation to rest.
              this.writeRigPart(part, delta, rx, ry)
            } else {
              // Rigid whole-body (or a non-rig leaf): translation only, as before.
              const local = part.toLocal.applyToPoint({ x: rx + part.offX, y: ry + part.offY })
              this.editor.updateShape({
                id: part.id,
                type: part.type,
                x: local.x,
                y: local.y,
              } as TLShapePartial)
            }
          }
        }
        // Follow the interpolated player, in the same batch as its move.
        if (playerRender) this.updateCamera(playerRender)
      },
      { history: 'ignore', ignoreShapeLock: true },
    )
  }

  /**
   * Write one rig-driven leaf: apply the rig delta `D` (entity-local rest→posed) to
   * the leaf's rest origin and rotation, then map the posed page position back into
   * the leaf's own parent space. `D` is a rigid-body transform of entity-local space
   * (evaluate.ts), so applying it to the leaf origin moves it correctly whether the
   * leaf sits at its bone's origin or is offset from it (the orbit is baked into D).
   */
  private writeRigPart(part: PlayerPart, delta: Mat2D, rx: number, ry: number) {
    // Leaf rest origin in entity-local → posed origin (still entity-local).
    const posed = compose(delta, fromTRS(part.offX, part.offY, 0))
    // + interpolated body top-left → page, then page→parent-local.
    const local = part.toLocal.applyToPoint({ x: posed.tx + rx, y: posed.ty + ry })
    const rotation = part.restRotation + Math.atan2(delta.b, delta.a)
    this.editor.updateShape({
      id: part.id,
      type: part.type,
      x: local.x,
      y: local.y,
      rotation,
    } as TLShapePartial)
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
          // Brighten the coin ping as the player nears a full collection.
          this.audio.play('collect', total > 0 ? this.collected.size / total : 0.5)
          this.editor.run(
            () => this.editor.updateShape({ id: t.id, type: t.type, opacity: 0 } as TLShapePartial),
            { history: 'ignore', ignoreShapeLock: true },
          )
          this.emit('playing')
        }
      } else if (t.role === 'hazard') {
        this.audio.play('death')
        if (this.respawn()) return true // out of lives → game over, loop stops
      } else if (t.role === 'spring') {
        // A bounce pad: launch the player along the spring's angle (T1a). Default
        // angle 0 = straight up (identical to the original G3a spring).
        const { vx, vy } = springLaunchV(this.tunables().jumpSpeed * SPRING_LAUNCH, t.meta?.launchAngle)
        player.kin.vy = vy
        if (vx !== 0) player.kin.vx = vx
        player.kin.jumpHeld = false
        this.audio.play('spring')
      } else if (t.role === 'portal') {
        // Warp pipe (T1c): teleport the player to its channel partner, then debounce
        // so it doesn't instantly re-trigger on the destination.
        if (this.portalCooldown <= 0) this.teleportThroughPortal(t)
      } else if (t.role === 'checkpoint') {
        // Move the respawn point here, once per checkpoint (G3a).
        if (shouldActivateCheckpoint(t.id, this.checkpoints)) {
          this.checkpoints.add(t.id)
          this.spawn = { x: player.kin.x, y: player.kin.y }
          this.audio.play('checkpoint')
        }
      } else if (t.role === 'goal') {
        // Must sweep every token first (if any exist) before the goal counts.
        if (this.collected.size >= total) {
          // Award the time bonus + end the game. Keep the session active so the
          // next Play/Stop toggle routes to stop() → restore (not a fresh start()
          // that re-snapshots the won positions as the new authored scene).
          onWin(this.session)
          this.audio.play('win')
          this.endGame('won')
          return true
        }
      }
    }
    return false
  }

  /**
   * The moving platform the player is currently standing ON, if any (T1e velocity
   * inheritance). A carrier = a present mover whose top surface the player's feet
   * rest on (grounded + feet in a small band at the mover's top) while horizontally
   * overlapping it. Returns the first such mover, or null. Evaluated BEFORE the
   * movers step, so it reflects the contact the player resolved into last substep.
   */
  private carrierUnder(player: Entity): Entity | null {
    if (!player.kin.grounded) return null
    const pBox = aabbOf(player.kin, player.samples)
    for (const m of this.movers) {
      if (m.defeated || !platformPresent(m, this.simTime)) continue
      const mb = moverBody(m).bounds
      const overlapX = pBox.minX < mb.maxX && pBox.maxX > mb.minX
      const feetOnTop = pBox.maxY >= mb.minY - 2 && pBox.maxY <= mb.minY + 8
      if (overlapX && feetOnTop) return m
    }
    return null
  }

  /**
   * Crumble platforms (T1f): arm the fall timer the first time the player stands ON
   * a crumble mover. Detected by the player being grounded with its feet at the
   * platform's top surface and horizontally overlapping it. Once armed,
   * `platformPresent` drops the platform out `crumbleMs` later (via `crumbleGone`).
   */
  private checkCrumble() {
    const player = this.player
    if (!player) return
    for (const m of this.movers) {
      if (m.effect !== 'crumble' || m.crumbleStandMs != null || m.defeated) continue
      const mb = moverBody(m).bounds
      const pBox = aabbOf(player.kin, player.samples)
      const overlapX = pBox.minX < mb.maxX && pBox.maxX > mb.minX
      // Feet at the platform's top surface (a small band), player grounded.
      const feetOnTop = player.kin.grounded && pBox.maxY >= mb.minY - 2 && pBox.maxY <= mb.minY + 8
      if (overlapX && feetOnTop) m.crumbleStandMs = this.simTime * 1000
    }
  }

  /**
   * Hittable blocks (T1b): when the player bonks a block FROM BELOW (rising, its
   * head reaching the block's underside while horizontally overlapping it), fire the
   * block once — eject a token above it (if it `contains` one) and/or break it. The
   * block stays solid terrain either way (it's in `this.solids`); "break" just hides
   * it and drops it from the live solids so you can pass through after. Runs each
   * frame after the sim settles.
   */
  private checkBlocks() {
    const player = this.player
    if (!player || !this.blocks.length) return
    const pBox = aabbOf(player.kin, player.samples)
    // Only a RISING player can bonk a block from below.
    if (player.kin.vy >= 0) return

    for (const blk of this.blocks) {
      if (blk.hit) continue
      const b = blk.body.bounds
      // Horizontal overlap with the block, and the player's head at/above the
      // block's underside (within a small band) — a head-bonk, not a side touch.
      const overlapX = pBox.minX < b.maxX && pBox.maxX > b.minX
      const headAtUnderside = pBox.minY <= b.maxY && pBox.minY >= b.minY
      if (!overlapX || !headAtUnderside) continue

      blk.hit = true
      this.audio.play('stomp') // a firm thunk for the bonk
      if (blk.meta?.contains === 'token') this.ejectTokenAbove(blk)
      // Break the block: hide it and drop it from the live solids so it's passable.
      this.solids = this.solids.filter((s) => s !== blk.body)
      this.editor.run(
        () => this.editor.updateShape({ id: blk.id, type: blk.type, opacity: 0 } as TLShapePartial),
        { history: 'ignore', ignoreShapeLock: true },
      )
    }
  }

  /**
   * Eject a collectible token just above a bonked block (T1b): spawn a yellow token
   * shape a bit above the block, register it as a live trigger so the player can
   * collect it, and snapshot it for non-destructive restore on stop().
   */
  private ejectTokenAbove(blk: Block) {
    const b = blk.body.bounds
    const size = ROLES.token.size
    const x = (b.minX + b.maxX) / 2 - size.w / 2
    const y = b.minY - size.h - TILE * 0.25 // a quarter-tile above the block
    const base = shapeForRole('token')
    const id = createShapeId()
    this.editor.run(
      () => this.editor.createShape({ ...base, id, x, y }),
      { history: 'ignore', ignoreShapeLock: true },
    )
    const body = buildBody(this.editor, id)
    if (body) {
      this.triggers.push({ id, type: 'geo', role: 'token', body })
      this.snapshot.set(id, { x, y, opacity: 1 })
    }
  }

  /**
   * Warp the player from portal `from` to its channel partner (T1c). Picks the OTHER
   * portal trigger with the same `meta.channel`, moves the player so its outline
   * lands centered on the partner, and starts a cooldown so it doesn't immediately
   * re-trigger on arrival. No-op if the channel has no partner.
   */
  private teleportThroughPortal(from: Trigger) {
    const player = this.player
    if (!player) return
    const channel = from.meta?.channel
    if (channel == null) return
    const partner = this.triggers.find(
      (o) => o.role === 'portal' && o.id !== from.id && o.meta?.channel === channel,
    )
    if (!partner) return
    // Center the player's outline on the partner portal's center.
    const pBox = aabbOf(player.kin, player.samples)
    const pW = pBox.maxX - pBox.minX
    const pH = pBox.maxY - pBox.minY
    const b = partner.body.bounds
    const cx = (b.minX + b.maxX) / 2
    const cy = (b.minY + b.maxY) / 2
    player.kin.x = cx - pW / 2
    player.kin.y = cy - pH / 2
    // Snap the interpolation anchor so the render doesn't smear across the warp.
    player.kin.prevX = player.kin.x
    player.kin.prevY = player.kin.y
    this.portalCooldown = PORTAL_COOLDOWN_FRAMES
    this.audio.play('checkpoint') // a soft chime for the warp
  }

  /**
   * Kill-plane (T0): anything whose whole body has fallen below `deathY` has left
   * the world. The PLAYER falling off costs a life and respawns (or ends the game,
   * exactly like a hazard); an ENEMY falling off is just defeated — stop stepping
   * it so a patroller that walks off a ledge into a pit doesn't fall forever and
   * fling its shape across the page (stop() still restores it, non-destructive).
   *
   * @returns true if the player's fall emptied lives (game over) so the loop stops.
   */
  private checkKillPlane(): boolean {
    if (!isFinite(this.deathY)) return false
    for (const e of this.entities) {
      if (e.defeated) continue
      const top = verticalBounds(e.kin, e.samples).top
      if (!belowKillPlane(top, this.deathY)) continue
      if (e.motion === 'platformer') {
        this.audio.play('death')
        if (this.respawn()) {
          this.endGame('lost')
          return true
        }
      } else {
        // A mover (enemy) fell off — defeat it so it stops falling/stepping.
        e.defeated = true
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
        this.audio.play('stomp')
        this.editor.run(
          () => this.editor.updateShape({ id: enemy.id, type: this.shapeType(enemy.id), opacity: 0 } as TLShapePartial),
          { history: 'ignore', ignoreShapeLock: true },
        )
        const bounce = this.tunables().jumpSpeed * STOMP_BOUNCE
        player.kin.vy = -bounce
        player.kin.jumpHeld = false
      } else {
        // Side/underneath hit → lose a life and respawn (or game over).
        this.audio.play('death')
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

/**
 * How far below the deepest solid the kill-plane sits (T0). Four tiles — a couple
 * of player-heights of "falling" past the floor before a pit-fall registers as a
 * death, so it reads as a fall rather than an instant cut at floor level.
 */
const KILL_PLANE_MARGIN = TILE * 4

/**
 * How many substeps a portal is debounced after a warp (T1c) — long enough that the
 * player clears the destination portal's overlap before it can re-trigger, so a
 * pair doesn't bounce the player back and forth. ~30 substeps ≈ 0.25s at 120Hz.
 */
const PORTAL_COOLDOWN_FRAMES = 30

/**
 * Default travel (px) and speed (px/s) for a `platform` dropped with no authored
 * path (T1e) — a horizontal ping-pong 3 tiles wide at a gentle pace, so a
 * tray-dragged platform moves out of the box. An authored `meta.path` overrides.
 */
const DEFAULT_PLATFORM_TRAVEL = TILE * 3
const DEFAULT_PLATFORM_SPEED = 80

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

/**
 * A moving platform's live page-space collision body (T1e): its outline samples
 * (relative to bounds top-left) translated by the mover's current kin.x/kin.y into
 * a closed polygon. Rebuilt each substep so the player collides with it where it
 * IS now, not where it was authored.
 */
function moverBody(entity: Entity): Body {
  const pts: Pt[] = entity.samples.map((s) => ({ x: s.x + entity.kin.x, y: s.y + entity.kin.y }))
  const box = aabbOf(entity.kin, entity.samples)
  return {
    pts,
    closed: true,
    bounds: { minX: box.minX, minY: box.minY, maxX: box.maxX, maxY: box.maxY },
    margin: 0,
  }
}

/**
 * Is a mover platform PRESENT (solid) this substep (T1f)? A plain mover always is;
 * a `blink` platform toggles on its phase clock; a `crumble` platform is gone once
 * it has fallen away. Pure decisions in props.ts; this composes them with the
 * entity's config/runtime state.
 */
function platformPresent(entity: Entity, simTimeSec: number): boolean {
  if (entity.effect === 'blink' && entity.params.blink) {
    const { onMs, offMs, phaseMs } = entity.params.blink
    return blinkSolidAt(simTimeSec, onMs, offMs, phaseMs)
  }
  if (entity.effect === 'crumble' && entity.params.crumbleMs != null) {
    return !crumbleGone(entity.crumbleStandMs ?? null, simTimeSec * 1000, entity.params.crumbleMs)
  }
  return true
}

/** Keys the runtime owns while playing (so tldraw doesn't pan/scroll on them). */
const GAME_KEYS = new Set(['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd', 'w', ' '])
/** The subset that triggers a jump (edge-tracked for buffering + variable height). */
const JUMP_KEYS = new Set(['arrowup', 'w', ' '])
