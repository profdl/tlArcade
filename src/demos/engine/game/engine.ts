/**
 * Engine — the play-mode runtime.
 *
 * tldraw is an editor, not a game loop, so this class *is* the game loop. On
 * start() it snapshots authored state, locks editing, and drives the single
 * player entity with a fixed-timestep sim (gravity + WASD/arrow movement + AABB
 * collision). On stop() it restores everything, so Play/Stop is non-destructive
 * and never touches the undo stack (all canvas writes go through
 * `editor.run(..., { history: 'ignore' })`).
 *
 * MVP scope / known limits (see CLAUDE.md):
 *  - Only the player moves. Solids are collected ONCE at start (editing is
 *    locked during play), so there are no moving platforms yet.
 *  - Collision is axis-aligned-bounding-box. A rotated wall collides as its
 *    upright AABB. Keep walls thicker than one sim step (~a few px) to be safe.
 */
import type { Editor, TLShapeId, TLShapePartial } from 'tldraw'
import { ROLES, isRole, type Role } from './roles'
import type { GameEntityShape } from '../render/EntityShapeUtil'

export const PHYSICS = {
  GRAVITY: 2600, // px/s²
  MOVE_SPEED: 340, // px/s, applied directly (tight platformer feel)
  JUMP_SPEED: 860, // px/s initial upward velocity
  MAX_FALL: 1800, // terminal downward speed
  FIXED_DT: 1 / 120, // sim substep
  MAX_FRAME: 0.05, // clamp real dt so a stall can't spiral the sim
} as const

/** Native tldraw shape types that double as solid terrain (draw your level). */
const SOLID_NATIVE_TYPES = new Set(['geo', 'draw', 'line'])

export interface GameState {
  status: 'playing' | 'won' | 'no-player'
  collected: number
  total: number
  deaths: number
}

interface Aabb {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

interface Trigger {
  id: TLShapeId
  role: Extract<Role, 'token' | 'hazard' | 'goal'>
  box: Aabb
}

const overlaps = (a: Aabb, b: Aabb) =>
  a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY

export class GameRuntime {
  private raf = 0
  private lastTime = 0
  private acc = 0
  private playing = false // a play session is active (until stop() restores)
  private finished = false // the game ended (won); sim ticking stopped, session still active

  private playerId!: TLShapeId
  private w = 0
  private h = 0
  private px = 0
  private py = 0
  private vx = 0
  private vy = 0
  private grounded = false

  private spawn = { x: 0, y: 0 }
  private solids: Aabb[] = []
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

  /** Begin play. Returns false (and does nothing) if there's no player on the page. */
  start(): boolean {
    const editor = this.editor
    const shapes = editor.getCurrentPageShapes()

    const player = shapes.find(
      (s) => s.type === 'gameEntity' && (s as GameEntityShape).props.role === 'player',
    ) as GameEntityShape | undefined

    if (!player) {
      this.onState({ status: 'no-player', collected: 0, total: 0, deaths: 0 })
      return false
    }

    // Snapshot everything we might mutate (player position, token opacity).
    this.snapshot.clear()
    for (const s of shapes) {
      if (s.type === 'gameEntity') {
        this.snapshot.set(s.id, { x: s.x, y: s.y, opacity: s.opacity })
      }
    }

    // Collect solids and triggers once (editing is locked during play).
    this.solids = []
    this.triggers = []
    for (const s of shapes) {
      const box = editor.getShapePageBounds(s.id)
      if (!box) continue
      const aabb: Aabb = { minX: box.minX, minY: box.minY, maxX: box.maxX, maxY: box.maxY }
      if (s.type === 'gameEntity') {
        if (s.id === player.id) continue
        const role = (s as GameEntityShape).props.role
        if (!isRole(role)) continue
        const def = ROLES[role]
        if (def.collision === 'solid') this.solids.push(aabb)
        else if (role === 'token' || role === 'hazard' || role === 'goal') {
          this.triggers.push({ id: s.id, role, box: aabb })
        }
      } else if (SOLID_NATIVE_TYPES.has(s.type)) {
        this.solids.push(aabb)
      }
    }

    this.playerId = player.id
    this.w = player.props.w
    this.h = player.props.h
    this.px = player.x
    this.py = player.y
    this.spawn = { x: player.x, y: player.y }
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
          // `type` is a non-literal union here, so TS can't resolve the
          // discriminated TLShapePartial — cast at the call site (root CLAUDE.md).
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
    this.px += this.vx * dt
    this.resolveX()
    this.py += this.vy * dt
    this.grounded = false
    this.resolveY()
  }

  private playerBox(): Aabb {
    return { minX: this.px, minY: this.py, maxX: this.px + this.w, maxY: this.py + this.h }
  }

  private resolveX() {
    const p = this.playerBox()
    for (const s of this.solids) {
      if (!overlaps(p, s)) continue
      if (this.vx > 0) this.px = s.minX - this.w
      else if (this.vx < 0) this.px = s.maxX
      this.vx = 0
      p.minX = this.px
      p.maxX = this.px + this.w
    }
  }

  private resolveY() {
    const p = this.playerBox()
    for (const s of this.solids) {
      if (!overlaps(p, s)) continue
      if (this.vy > 0) {
        this.py = s.minY - this.h
        this.grounded = true
      } else if (this.vy < 0) {
        this.py = s.maxY
      }
      this.vy = 0
      p.minY = this.py
      p.maxY = this.py + this.h
    }
  }

  private writePlayer() {
    this.editor.run(
      () => {
        this.editor.updateShape({ id: this.playerId, type: 'gameEntity', x: this.px, y: this.py })
      },
      { history: 'ignore', ignoreShapeLock: true },
    )
  }

  /** @returns true if the game just ended (win), so the frame loop stops. */
  private checkTriggers(): boolean {
    const p = this.playerBox()
    const total = this.triggers.filter((t) => t.role === 'token').length

    for (const t of this.triggers) {
      if (!overlaps(p, t.box)) continue

      if (t.role === 'token') {
        if (!this.collected.has(t.id)) {
          this.collected.add(t.id)
          this.editor.run(
            () => this.editor.updateShape({ id: t.id, type: 'gameEntity', opacity: 0 }),
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
