/**
 * rig-play — the composite character body.
 *
 * A rig-play "character" is a GROUP of native tldraw shapes (draw a figure, select
 * the strokes, mark it). Identity is a marker, `meta.role === 'character'`, NOT a
 * color — a group has no color, and a figure shouldn't have to be monochrome. The
 * rig itself (bones) lives in the group's `meta.rig` (see rig/types.ts).
 *
 * Trimmed from the Engine demo's player.ts: this demo has NO physics/collision, so
 * `collectRigBody` gathers only what the rig evaluator + writer need each frame —
 * every writable LEAF shape with its record-origin PAGE offset from the body's
 * bounds top-left, its page→parent-local transform, and its rest rotation. There is
 * no outline sampling (the character never collides with anything).
 *
 * As in Engine, we deliberately do NOT move the group container: a group's transform
 * is DERIVED from its children, so writing the group's x/y is unreliable. Instead each
 * leaf is repositioned directly, carrying the whole figure. Each part remembers its
 * record origin's PAGE position relative to the body bounds top-left at start; each
 * frame the runtime targets (px,py)+that offset, applies the rig delta, and converts
 * back to the leaf's own parent space (a grouped child stores x/y in group-local space).
 */
import { createShapeId, type Editor, type Mat, type TLShapeId, type TLShapePartial } from 'tldraw'

/** One leaf shape driven by the runtime, with the data to reposition it each frame. */
export interface BodyPart {
  id: TLShapeId
  type: string
  /** Record-origin PAGE offset from the body bounds top-left, captured at start. */
  offX: number
  offY: number
  /** page→parent-local transform, to write the leaf's x/y back in its own space. */
  toLocal: Mat
  /** The leaf's PAGE rotation (radians) at start — the rig delta rotation adds to it. */
  restRotation: number
  /**
   * Authored { x, y, rotation, opacity } for non-destructive restore on stop. Includes
   * `rotation` because a RIGGED leaf gets its record rotation overwritten every frame by
   * writeRigPart; without restoring it, stop() leaves the leaf at its last POSED rotation,
   * and the next start() bakes the rig from that broken rest → the skeleton breaks.
   */
  snap: { x: number; y: number; rotation: number; opacity: number }
}

/** The meta key + value that marks a shape (or group) as a rig-play character. */
export const CHARACTER_ROLE = 'character'

/** True if a shape record carries the character marker in its meta. */
export function isCharacterMarked(shape: { meta?: Record<string, unknown> }): boolean {
  return shape.meta?.role === CHARACTER_ROLE
}

/** Remove the character marker from whichever shape currently holds it (if any). */
function clearCharacterMarker(editor: Editor) {
  for (const s of editor.getCurrentPageShapes()) {
    if (!isCharacterMarked(s)) continue
    const meta = { ...s.meta }
    delete meta.role
    editor.updateShape({ id: s.id, type: s.type, meta } as TLShapePartial)
  }
}

/**
 * Mark the given shapes as THE character. Groups them if more than one, then stamps
 * `meta.role = 'character'`. Clears any previous character first, so there is exactly
 * one. Authoring action → undoable.
 *
 * @returns the id of the shape/group now marked, or null if the selection was empty.
 */
export function markAsCharacter(editor: Editor, ids: TLShapeId[]): TLShapeId | null {
  if (ids.length === 0) return null

  editor.markHistoryStoppingPoint('set as character')
  clearCharacterMarker(editor)

  let targetId: TLShapeId
  if (ids.length > 1) {
    targetId = createShapeId()
    editor.groupShapes(ids, { groupId: targetId })
  } else {
    targetId = ids[0]
  }

  const shape = editor.getShape(targetId)
  if (!shape) return null
  editor.updateShape({
    id: targetId,
    type: shape.type,
    meta: { ...shape.meta, role: CHARACTER_ROLE },
  } as TLShapePartial)

  return targetId
}

/**
 * The rig body at start(): the character's page bounds (origin for the runtime's
 * px/py) and the leaf `parts` the runtime repositions each frame.
 *
 * For a group, the leaves are the group's descendants (skipping any nested group
 * container, which has no drawable outline / position of its own). For a lone shape,
 * there's a single leaf.
 */
export function collectRigBody(
  editor: Editor,
  characterId: TLShapeId,
): { bounds: { minX: number; minY: number; w: number; h: number }; parts: BodyPart[] } | null {
  const b = editor.getShapePageBounds(characterId)
  if (!b) return null

  const parts: BodyPart[] = []
  for (const id of editor.getShapeAndDescendantIds([characterId])) {
    const shape = editor.getShape(id)
    if (!shape || shape.type === 'group') continue

    // Record origin in PAGE space (getShapePageTransform maps local→page; the origin
    // is local (0,0)), and the page→parent-local transform to write it back. For a
    // top-level shape the parent transform is identity, so this reduces to the plain
    // (x,y) offset a single-shape body would use.
    const pageTransform = editor.getShapePageTransform(id)
    const pageOrigin = pageTransform.point()
    const toLocal = editor.getShapeParentTransform(id).clone().invert()
    parts.push({
      id,
      type: shape.type,
      offX: pageOrigin.x - b.minX,
      offY: pageOrigin.y - b.minY,
      toLocal,
      restRotation: pageTransform.rotation(),
      snap: { x: shape.x, y: shape.y, rotation: shape.rotation, opacity: shape.opacity },
    })
  }

  if (parts.length === 0) return null
  return { bounds: { minX: b.minX, minY: b.minY, w: b.w, h: b.h }, parts }
}
