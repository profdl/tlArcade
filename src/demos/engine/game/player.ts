/**
 * Engine — the composite player.
 *
 * "The player" can be a single shape OR a group of shapes (draw a stick figure,
 * select the strokes, hit "Set as Player" in the tray). Identity is a marker,
 * `meta.role === 'player'`, NOT color — a group has no color, and a figure
 * shouldn't have to be monochrome-blue. Color→role still identifies the simple
 * single-shape tray drops and pencil terrain (see roles.ts); the marker just wins
 * over color when present (see engine.ts → roleOf).
 *
 * `markAsPlayer` is an AUTHORING action (undoable, normal history). It groups the
 * selection (if >1) and stamps the marker, keeping exactly one player.
 *
 * `collectPlayerBody` runs at start(): it reads the player's page bounds (the
 * union of a group's children) and merges every leaf part's outline into one
 * page-space sample set — so the rigid figure collides by its real combined
 * perimeter. The sim then treats those samples exactly like a single shape's (it
 * never cared how many shapes produced them).
 *
 * It also returns the `parts` to DRIVE each frame — every writable LEAF shape.
 * We deliberately do NOT move the group container: a group's transform is DERIVED
 * from its children (see the tldraw docs — bounds/position update automatically as
 * children change), so writing the group's x/y is unreliable. Instead each leaf is
 * repositioned directly (exactly what already works for a single-shape player),
 * carrying the whole figure rigidly. Each part remembers its record origin's PAGE
 * position relative to the player bounds top-left at start; each frame the engine
 * targets (px,py)+that offset and converts back to the leaf's own parent space
 * (a grouped child stores x/y in group-local space, not page space).
 */
import { createShapeId, type Editor, type Mat, type TLShapeId, type TLShapePartial } from 'tldraw'
import { outlineSamples, type Bounds, type Pt } from './collision'

/** One leaf shape driven by the sim, with the data to reposition it each frame. */
export interface PlayerPart {
  id: TLShapeId
  type: string
  /** Record-origin PAGE offset from the player bounds top-left, captured at start. */
  offX: number
  offY: number
  /** page→parent-local transform, to write the leaf's x/y back in its own space. */
  toLocal: Mat
  /** Authored { x, y, opacity } for non-destructive restore on stop. */
  snap: { x: number; y: number; opacity: number }
}

/** The meta key + value that marks a shape (or group) as the player. */
export const PLAYER_ROLE = 'player'

/** True if a shape record carries the player marker in its meta. */
export function isPlayerMarked(shape: { meta?: Record<string, unknown> }): boolean {
  return shape.meta?.role === PLAYER_ROLE
}

/** Remove the player marker from whichever shape currently holds it (if any). */
function clearPlayerMarker(editor: Editor) {
  for (const s of editor.getCurrentPageShapes()) {
    if (!isPlayerMarked(s)) continue
    const meta = { ...s.meta }
    delete meta.role
    editor.updateShape({ id: s.id, type: s.type, meta } as TLShapePartial)
  }
}

/**
 * Assign the given shapes as the player. Groups them if more than one, then
 * stamps `meta.role = 'player'` on the group (or the lone shape). Clears any
 * previous player first, so there is exactly one. Authoring action → undoable.
 *
 * @returns the id of the shape/group now marked as the player, or null if the
 *   selection was empty.
 */
export function markAsPlayer(editor: Editor, ids: TLShapeId[]): TLShapeId | null {
  if (ids.length === 0) return null

  editor.markHistoryStoppingPoint('set as player')
  clearPlayerMarker(editor)

  let targetId: TLShapeId
  if (ids.length > 1) {
    // Pass an explicit groupId so we hold the id directly rather than reading it
    // back from the selection.
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
    meta: { ...shape.meta, role: PLAYER_ROLE },
  } as TLShapePartial)

  return targetId
}

/**
 * The rigid body of the player at start(): its page bounds (origin for the sim's
 * px/py), the merged page-space outline samples of all its parts, and the leaf
 * `parts` the engine repositions each frame.
 *
 * For a group, the leaves are the group's descendants (skipping any nested group
 * container, which has no drawable outline / position of its own). For a lone
 * shape, there's a single leaf — the pre-composite behavior.
 */
export function collectPlayerBody(
  editor: Editor,
  playerId: TLShapeId,
): { bounds: Bounds; samples: Pt[]; parts: PlayerPart[] } | null {
  const bounds = editor.getShapePageBounds(playerId)
  if (!bounds) return null

  const samples: Pt[] = []
  const parts: PlayerPart[] = []
  // getShapeAndDescendantIds includes the shape itself; for a lone shape that's
  // just [playerId]. Groups have no outline of their own, so leaves supply it.
  for (const id of editor.getShapeAndDescendantIds([playerId])) {
    const shape = editor.getShape(id)
    if (!shape || shape.type === 'group') continue

    const s = outlineSamples(editor, id)
    if (s) samples.push(...s)

    // Record origin in PAGE space (getShapePageTransform maps local→page; the
    // origin is local (0,0)), and the page→parent-local transform to write it
    // back. For a top-level shape the parent transform is identity, so this
    // reduces to the plain (x,y) offset the single-shape path already used.
    const pageOrigin = editor.getShapePageTransform(id).point()
    const toLocal = editor.getShapeParentTransform(id).clone().invert()
    parts.push({
      id,
      type: shape.type,
      offX: pageOrigin.x - bounds.minX,
      offY: pageOrigin.y - bounds.minY,
      toLocal,
      snap: { x: shape.x, y: shape.y, opacity: shape.opacity },
    })
  }

  if (samples.length === 0 || parts.length === 0) return null
  return { bounds, samples, parts }
}
