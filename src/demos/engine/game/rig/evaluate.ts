/**
 * Engine — the rig evaluator (R1, Tier A rigid; PLAN §3.4).
 *
 * PURE and editor-free (no tldraw import) — unit-tested like physics.ts. Given an
 * immutable `Rig` and a live `Pose` (per-bone local overrides), it runs the Tier-A
 * slice of the §3.4 pipeline:
 *
 *   1. FK: walk the bone tree in dependency order → each bone's WORLD transform,
 *      for BOTH the rest pose and the live pose. (Constraints/IK are R3 — skipped.)
 *   2. Rigid deform: for each `rigid` slot, the delta that carries its leaf from
 *      rest to posed is  D = W_pose[bone] · W_rest[bone]⁻¹  — a rigid-body transform
 *      about the character's local origin. The runtime applies D to the leaf's rest
 *      geometry (entity-local), then adds the entity's live (x,y) — same convention
 *      as playerSamples. No pose, or a bone at rest, yields D = identity, so an
 *      unrigged / rest-pose player is byte-identical to today's rigid whole body.
 *
 * The output is keyed by LEAF SHAPE ID (the `rigid` attachment's leafId), because
 * that is what the runtime writes (engine.ts writeEntities). The evaluator never
 * touches the editor; the runtime maps leafId → its part and composes D with the
 * base translation.
 */
import { compose, fromTRS, invert, IDENTITY, type Mat2D } from './mat2d'
import type { Bone, Rig } from './types'

/**
 * A live pose: per-bone LOCAL overrides layered on the rest pose. Only the bones an
 * animation touches appear; absent bones stay at rest. All fields optional — a
 * `{ rotation }`-only entry is the common "swing this limb" case (what R1's editor
 * and the boneAttachment spike produce). Deltas are ADDED to the rest local (so an
 * identity/empty pose = rest).
 */
export interface BonePose {
  rotation?: number
  x?: number
  y?: number
  scaleX?: number
  scaleY?: number
  shearX?: number
  shearY?: number
}

export type Pose = Record<string, BonePose>

/** The local rest transform of a bone as a matrix. */
function restLocal(b: Bone): Mat2D {
  return fromTRS(b.x, b.y, b.rotation, b.scaleX, b.scaleY, b.shearX, b.shearY)
}

/** The local transform of a bone with a pose layered on (deltas added to rest). */
function posedLocal(b: Bone, pose: Pose): Mat2D {
  const p = pose[b.id]
  if (!p) return restLocal(b)
  return fromTRS(
    b.x + (p.x ?? 0),
    b.y + (p.y ?? 0),
    b.rotation + (p.rotation ?? 0),
    b.scaleX * (p.scaleX ?? 1),
    b.scaleY * (p.scaleY ?? 1),
    b.shearX + (p.shearX ?? 0),
    b.shearY + (p.shearY ?? 0),
  )
}

/**
 * FK: each bone's WORLD transform = parentWorld · local. The bone's `x,y` is its
 * pivot relative to the parent's pivot, so composing with the parent's world places
 * the child's pivot correctly AND carries it around the parent's pivot when the
 * parent rotates (the FK chain). `length` isn't read here (it's descriptive / for
 * IK). Bones are resolved parents-before-children (iteratively, below).
 *
 * `local(bone)` picks rest or posed. Returns a map boneId → world matrix.
 */
function forwardKinematics(rig: Rig, local: (b: Bone) => Mat2D): Map<string, Mat2D> {
  const byId = new Map(rig.bones.map((b) => [b.id, b]))
  const world = new Map<string, Mat2D>()

  // Dependency order: a bone can be computed once its parent's world exists. Rig
  // bones are authored root-first, but don't rely on it — resolve iteratively.
  const pending = [...rig.bones]
  let guard = pending.length * pending.length + 1
  while (pending.length && guard-- > 0) {
    const b = pending.shift()!
    if (b.parentId === null) {
      world.set(b.id, local(b))
      continue
    }
    const parentWorld = world.get(b.parentId)
    if (!parentWorld) {
      // Parent not resolved yet (or missing). If the parent exists, requeue; if it
      // doesn't, treat this bone as a root so a malformed rig still evaluates.
      if (byId.has(b.parentId)) {
        pending.push(b)
        continue
      }
      world.set(b.id, local(b))
      continue
    }
    world.set(b.id, compose(parentWorld, local(b)))
  }
  return world
}

/**
 * Evaluate the rig at `pose` → a map of LEAF SHAPE ID → the rigid delta transform
 * to apply to that leaf's rest geometry (entity-local). An empty pose (or a pose
 * that leaves every attached bone at rest) yields identity deltas.
 *
 * Only `rigid` attachments are produced (Tier A); `skinnedPath` (R6) is ignored.
 */
export function evaluateRig(rig: Rig, pose: Pose = {}): Map<string, Mat2D> {
  const restWorld = forwardKinematics(rig, restLocal)
  const poseWorld = forwardKinematics(rig, (b) => posedLocal(b, pose))

  const deltas = new Map<string, Mat2D>()
  const skin = rig.skins.default ?? Object.values(rig.skins)[0] ?? {}

  for (const slot of rig.slots) {
    const attachment = skin[slot.id]
    if (!attachment || attachment.kind !== 'rigid') continue

    const wRest = restWorld.get(slot.boneId)
    const wPose = poseWorld.get(slot.boneId)
    if (!wRest || !wPose) {
      deltas.set(attachment.leafId, { ...IDENTITY })
      continue
    }
    // D = W_pose · W_rest⁻¹ — the rigid body transform from rest to posed.
    deltas.set(attachment.leafId, compose(wPose, invert(wRest)))
  }
  return deltas
}
