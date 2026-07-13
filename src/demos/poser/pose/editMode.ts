import { atom, type Editor, type TLBindingId, type TLShapeId } from 'tldraw'
import { applyFrame } from '../poses/applyPose'
import { attachDrawing } from '../poses/attachDrawing'
import { bonesByName, REST_FRAME } from '../rig/buildFigure'
import { setFigureFlag } from './figureSet'
import { stopPlaying } from './posePlayer'

/**
 * Per-figure "edit the drawing" mode. A rigged figure's artwork is normally LOCKED —
 * each drawn piece rides a bone via a `bone-attachment` binding, and that binding's
 * lifecycle IS the lock (BoneAttachmentBindingUtil locks on create, unlocks on
 * delete). So there's no separate "unlock" to toggle: editing the art means removing
 * those attachments (art becomes normal, selectable draw shapes), letting the user
 * redraw, then re-running the same attach flow to re-cut and re-bind.
 *
 * The chosen UX (one unified edit mode; snap-to-rest on enter; reset-to-rest on exit):
 *  - ENTER: stop playback, snap the figure to the rig-template neutral pose (REST_FRAME)
 *    so the art is un-deformed, then delete this figure's bone-attachments → the pieces
 *    auto-unlock. Bones stay as normal shapes, so the user can also nudge joints.
 *  - EDIT: user draws / erases / edits strokes freely and may drag bones to fix joints.
 *  - EXIT: re-run attachDrawing → new whole-limb strokes get cut at the joints, every
 *    piece near the rig re-binds and auto-locks. The figure is left at rest; the user
 *    re-poses from there (reset-to-rest v1 — no pose is restored, so a changed skeleton
 *    can never mismatch a stale pose).
 *
 * State is a module-level atom keyed by figureId (mirrors posePlayer's `playingFigures`)
 * so the toolbar can read "is THIS figure being edited?" reactively and gate Play / the
 * pose picker while editing.
 */

/** Reactive set of figure ids currently in edit mode. Toolbar reads it via `useValue`. */
export const editingFigures = atom<ReadonlySet<TLShapeId>>('editingFigures', new Set())

/** True if `figure` is currently in edit mode. */
export function isEditing(figure: TLShapeId): boolean {
	return editingFigures.get().has(figure)
}

function markEditing(figure: TLShapeId, editing: boolean): void {
	setFigureFlag(editingFigures, figure, editing)
}

/**
 * Delete every `bone-attachment` binding that fastens artwork to any of this figure's
 * bones. Deleting each binding fires BoneAttachmentBindingUtil.onAfterDelete, which
 * unlocks the freed drawing — so after this the art is fully editable. Bone-JOINT
 * bindings (bone↔bone) are left intact so the skeleton stays assembled.
 */
function detachArtwork(editor: Editor, figure: TLShapeId): void {
	const boneIds = [...bonesByName(editor, figure).values()]
	const attachmentIds = new Set<TLBindingId>()
	for (const boneId of boneIds) {
		for (const b of editor.getBindingsInvolvingShape(boneId)) {
			if (b.type === 'bone-attachment') attachmentIds.add(b.id)
		}
	}
	if (attachmentIds.size === 0) return
	// history:'ignore' + ignoreShapeLock:true to match the attachment binding's own
	// lock/unlock writes (BoneAttachmentBindingUtil): deleting a binding fires its
	// onAfterDelete, which UNLOCKS the freed art — a rig-internal lock-state mutation
	// that's a consequence of the binding being gone, not a standalone undoable edit.
	// Without this, entering edit mode pushes an undo entry that re-locks/re-binds art
	// the user didn't author.
	editor.run(
		() => {
			for (const id of attachmentIds) editor.deleteBinding(id)
		},
		{ history: 'ignore', ignoreShapeLock: true }
	)
}

/**
 * Enter edit mode for a figure: stop any playback, snap to the neutral rest pose, then
 * release the artwork so it's directly editable. No-op if already editing.
 */
export function enterEdit(editor: Editor, figure: TLShapeId): void {
	if (isEditing(figure)) return
	stopPlaying(figure)
	// Snap to rest BEFORE detaching, while the attachments still exist — the bindings
	// carry the art from the posed frame back to neutral as the bones return to their
	// template angles. Detaching first would strand the art in its posed position.
	applyFrame(editor, figure, REST_FRAME)
	detachArtwork(editor, figure)
	markEditing(figure, true)
}

/**
 * Exit edit mode: re-attach the (possibly edited / newly drawn) artwork to the rig via
 * the normal attach flow, which re-cuts whole-limb strokes at the joints and re-locks
 * every bound piece. The figure is already at rest, so it stays there. No-op if not
 * editing.
 */
export function exitEdit(editor: Editor, figure: TLShapeId): void {
	if (!isEditing(figure)) return
	attachDrawing(editor, figure)
	markEditing(figure, false)
}

/** Enter if not editing, exit if editing. What the toolbar's Edit/Done button calls. */
export function toggleEdit(editor: Editor, figure: TLShapeId): void {
	if (isEditing(figure)) exitEdit(editor, figure)
	else enterEdit(editor, figure)
}
