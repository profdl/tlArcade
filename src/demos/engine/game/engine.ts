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
 * Collision matches each shape's REAL perimeter, not its bounding box (see
 * game/collision.ts): a triangle collides as a triangle, a hand-drawn stroke as
 * a thin band along its path (so you can draw hills and valleys), and the player
 * collides by points sampled around its OWN outline — so an oddly-shaped player
 * nestles into terrain by its real edge. Resolution is still per-axis (move X,
 * separate; move Y, separate) so the platformer keeps crisp control and a
 * reliable `grounded` flag for jumping.
 *
 * The player can be a single geo shape (blue, from the tray), a blue shape drawn
 * with the pencil, OR a GROUP of shapes marked via the tray's "Set as Player"
 * (draw a stick figure, select the strokes, click it — see game/player.ts). It's
 * sized/positioned from its page bounds, not props.w/h (draw shapes and groups
 * don't have them); a group's parts are merged into one rigid outline for
 * collision, and each part LEAF is repositioned every frame (not the group
 * container, whose transform is derived from its children) to keep it rigid.
 *
 * MVP scope / known limits (see CLAUDE.md):
 *  - Only the player moves. The level is collected ONCE at start.
 *  - Solids are static: a wall's outline is captured once at start, in page
 *    space, so rotating/moving a wall mid-play won't update its collision.
 */
import type { Editor, TLDrawShape, TLGeoShape, TLShapeId, TLShapePartial } from 'tldraw'
import { roleForColor, type Role } from './roles'
import { collectPlayerBody, isPlayerMarked, type PlayerPart } from './player'
import { buildBody, penetration, pointInPolygon, type Body, type Pt } from './collision'
import { SIM, stepVx, stepVy, type PhysicsTunables } from './physics'
import { tunablesAtom } from './state'

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

  private px = 0 // player bounds top-left (page space) — what the sim moves
  private py = 0
  // Player outline sample points, relative to the bounds top-left. Adding (px,py)
  // gives their live page position each step, so an oddly-shaped player collides
  // by its real perimeter without re-reading geometry mid-sim.
  private playerSamples: Pt[] = []
  // The shapes actually driven each frame: every writable LEAF of the player (one
  // shape for a lone player, all the parts for a group — the group container
  // itself is derived from its children, so we move the children, not it). Each
  // leaf remembers where its record origin sat relative to the player's bounds
  // top-left AT START, in PAGE space, plus the page→local conversion for its
  // parent — so each frame we place it at (px,py)+its offset and write it back in
  // its own coordinate space (a grouped child stores x/y in group-local space).
  private parts: PlayerPart[] = []
  private vx = 0
  private vy = 0
  private grounded = false
  // Game-feel timers (see physics.ts). coyote: time left in which a just-left
  // ledge still lets you jump. buffer: time left in which a slightly-early jump
  // press still fires on landing. Both count DOWN in seconds each substep.
  private coyoteTimer = 0
  private bufferTimer = 0
  // Whether a jump impulse is "live" — the key is held AND we haven't cut it yet.
  // Releasing the key while this is true and still rising applies the variable-
  // height jump cut (short hop). Cleared on land / cut so it fires once per jump.
  private jumpHeld = false

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
  // live (arms the variable-height cut). The step() reads and clears them so each
  // physical press/release is handled exactly once, independent of frame rate.
  private jumpPressed = false
  private jumpReleased = false

  private editor: Editor
  private onState: (s: GameState) => void

  constructor(editor: Editor, onState: (s: GameState) => void) {
    this.editor = editor
    this.onState = onState
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
   * 'player'`, set via the tray's "Set as Player" (a group, or a lone shape) —
   * which WINS over color, so a stick figure can be any colour. Failing that, a
   * geo/draw shape's COLOR maps to a role (blue = player, so single-blue-shape
   * levels still work; grey/yellow/red/green = wall/token/hazard/goal). A color
   * that isn't a role color stays solid terrain (sketch a level in black); lines
   * are always terrain.
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
    const samples = playerBody.samples

    // The player's parts (a group's descendants) are NOT level geometry — skip
    // the whole subtree so a stick-figure limb isn't collected as terrain.
    const playerIds = editor.getShapeAndDescendantIds([player.id])

    // Collect the level once, and snapshot anything we might mutate. Every solid
    // and trigger becomes a real-outline body (polygon for closed shapes, a thin
    // band for open strokes) so collision follows the shape's perimeter.
    this.snapshot.clear()
    this.solids = []
    this.triggers = []
    for (const s of shapes) {
      if (!LEVEL_TYPES.has(s.type)) continue
      if (playerIds.has(s.id)) continue
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

    this.parts = playerBody.parts
    this.px = playerBounds.minX
    this.py = playerBounds.minY
    // Store the player's outline samples relative to its bounds top-left, so
    // adding (px,py) each step yields their live page position.
    this.playerSamples = samples.map((p) => ({ x: p.x - playerBounds.minX, y: p.y - playerBounds.minY }))
    this.spawn = { x: this.px, y: this.py }
    this.vx = 0
    this.vy = 0
    this.grounded = false
    this.coyoteTimer = 0
    this.bufferTimer = 0
    this.jumpHeld = false
    this.jumpPressed = false
    this.jumpReleased = false
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
        // … and the player's parts (each leaf, in its own coordinate space).
        for (const part of this.parts) {
          if (!editor.getShape(part.id)) continue
          editor.updateShape({
            id: part.id,
            type: part.type,
            x: part.snap.x,
            y: part.snap.y,
            opacity: part.snap.opacity,
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
    if (dt > SIM.MAX_FRAME) dt = SIM.MAX_FRAME

    this.acc += dt
    while (this.acc >= SIM.FIXED_DT) {
      this.step(SIM.FIXED_DT)
      this.acc -= SIM.FIXED_DT
    }

    this.writePlayer()
    if (this.checkTriggers()) return // won → loop already stopped
    this.raf = requestAnimationFrame(this.frame)
  }

  private step(dt: number) {
    const t = this.tunables()
    const left = this.keys.has('arrowleft') || this.keys.has('a')
    const right = this.keys.has('arrowright') || this.keys.has('d')
    const dir = Number(right) - Number(left)

    // Consume this substep's jump edges (each physical press/release handled once).
    const pressed = this.jumpPressed
    const released = this.jumpReleased
    this.jumpPressed = false
    this.jumpReleased = false

    // --- horizontal: accelerate toward the target, or rub off with friction ---
    this.vx = stepVx(this.vx, dir, this.grounded, dt, t)

    // --- gravity: heavier falling, floaty apex (see physics.ts) ---
    this.vy = stepVy(this.vy, dt, t)

    // --- jump: buffer the press, then fire it if coyote time allows -----------
    // A press arms the buffer; ANY buffered press keeps ticking down. We jump on
    // the first substep where the buffer is live AND we're within coyote time of
    // solid ground — which folds together "jump on landing" (buffer) and "jump
    // just after a ledge" (coyote) into one check.
    if (pressed) this.bufferTimer = t.jumpBuffer
    if (this.bufferTimer > 0 && this.coyoteTimer > 0) {
      this.vy = -t.jumpSpeed
      this.grounded = false
      this.jumpHeld = true // this jump is live until released or landed
      this.bufferTimer = 0
      this.coyoteTimer = 0
    }
    // Variable height: releasing the key while still rising cuts the ascent, so a
    // tap is a short hop and a hold is a full jump. Only bites once per jump.
    if (released && this.jumpHeld && this.vy < 0) {
      this.vy *= t.jumpCut
      this.jumpHeld = false
    }

    // Move + resolve one axis at a time so a corner can't wedge the player.
    // Resolve Y first (gravity seats the player on the surface), then X — so on
    // the X pass the player is already sitting on a slope and only a genuine WALL
    // (near-vertical normal) blocks horizontal motion. A slope's normal is mostly
    // vertical, so the X pass ignores it (see resolveAxis) and the next Y pass
    // lifts the player up the incline instead of the slope stalling forward walk.
    this.py += this.vy * dt
    this.grounded = false
    this.resolveAxis('y', t)
    this.px += this.vx * dt
    this.resolveAxis('x', t)

    // Coyote time: refreshed to full whenever grounded, else bleeds down. Placed
    // AFTER resolution so it reflects this step's true grounded state; a jump next
    // substep can still consume the remaining window after walking off a ledge.
    if (this.grounded) {
      this.coyoteTimer = t.coyoteTime
      this.jumpHeld = false // landing ends any live jump (so the next is fresh)
    } else if (this.coyoteTimer > 0) {
      this.coyoteTimer -= dt
    }
    if (this.bufferTimer > 0) this.bufferTimer -= dt
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
  private resolveAxis(axis: 'x' | 'y', t: PhysicsTunables) {
    const { shift, ny } = this.deepestShift(axis, this.px, this.py)

    if (shift === 0) return

    if (axis === 'x') {
      this.px += shift
      // Zero horizontal velocity only if we were pushed against our motion.
      if ((this.vx > 0 && shift < 0) || (this.vx < 0 && shift > 0)) this.vx = 0
    } else {
      if (shift > 0 && this.vy < 0) {
        // Pushed DOWN while rising → a ceiling bonk. Before killing the jump, try
        // corner correction: if a small sideways nudge (either way, up to
        // cornerCorrect px) would let the head slip past the obstruction, take it
        // and keep rising. This stops a jump from dying on a pixel of overhang.
        if (this.tryCornerCorrect(t)) return
        this.vy = 0
      }
      this.py += shift
      if (shift < 0 && -ny >= SIM.GROUND_NY) {
        // Pushed up out of a floor-ish surface → grounded (enables jumping).
        this.grounded = true
        if (this.vy > 0) this.vy = 0
      } else if (this.vy > 0 && shift < 0) {
        // Pushed up while falling against a steep (wall-ish) surface — stop the fall.
        this.vy = 0
      }
    }
  }

  /**
   * The deepest per-axis push-out for the player outline sampled at (ox,oy),
   * across every solid — the same "largest correction governs" rule the resolver
   * uses, factored out so corner correction can probe hypothetical positions
   * without moving the player. Returns the signed axis shift and the ny of the
   * contact that produced it (for grounding).
   */
  private deepestShift(axis: 'x' | 'y', ox: number, oy: number): { shift: number; ny: number } {
    let bestShift = 0
    let bestNy = 0
    for (const local of this.playerSamples) {
      const p: Pt = { x: local.x + ox, y: local.y + oy }
      for (const body of this.solids) {
        const hit = penetration(p, body)
        if (!hit) continue
        // On the X pass, ignore floor-ish/slope contacts: a surface you can walk
        // UP (its normal is mostly vertical) shouldn't block sideways motion —
        // the Y pass lifts the player up it instead. Only a near-vertical WALL
        // normal stops you here.
        if (axis === 'x' && Math.abs(hit.nx) < SIM.WALL_NX) continue
        // Component of the unit push-out normal along the axis we're resolving; a
        // near-zero component barely resolves here, so leave it to the other axis.
        const comp = axis === 'x' ? hit.nx : hit.ny
        if (Math.abs(comp) < 1e-3) continue
        const axisShift = (hit.depth / Math.abs(comp)) * Math.sign(comp)
        if (Math.abs(axisShift) > Math.abs(bestShift)) {
          bestShift = axisShift
          bestNy = hit.ny
        }
      }
    }
    return { shift: bestShift, ny: bestNy }
  }

  /**
   * On a ceiling bonk, look for a small horizontal offset (±1..cornerCorrect px)
   * at which the player would NOT be pushed down on Y — i.e. the head clears the
   * corner. If found, slide the player there (keeping upward velocity) and report
   * success so the caller skips the bonk. Prefers the smallest nudge; tries the
   * side matching current horizontal motion first, then the other.
   */
  private tryCornerCorrect(t: PhysicsTunables): boolean {
    const max = Math.round(t.cornerCorrect)
    if (max <= 0) return false
    // Try the direction we're already moving first (feels intentional), else L→R.
    const firstSign = this.vx < 0 ? -1 : 1
    const order = firstSign === 1 ? [1, -1] : [-1, 1]
    for (let d = 1; d <= max; d++) {
      for (const sign of order) {
        const nudged = this.deepestShift('y', this.px + sign * d, this.py)
        // Clear iff the head needs NO vertical correction at the nudged x — i.e.
        // it neither still hits the ceiling (shift > 0) nor drops into a floor
        // (shift < 0). Exactly clear is what makes the slip feel like a clean pass.
        if (nudged.shift === 0) {
          this.px += sign * d
          return true
        }
      }
    }
    return false
  }

  private writePlayer() {
    // The sim tracks the player bounds top-left (px/py). Each leaf part sits at a
    // fixed page offset from it (captured at start), so its target page origin is
    // (px,py)+offset. Write that back in the leaf's OWN space via toLocal — for a
    // top-level shape toLocal is identity, so it's just the page point; for a
    // grouped child it maps into group-local coordinates. Moving every leaf (not
    // the derived group container) is what keeps the whole figure rigid.
    this.editor.run(
      () => {
        for (const part of this.parts) {
          const local = part.toLocal.applyToPoint({
            x: this.px + part.offX,
            y: this.py + part.offY,
          })
          this.editor.updateShape({
            id: part.id,
            type: part.type,
            x: local.x,
            y: local.y,
          } as TLShapePartial)
        }
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

/** Keys the runtime owns while playing (so tldraw doesn't pan/scroll on them). */
const GAME_KEYS = new Set(['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd', 'w', ' '])
/** The subset that triggers a jump (edge-tracked for buffering + variable height). */
const JUMP_KEYS = new Set(['arrowup', 'w', ' '])
