/**
 * rig-play — the play-mode runtime (the WASD mover + rig driver).
 *
 * tldraw is an editor, not a game loop, so this class IS the loop (the same shape as
 * the Engine demo's engine.ts, but a fraction of the size — this demo has NO terrain,
 * collision, entities, triggers, camera, or physics tuning). It exists only to bring a
 * rigged character to life under keyboard control:
 *
 *   - A LIGHTWEIGHT KINEMATIC MOVER: A/D drive vx (and flip facing), W/Space hop under
 *     gravity, a single FLOOR line catches the hop, S holds a crouch, E fires a one-shot
 *     wave. No collision, no terrain — the character just moves across the open canvas.
 *   - THE RIG DRIVER: each substep it builds a `WalkState` from the mover, asks the pure
 *     state machine (rig/walk.ts) for a `Pose`, evaluates the rig (rig/evaluate.ts), and
 *     writes each leaf's transform + the body's base translation (writeRigPart, ported
 *     from engine.ts). Bones live in `meta.rig`, so nothing but leaf transforms move.
 *
 * Discipline carried over from Engine (engine-runtime-conventions): ALL canvas writes go
 * through editor.run(fn, { history: 'ignore', ignoreShapeLock: true }) so play never
 * pollutes undo, and start()/stop() are non-destructive — stop() restores each leaf's
 * snapshot INCLUDING rotation (a rigged leaf's record rotation is overwritten every
 * frame; without restoring it the next start() bakes the rig from a broken rest).
 */
import { type Editor, type TLShapePartial } from 'tldraw'
import { collectRigBody, isCharacterMarked, type BodyPart } from './body'
import { legRigsFrom, readRig } from './rig'
import { evaluateBoneWorlds, evaluateRig, type Pose } from '../rig/evaluate'
import type { Rig } from '../rig/types'
import { compose, fromTRS, type Mat2D } from '../rig/mat2d'
import { poseForState, WALK_DEFAULTS, type LegRig, type WalkState } from '../rig/walk'
import { legModeAtom, rigDebugAtom, showRigDebugAtom } from './state'

/** Fixed simulation step (seconds) — a deterministic clock, like Engine's SIM.FIXED_DT. */
const FIXED_DT = 1 / 60

/** Mover feel constants — deliberately simple (no live tuning panel in this demo). */
const MOVE = {
  /** Target horizontal speed under A/D (px/s). Matches the walk's fullSpeed so the
   *  leg cadence reads at full amplitude when running flat out. */
  moveSpeed: 340,
  /** How fast vx approaches the target / decays to 0 (per second, exponential-ish). */
  accel: 12,
  /** Gravity (px/s²). */
  gravity: 1400,
  /** Upward launch speed on jump (px/s). Tuned to a ~2-tile hop. */
  jumpSpeed: 620,
  /** Wave duration (seconds) for the one-shot E action. */
  waveDuration: 1.1,
} as const

/** The live keyboard state the App feeds in (which keys are currently held). */
export interface InputState {
  left: boolean
  right: boolean
  jump: boolean
  crouch: boolean
}

/** The mover's kinematic state, integrated each substep. */
interface Kin {
  /** Body top-left in PAGE space (the character's bounds min at start + travel). */
  x: number
  y: number
  vx: number
  vy: number
  grounded: boolean
  facing: 1 | -1
  /** Seconds remaining on the current one-shot wave (0 = not waving). */
  waveT: number
  /** Signed grounded horizontal distance travelled (drives the distance-based stride). */
  strideDistance: number
}

export class RigRuntime {
  private raf = 0
  private running = false
  private acc = 0
  private last = 0
  private simTime = 0

  private rig: Rig | null = null
  private parts: BodyPart[] = []
  private legs: { L: LegRig; R: LegRig } | null = null
  private kin: Kin | null = null
  /** The floor page-Y the body's BOTTOM rests on (its start bottom). */
  private floorY = 0
  private bodyH = 0

  private input: InputState = { left: false, right: false, jump: false, crouch: false }
  /** Edge-triggered jump: only launch on a fresh press, not while held. */
  private jumpWasDown = false

  private editor: Editor

  constructor(editor: Editor) {
    this.editor = editor
  }

  /** The pose applied on the most recent frame (DEV/e2e introspection). */
  private lastPose: Pose = {}

  get isRunning() {
    return this.running
  }

  /** DEV-only snapshot for the headless e2e: the live pose + mover kinematics. */
  debugState() {
    return {
      pose: this.lastPose,
      x: this.kin?.x ?? 0,
      y: this.kin?.y ?? 0,
      vx: this.kin?.vx ?? 0,
      grounded: this.kin?.grounded ?? true,
    }
  }

  /** Update the held-keys state (called by the App's keydown/keyup handlers). */
  setInput(input: InputState) {
    this.input = input
  }

  /** Fire a one-shot wave (E). Ignored if already waving. */
  triggerWave() {
    if (this.kin && this.kin.waveT <= 0) this.kin.waveT = MOVE.waveDuration
  }

  /**
   * Begin play. Finds the marked character, reads its rig, snapshots its parts, seeds
   * the mover at its current position, and starts the rAF loop. Returns false if there's
   * no character to drive.
   */
  start(): boolean {
    const character = this.editor.getCurrentPageShapes().find((s) => isCharacterMarked(s))
    if (!character) return false

    const body = collectRigBody(this.editor, character.id)
    if (!body) return false

    this.parts = body.parts
    this.rig = readRig(character) ?? null
    this.legs = this.rig ? legRigsFrom(this.rig) : null
    this.bodyH = body.bounds.h
    this.floorY = body.bounds.minY + body.bounds.h
    this.kin = {
      x: body.bounds.minX,
      y: body.bounds.minY,
      vx: 0,
      vy: 0,
      grounded: true,
      facing: 1,
      waveT: 0,
      strideDistance: 0,
    }
    this.jumpWasDown = false
    this.simTime = 0
    this.acc = 0
    this.last = 0
    this.running = true
    this.raf = requestAnimationFrame(this.tick)
    return true
  }

  /** Stop play and restore every part's snapshot (non-destructive). */
  stop() {
    if (!this.running) return
    this.running = false
    cancelAnimationFrame(this.raf)
    this.raf = 0
    rigDebugAtom.set(null)

    const parts = this.parts
    this.editor.run(
      () => {
        for (const p of parts) {
          this.editor.updateShape({
            id: p.id,
            type: p.type,
            x: p.snap.x,
            y: p.snap.y,
            rotation: p.snap.rotation,
            opacity: p.snap.opacity,
          } as TLShapePartial)
        }
      },
      { history: 'ignore', ignoreShapeLock: true },
    )

    this.rig = null
    this.parts = []
    this.legs = null
    this.kin = null
  }

  /** rAF driver: accumulate wall-clock into fixed substeps for a deterministic sim. */
  private tick = (now: number) => {
    if (!this.running) return
    if (this.last === 0) this.last = now
    let dt = (now - this.last) / 1000
    this.last = now
    // Clamp a big gap (tab-switch) so we don't spiral catching up.
    if (dt > 0.1) dt = 0.1
    this.acc += dt

    while (this.acc >= FIXED_DT) {
      this.step(FIXED_DT)
      this.acc -= FIXED_DT
    }
    this.write()
    this.raf = requestAnimationFrame(this.tick)
  }

  /** One fixed substep of the mover. */
  private step(dt: number) {
    const k = this.kin
    if (!k) return
    this.simTime += dt

    // Horizontal: approach ±moveSpeed under A/D, decay to 0 when idle. An exponential
    // approach (frame-rate-independent) rather than instant velocity, so it reads smooth.
    const dir = (this.input.right ? 1 : 0) - (this.input.left ? 1 : 0)
    const targetVx = dir * MOVE.moveSpeed
    const blend = 1 - Math.exp(-MOVE.accel * dt)
    k.vx += (targetVx - k.vx) * blend
    if (dir !== 0) k.facing = dir > 0 ? 1 : -1

    // Jump on a fresh press while grounded (edge-triggered).
    const jumpDown = this.input.jump
    if (jumpDown && !this.jumpWasDown && k.grounded) {
      k.vy = -MOVE.jumpSpeed
      k.grounded = false
    }
    this.jumpWasDown = jumpDown

    // Vertical: gravity + integrate, then land on the floor.
    k.vy += MOVE.gravity * dt
    k.x += k.vx * dt
    k.y += k.vy * dt

    const bottom = k.y + this.bodyH
    if (bottom >= this.floorY) {
      k.y = this.floorY - this.bodyH
      k.vy = 0
      k.grounded = true
    } else {
      k.grounded = false
    }

    // Accumulate grounded travel for the distance-driven stride (legs stop when the body
    // stops), and tick the wave.
    if (k.grounded) k.strideDistance += k.vx * dt
    if (k.waveT > 0) k.waveT = Math.max(0, k.waveT - dt)
  }

  /** Evaluate the rig at the current mover state and write every leaf + the debug bones. */
  private write() {
    const k = this.kin
    if (!k) return

    // Wave phase 0..1 across the one-shot (0 when not waving).
    const wave = k.waveT > 0 ? 1 - k.waveT / MOVE.waveDuration : 0
    const state: WalkState = {
      grounded: k.grounded,
      vx: k.vx,
      vy: k.vy,
      touchingWall: false,
      wallNx: 0,
      simTime: this.simTime,
      strideDistance: k.strideDistance,
      legMode: legModeAtom.get(),
      legs: this.legs ?? undefined,
      crouch: this.input.crouch && k.grounded,
      wave,
    }
    const pose = this.rig ? poseForState(state, WALK_DEFAULTS) : {}
    this.lastPose = pose
    const deltas = this.rig ? evaluateRig(this.rig, pose) : new Map<string, Mat2D>()

    this.editor.run(
      () => {
        for (const p of this.parts) writeRigPart(this.editor, p, k.x, k.y, deltas.get(p.id))
      },
      { history: 'ignore', ignoreShapeLock: true },
    )

    // Publish the live skeleton for the debug overlay (page space) when toggled on.
    if (this.rig && showRigDebugAtom.get()) {
      const worlds = evaluateBoneWorlds(this.rig, pose)
      rigDebugAtom.set({
        bones: worlds.map((b) => ({
          pivot: { x: b.pivot.x + k.x, y: b.pivot.y + k.y },
          tip: { x: b.tip.x + k.x, y: b.tip.y + k.y },
        })),
      })
    } else {
      rigDebugAtom.set(this.rig ? { bones: [] } : null)
    }
  }
}

/**
 * Write one leaf shape this frame: its rest record origin is `(px,py) + (offX,offY)` in
 * PAGE space; a rig `delta` (entity-local rigid transform) rotates/translates it about
 * the body origin. We compose the delta with the leaf's rest page origin, add the leaf's
 * rest rotation, and convert back into the leaf's own parent-local space (grouped
 * children store x/y group-locally). No delta ⇒ the plain rigid translation.
 *
 * Ported from the Engine demo's engine.ts writeRigPart.
 */
function writeRigPart(editor: Editor, part: BodyPart, px: number, py: number, delta: Mat2D | undefined) {
  if (!delta) {
    // Rigid whole-body (or a non-rig leaf): plain translation, no rotation change.
    const local = part.toLocal.applyToPoint({ x: px + part.offX, y: py + part.offY })
    editor.updateShape({ id: part.id, type: part.type, x: local.x, y: local.y } as TLShapePartial)
    return
  }
  // Leaf rest origin in entity-local → posed origin (still entity-local), then + the
  // body's page top-left → page, then page → parent-local. rotation adds D's rotation.
  const posed = compose(delta, fromTRS(part.offX, part.offY, 0))
  const local = part.toLocal.applyToPoint({ x: posed.tx + px, y: posed.ty + py })
  editor.updateShape({
    id: part.id,
    type: part.type,
    x: local.x,
    y: local.y,
    rotation: part.restRotation + Math.atan2(delta.b, delta.a),
  } as TLShapePartial)
}
