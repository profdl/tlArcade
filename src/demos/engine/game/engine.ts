/**
 * Engine — the play-mode runtime (native-first).
 *
 * tldraw is an editor, not a game loop, so this class *is* the game loop. On
 * start() it snapshots authored state, collects the level from the NATIVE shapes
 * on the page (role read from a shape's color — see roles.ts → roleForColor),
 * and drives the single player shape with a fixed-timestep sim (gravity +
 * WASD/arrow movement + geometry-accurate collision). On stop() it restores, so
 * Play/Stop is non-destructive and never touches the undo stack (all canvas
 * writes go through `editor.run(..., { history: 'ignore' })`).
 *
 * Collision matches each shape's REAL perimeter, not its bounding box (see
 * game/collision.ts): a triangle collides as a triangle, a hand-drawn stroke as
 * a thin band along its path (so you can draw hills and valleys), and the player
 * collides by points sampled around its OWN outline — so an oddly-shaped player
 * nestles into terrain by its real edge. Resolution is still per-axis (move X,
 * separate; move Y, separate) so the platformer keeps crisp control and a
 * reliable `grounded` flag for jumping.
 *
 * The player can be a geo shape (blue, from the tray) OR a blue shape drawn with
 * the pencil — so it's sized/positioned from its page bounds, not props.w/h
 * (which draw shapes don't have).
 *
 * MVP scope / known limits (see CLAUDE.md):
 *  - Only the player moves. The level is collected ONCE at start.
 *  - Solids are static: a wall's outline is captured once at start, in page
 *    space, so rotating/moving a wall mid-play won't update its collision.
 */
import type { Editor, TLDrawShape, TLGeoShape, TLShapeId, TLShapePartial } from 'tldraw'
import { roleForColor, type Role } from './roles'
import {
  buildBody,
  outlineSamples,
  penetration,
  pointInPolygon,
  type Body,
  type Pt,
} from './collision'

export const PHYSICS = {
  GRAVITY: 2600, // px/s²
  MOVE_SPEED: 340, // px/s, applied directly (tight platformer feel)
  JUMP_SPEED: 860, // px/s initial upward velocity
  MAX_FALL: 1800, // terminal downward speed
  FIXED_DT: 1 / 120, // sim substep
  MAX_FRAME: 0.05, // clamp real dt so a stall can't spiral the sim
  // A push-out whose normal is at least this far from horizontal (|ny| above it)
  // counts as "floor-ish" and grounds the player when it opposes a downward move.
  // ~cos(50°): steep enough that walls don't ground you, shallow enough that a
  // drawn hillside still does.
  GROUND_NY: 0.64,
  // On the X pass, only a contact whose normal is at least this horizontal
  // (|nx| above it) is treated as a WALL that stops sideways motion. A slope's
  // normal is mostly vertical (|nx| small), so it's ignored on X and the player
  // walks up it via the Y pass instead of stalling against it — which is what
  // made a hill walkable one way but not the other. ~sin(55°): a surface steeper
  // than ~55° blocks you; anything shallower you can climb.
  WALL_NX: 0.82,
} as const

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

  private playerId!: TLShapeId
  private playerType = 'geo' // the player may be a geo shape or a drawn (pencil) shape
  private px = 0 // player bounds top-left (page space) — what the sim moves
  private py = 0
  // Player outline sample points, relative to the bounds top-left. Adding (px,py)
  // gives their live page position each step, so an oddly-shaped player collides
  // by its real perimeter without re-reading geometry mid-sim.
  private playerSamples: Pt[] = []
  // The player's record x/y differs from its bounds top-left for a draw shape
  // (its points don't start at the origin); this offset bridges the two.
  private offX = 0
  private offY = 0
  private vx = 0
  private vy = 0
  private grounded = false

  private spawn = { x: 0, y: 0 }
  private solids: Body[] = []
  private triggers: Trigger[] = []
  private collected = new Set<TLShapeId>()
  private deaths = 0

  /** id → authored { x, y, opacity } for non-destructive restore on stop. */
  private snapshot = new Map<TLShapeId, { x: number; y: number; opacity: number }>()

  private keys = new Set<string>()

  private editor: Editor
  private onState: (s: GameState) => void

  constructor(editor: Editor, onState: (s: GameState) => void) {
    this.editor = editor
    this.onState = onState
  }

  get isPlaying() {
    return this.playing
  }

  /**
   * A shape's role, from its color. Both geo shapes and shapes drawn with the
   * pencil (`draw`) map their color to a role — so you can draw any element, not
   * just the player. A color that isn't a role color stays solid terrain, so a
   * level can still be sketched (e.g. in black). Lines are always terrain.
   */
  private roleOf(shape: { type: string }): Role | null {
    if (shape.type === 'geo') return roleForColor((shape as TLGeoShape).props.color)
    if (shape.type === 'draw') return roleForColor((shape as TLDrawShape).props.color)
    return null
  }

  /** Begin play. Returns false (and does nothing) if there's no player on the page. */
  start(): boolean {
    const editor = this.editor
    const shapes = editor.getCurrentPageShapes()

    const player = shapes.find((s) => this.roleOf(s) === 'player')
    const playerBounds = player && editor.getShapePageBounds(player.id)
    const samples = player && outlineSamples(editor, player.id)

    if (!player || !playerBounds || !samples) {
      this.onState({ status: 'no-player', collected: 0, total: 0, deaths: 0 })
      return false
    }

    // Collect the level once, and snapshot anything we might mutate. Every solid
    // and trigger becomes a real-outline body (polygon for closed shapes, a thin
    // band for open strokes) so collision follows the shape's perimeter.
    this.snapshot.clear()
    this.solids = []
    this.triggers = []
    for (const s of shapes) {
      if (!LEVEL_TYPES.has(s.type)) continue
      if (s.id === player.id) continue
      const body = buildBody(editor, s.id)
      if (!body) continue
      const role = this.roleOf(s)
      if (role === 'token' || role === 'hazard' || role === 'goal') {
        this.triggers.push({ id: s.id, type: s.type, role, body })
        this.snapshot.set(s.id, { x: s.x, y: s.y, opacity: s.opacity })
      } else {
        // wall, unlabelled geo, or draw / line → solid terrain
        this.solids.push(body)
      }
    }

    this.playerId = player.id
    this.playerType = player.type
    this.px = playerBounds.minX
    this.py = playerBounds.minY
    // Store the player's outline samples relative to its bounds top-left, so
    // adding (px,py) each step yields their live page position.
    this.playerSamples = samples.map((p) => ({ x: p.x - playerBounds.minX, y: p.y - playerBounds.minY }))
    // A draw shape's record origin isn't its bounds' top-left; remember the gap
    // so we can convert the sim's bounds position back to a record x/y to write.
    this.offX = player.x - playerBounds.minX
    this.offY = player.y - playerBounds.minY
    this.spawn = { x: this.px, y: this.py }
    this.snapshot.set(player.id, { x: player.x, y: player.y, opacity: player.opacity })
    this.vx = 0
    this.vy = 0
    this.grounded = false
    this.collected.clear()
    this.deaths = 0

    // NB: don't use `isReadonly` to lock editing — it also blocks our own
    // programmatic `updateShape` writes, so the player could never move. We just
    // clear selection; since the sim overwrites the player's position every
    // frame, a stray drag of the player self-heals on the next tick.
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
      },
      { history: 'ignore', ignoreShapeLock: true },
    )
  }

  private frame = (now: number) => {
    if (!this.playing || this.finished) return
    if (!this.lastTime) this.lastTime = now
    let dt = (now - this.lastTime) / 1000
    this.lastTime = now
    if (dt > PHYSICS.MAX_FRAME) dt = PHYSICS.MAX_FRAME

    this.acc += dt
    while (this.acc >= PHYSICS.FIXED_DT) {
      this.step(PHYSICS.FIXED_DT)
      this.acc -= PHYSICS.FIXED_DT
    }

    this.writePlayer()
    if (this.checkTriggers()) return // won → loop already stopped
    this.raf = requestAnimationFrame(this.frame)
  }

  private step(dt: number) {
    const left = this.keys.has('arrowleft') || this.keys.has('a')
    const right = this.keys.has('arrowright') || this.keys.has('d')
    const jump = this.keys.has('arrowup') || this.keys.has('w') || this.keys.has(' ')

    this.vx = (Number(right) - Number(left)) * PHYSICS.MOVE_SPEED
    this.vy = Math.min(this.vy + PHYSICS.GRAVITY * dt, PHYSICS.MAX_FALL)

    if (jump && this.grounded) {
      this.vy = -PHYSICS.JUMP_SPEED
      this.grounded = false
    }

    // Move + resolve one axis at a time so a corner can't wedge the player.
    // Resolve Y first (gravity seats the player on the surface), then X — so on
    // the X pass the player is already sitting on a slope and only a genuine WALL
    // (near-vertical normal) blocks horizontal motion. A slope's normal is mostly
    // vertical, so the X pass ignores it (see resolveAxis) and the next Y pass
    // lifts the player up the incline instead of the slope stalling forward walk.
    this.py += this.vy * dt
    this.grounded = false
    this.resolveAxis('y')
    this.px += this.vx * dt
    this.resolveAxis('x')
  }

  /**
   * Push the player out of every solid it overlaps, correcting along ONE axis.
   *
   * We sample the player's outline points at the current position and, for each
   * one penetrating a solid body, ask collision.ts for the minimum push-out
   * (unit normal + depth). Projecting that onto the moving axis gives how far to
   * shift the player back along it; we take the LARGEST such shift across all
   * points/bodies (the deepest penetration governs) and apply it, then zero the
   * velocity on that axis if the correction opposed the motion. On the Y pass an
   * upward, floor-ish correction grounds the player (enables jumping).
   */
  private resolveAxis(axis: 'x' | 'y') {
    let bestShift = 0 // signed displacement to apply on this axis (px/py += it)
    let bestNy = 0 // ny of the correction that produced bestShift (for grounding)

    for (const local of this.playerSamples) {
      const p: Pt = { x: local.x + this.px, y: local.y + this.py }
      for (const body of this.solids) {
        const hit = penetration(p, body)
        if (!hit) continue
        // On the X pass, ignore floor-ish/slope contacts: a surface you can walk
        // UP (its normal is mostly vertical) shouldn't block sideways motion —
        // the Y pass lifts the player up it instead. Only a near-vertical WALL
        // normal stops you here. This is what makes a drawn hill walkable in BOTH
        // directions (an uphill contact used to cancel forward velocity).
        if (axis === 'x' && Math.abs(hit.nx) < PHYSICS.WALL_NX) continue
        // Component of the unit push-out normal along the axis we're resolving.
        // A near-zero component means this normal barely resolves along this axis
        // (e.g. a wall's sideways normal on the Y pass) — leave it to the other
        // axis rather than shoving the player a huge distance to clear it here.
        const comp = axis === 'x' ? hit.nx : hit.ny
        if (Math.abs(comp) < 1e-3) continue
        // The point must move `depth` along (nx,ny). Realised as a pure move along
        // this axis, that's depth / |comp| in the sign of `comp`. The deepest such
        // correction across all points/bodies governs the axis.
        const axisShift = (hit.depth / Math.abs(comp)) * Math.sign(comp)
        if (Math.abs(axisShift) > Math.abs(bestShift)) {
          bestShift = axisShift
          bestNy = hit.ny
        }
      }
    }

    if (bestShift === 0) return

    if (axis === 'x') {
      this.px += bestShift
      // Zero horizontal velocity only if we were pushed against our motion.
      if ((this.vx > 0 && bestShift < 0) || (this.vx < 0 && bestShift > 0)) this.vx = 0
    } else {
      this.py += bestShift
      if (bestShift < 0 && -bestNy >= PHYSICS.GROUND_NY) {
        // Pushed up out of a floor-ish surface → grounded (enables jumping).
        this.grounded = true
        if (this.vy > 0) this.vy = 0
      } else if (this.vy < 0 && bestShift > 0) {
        // Pushed down while rising → bonked a ceiling.
        this.vy = 0
      } else if (this.vy > 0 && bestShift < 0) {
        // Pushed up while falling against a steep (wall-ish) surface — stop the fall.
        this.vy = 0
      }
    }
  }

  private writePlayer() {
    // The sim tracks the bounds top-left (px/py); convert back to the shape's
    // record origin via the offset captured at start (0 for a geo player).
    this.editor.run(
      () => {
        this.editor.updateShape({
          id: this.playerId,
          type: this.playerType,
          x: this.px + this.offX,
          y: this.py + this.offY,
        } as TLShapePartial)
      },
      { history: 'ignore', ignoreShapeLock: true },
    )
  }

  /** True if any player sample point is inside/within a trigger's body. */
  private touches(body: Body): boolean {
    for (const local of this.playerSamples) {
      const p: Pt = { x: local.x + this.px, y: local.y + this.py }
      if (body.closed) {
        if (pointInPolygon(p, body.pts)) return true
      } else if (penetration(p, body)) {
        return true
      }
    }
    return false
  }

  /** @returns true if the game just ended (win), so the frame loop stops. */
  private checkTriggers(): boolean {
    const total = this.triggers.filter((t) => t.role === 'token').length

    for (const t of this.triggers) {
      if (!this.touches(t.body)) continue

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

  private respawn() {
    this.px = this.spawn.x
    this.py = this.spawn.y
    this.vx = 0
    this.vy = 0
    this.grounded = false
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
      this.keys.add(k)
    }
  }

  private onKeyUp = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase()
    if (GAME_KEYS.has(k)) {
      e.preventDefault()
      this.keys.delete(k)
    }
  }
}

/** Keys the runtime owns while playing (so tldraw doesn't pan/scroll on them). */
const GAME_KEYS = new Set(['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd', 'w', ' '])
