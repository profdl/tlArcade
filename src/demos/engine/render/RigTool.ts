/**
 * Engine — RigTool (R1 redesign): draw bones as a native tldraw tool.
 *
 * A custom StateNode (tldraw's "Custom tool" example) so bone-drawing OWNS the
 * pointer while active — no fighting the select tool, and Escape-to-exit / cursor
 * for free (the native-UI decision, PLAN §7.5 / tldraw-v5-native-ui skill).
 *
 * Interaction: pointer DOWN sets a bone's PIVOT (snapped to a nearby existing tip →
 * the new bone becomes that bone's child); drag; pointer UP sets the TIP and commits
 * the bone to the draft. A click with no drag (pivot ≈ tip) is ignored. All draft
 * coords are ENTITY-LOCAL (page minus the rig target's bounds top-left), matching
 * the Rig data model. The RigOverlay renders the draft + the in-progress bone.
 */
import { StateNode, Vec } from 'tldraw'
import { snapParentForStart, snappedStart, type Vec2 } from '../game/rig/authoring'
import { boneCounterAtom, draftRigAtom, dragBoneAtom, rigTargetAtom } from '../game/rig/state'

/** Tip-snap radius in PAGE px (screen-independent; good enough at normal zoom). */
const SNAP_RADIUS = 18
/** Below this pivot→tip length (page px) a drag is treated as a stray click. */
const MIN_BONE_LEN = 12

export class RigTool extends StateNode {
  // A simple id (no dot) — setCurrentTool treats a dotted id as a state PATH
  // ('engine' → 'rig'), so a root tool must have an unqualified id.
  static override id = 'rig'

  private down = false

  override onEnter() {
    this.editor.setCursor({ type: 'cross', rotation: 0 })
  }

  override onExit() {
    dragBoneAtom.set(null)
  }

  override onPointerDown() {
    this.down = true
  }

  // Live rubber-band: publish the in-progress bone so RigOverlay draws it.
  override onPointerMove() {
    if (!this.down) return
    const origin = this.targetOrigin()
    if (!origin) return
    const draft = draftRigAtom.get()
    const rawStart = this.localPoint(this.editor.inputs.getOriginPagePoint(), origin)
    const pivot = snappedStart(draft, rawStart, SNAP_RADIUS)
    const tip = this.localPoint(this.editor.inputs.getCurrentPagePoint(), origin)
    dragBoneAtom.set({ pivot, tip })
  }

  override onPointerUp() {
    if (!this.down) return
    this.down = false
    dragBoneAtom.set(null)

    const origin = this.targetOrigin()
    if (!origin) return
    const downPage = this.editor.inputs.getOriginPagePoint()
    const upPage = this.editor.inputs.getCurrentPagePoint()
    if (Vec.Dist(downPage, upPage) < MIN_BONE_LEN) return // a click, not a bone

    const rawStart = this.localPoint(downPage, origin)
    const tip = this.localPoint(upPage, origin)
    const draft = draftRigAtom.get()
    const parentId = snapParentForStart(draft, rawStart, SNAP_RADIUS)
    const pivot = snappedStart(draft, rawStart, SNAP_RADIUS)

    const n = boneCounterAtom.get()
    boneCounterAtom.set(n + 1)
    draftRigAtom.set({
      bones: [...draft.bones, { id: `bone_${n}`, parentId, pivot, tip, leafIds: [] }],
    })
  }

  override onCancel() {
    this.down = false
    dragBoneAtom.set(null)
    this.editor.setCurrentTool('select')
  }

  /** Page point → entity-local (relative to the rig target's bounds top-left). */
  private localPoint(p: { x: number; y: number }, origin: Vec): Vec2 {
    return { x: p.x - origin.x, y: p.y - origin.y }
  }

  /** Entity-local origin = the rig target's page bounds top-left. */
  private targetOrigin(): Vec | null {
    const id = rigTargetAtom.get()
    if (!id) return null
    const b = this.editor.getShapePageBounds(id)
    return b ? new Vec(b.minX, b.minY) : null
  }
}
