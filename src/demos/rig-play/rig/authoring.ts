/**
 * Engine — bone-authoring model (R1 redesign).
 *
 * PURE, editor-free helpers for building a rig by DRAWING BONES (the Spine/Rive/
 * DragonBones model), replacing the old "drop a joint marker at a selection's
 * center" approach — which pivoted limbs at their middle and couldn't express a
 * chain. Here:
 *
 *   - A bone is drawn PIVOT → TIP. The START point IS the pivot (a shoulder, a hip,
 *     the base of the neck), so a limb swings about its end, not its center.
 *   - Starting a bone near an existing bone's TIP snaps to it and makes it that
 *     bone's CHILD → real FK chains (shoulder → elbow → wrist).
 *   - Each drawn part-shape auto-attaches to the bone that runs through it.
 *
 * This module is the pure core (snap, attach, draft → Rig); the editor (RigEditor)
 * supplies the pointer interaction and renders the overlay. Coordinates here are
 * ENTITY-LOCAL (page minus the character's bounds top-left), matching the Rig data
 * model and the runtime (player.ts / evaluate.ts).
 */
import type { Bone, Rig, Slot, Attachment } from './types'

/** A point in entity-local space. */
export interface Vec2 {
  x: number
  y: number
}

/**
 * One bone as the user draws it: a directed segment from `pivot` to `tip`, in
 * entity-local space, plus its parent (set by tip-snap) and the part-shape ids
 * attached to it. This is the editable DRAFT; `bakeDraft` turns it into `Bone`s.
 */
export interface DraftBone {
  id: string
  /** Parent draft-bone id, or null for a root bone. */
  parentId: string | null
  /** Pivot (the joint the bone rotates about) — entity-local. */
  pivot: Vec2
  /** Tip (the far end; a child's pivot snaps here) — entity-local. */
  tip: Vec2
  /** Attached part-shape ids (leaves this bone drives). */
  leafIds: string[]
}

/** The whole draft rig the editor edits during Rig mode. */
export interface DraftRig {
  bones: DraftBone[]
}

/** Distance² between two points (avoid sqrt for comparisons). */
function dist2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return dx * dx + dy * dy
}

/**
 * If `start` is within `snapRadius` of any existing bone's TIP, return that bone's
 * id (the closest) so a new bone drawn from there becomes its child. Else null (a
 * new root, or a free-floating bone). Pure — the editor passes the current draft.
 */
export function snapParentForStart(draft: DraftRig, start: Vec2, snapRadius: number): string | null {
  let best: string | null = null
  let bestD = snapRadius * snapRadius
  for (const b of draft.bones) {
    const d = dist2(b.tip, start)
    if (d <= bestD) {
      bestD = d
      best = b.id
    }
  }
  return best
}

/**
 * The point a new bone should actually START from, given tip-snap: if it snaps to a
 * parent, the exact parent tip (so the chain is seamless); else the raw start.
 */
export function snappedStart(draft: DraftRig, start: Vec2, snapRadius: number): Vec2 {
  const parentId = snapParentForStart(draft, start, snapRadius)
  if (!parentId) return start
  const parent = draft.bones.find((b) => b.id === parentId)!
  return { ...parent.tip }
}

/**
 * Auto-attach: for a part whose geometric center is `center`, pick the bone whose
 * SEGMENT (pivot→tip) it lies nearest to (perpendicular distance to the segment).
 * Returns the bone id, or null if there are no bones. The editor calls this per
 * part after bones are drawn; the user can override the result.
 */
export function nearestBone(draft: DraftRig, center: Vec2): string | null {
  let best: string | null = null
  let bestD = Infinity
  for (const b of draft.bones) {
    const d = pointToSegment2(center, b.pivot, b.tip)
    if (d < bestD) {
      bestD = d
      best = b.id
    }
  }
  return best
}

/** Squared perpendicular distance from point `p` to segment `a`–`b`. */
function pointToSegment2(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const apx = p.x - a.x
  const apy = p.y - a.y
  const len2 = abx * abx + aby * aby
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / len2))
  const cx = a.x + t * abx
  const cy = a.y + t * aby
  const dx = p.x - cx
  const dy = p.y - cy
  return dx * dx + dy * dy
}

/**
 * Bake the editable draft into an immutable `Rig` (the play-mode data). Each draft
 * bone becomes a `Bone` whose:
 *   - PIVOT is its origin, stored relative to its PARENT'S pivot (so FK carries a
 *     child's origin when the parent rotates — see evaluate.ts). Roots are relative
 *     to the entity origin.
 *   - REST ROTATION is the pivot→tip angle (the bone's rest direction), stored as
 *     the LOCAL angle relative to the parent's rest direction (so a chain at rest
 *     composes to the drawn pose).
 *   - LENGTH is |pivot→tip| (descriptive; used by IK later).
 * Each attached leaf becomes a `rigid` slot on its bone.
 *
 * Returns null if the draft has no bones or no attached parts (no drivable rig).
 */
export function bakeDraft(draft: DraftRig): Rig | null {
  if (draft.bones.length === 0) return null

  const byId = new Map(draft.bones.map((b) => [b.id, b]))
  // World rest angle of each bone (pivot→tip direction in entity space).
  const worldAngle = new Map<string, number>()
  for (const b of draft.bones) {
    worldAngle.set(b.id, Math.atan2(b.tip.y - b.pivot.y, b.tip.x - b.pivot.x))
  }

  const bones: Bone[] = []
  const slots: Slot[] = []
  const skin: Record<string, Attachment> = {}
  let slotN = 0
  let rootId: string | null = null

  for (const b of draft.bones) {
    const parent = b.parentId ? byId.get(b.parentId) : null
    // Pivot relative to the parent's pivot (parent-origin-relative — evaluate.ts
    // composes parentWorld · local, so this rides the parent's rotation).
    const localX = parent ? b.pivot.x - parent.pivot.x : b.pivot.x
    const localY = parent ? b.pivot.y - parent.pivot.y : b.pivot.y
    // Rest angle relative to the parent's world rest angle → local rotation.
    const parentAngle = parent ? worldAngle.get(parent.id)! : 0
    const localRot = worldAngle.get(b.id)! - parentAngle
    const length = Math.hypot(b.tip.x - b.pivot.x, b.tip.y - b.pivot.y)

    bones.push({
      id: b.id,
      parentId: b.parentId,
      x: localX,
      y: localY,
      rotation: localRot,
      scaleX: 1,
      scaleY: 1,
      shearX: 0,
      shearY: 0,
      length,
      inherit: 'normal',
    })
    if (b.parentId === null && rootId === null) rootId = b.id

    for (const leafId of b.leafIds) {
      const slotId = `slot_${slotN++}`
      slots.push({ id: slotId, boneId: b.id, drawOrder: slotN, attachment: slotId })
      skin[slotId] = { kind: 'rigid', leafId }
    }
  }

  if (slots.length === 0) return null // bones but nothing attached → no drivable rig
  if (rootId === null) rootId = bones[0].id // no explicit root → first bone is root

  return {
    version: 1,
    root: rootId,
    bones,
    slots,
    skins: { default: skin },
    constraints: [],
    bindInverse: {},
  }
}
