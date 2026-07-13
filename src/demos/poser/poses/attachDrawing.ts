import { createBindingId, type Editor, type TLDrawShape, type TLShapeId } from 'tldraw'
import { boneTailLocal, type BoneShape } from '../shapes/boneShape'
import { bonesByName } from '../rig/buildFigure'
import { cutStrokeAtJoints, distToSegment, type ResolvedBone } from './cutStrokeAtJoints'

/**
 * "Apply rig": bind every free-drawn shape near a figure to the rig so the drawing
 * rides it and poses with it.
 *
 * Two behaviors by shape type:
 * - **Draw strokes** are CUT at the joints (cutStrokeAtJoints): a limb drawn as one
 *   line is split into per-bone pieces so it folds at the elbow/knee when posed.
 * - **Everything else** (geo, image, text…) is attached rigidly to the single
 *   nearest bone, keeping its shape and riding that bone.
 *
 * Flow (the chosen UX): drag the rig over the drawing, line the bones up, then call
 * this. Returns the number of pieces/shapes now attached.
 */
export function attachDrawing(editor: Editor, figure: TLShapeId): number {
	const boneIds = [...bonesByName(editor, figure).values()]
	if (boneIds.length === 0) return 0

	// Pre-resolve each bone's page-space centerline (head→tail) + transform once.
	const bones: ResolvedBone[] = boneIds.map((id) => {
		const bone = editor.getShape(id) as BoneShape
		const t = editor.getShapePageTransform(id)
		return {
			id,
			transform: t,
			head: t.applyToPoint({ x: 0, y: 0 }),
			tail: t.applyToPoint(boneTailLocal(bone)),
		}
	})

	// Shapes already riding this figure's bones shouldn't be re-grabbed. A
	// bone-attachment binds a single bone (fromId) to a drawing (toId), so we must
	// scan every bone of the figure — not the figure/pelvis id, which is just one
	// bone and would miss art attached to arms, legs, torso, etc.
	const attachedShapeIds = new Set<TLShapeId>()
	for (const boneId of boneIds) {
		for (const b of editor.getBindingsInvolvingShape(boneId)) {
			if (b.type === 'bone-attachment') attachedShapeIds.add(b.toId)
		}
	}

	// Snapshot the candidate list up front: cutStrokeAtJoints creates new draw shapes,
	// and we must not re-process those in the same pass.
	const candidates = editor
		.getCurrentPageShapes()
		.filter((s) => s.type !== 'poser-bone' && !attachedShapeIds.has(s.id))

	let count = 0
	editor.run(() => {
		for (const shape of candidates) {
			if (shape.type === 'draw') {
				const pieces = cutStrokeAtJoints(editor, shape as TLDrawShape, bones)
				if (pieces > 0) {
					count += pieces
					continue
				}
				// Fell through (unreadable stroke) → rigid-attach as a fallback.
			}
			if (rigidAttach(editor, shape.id, bones)) count++
		}
	})

	return count
}

/**
 * Rigidly attach one shape to its single nearest bone: capture the shape's origin in
 * that bone's local frame + its relative rotation, create a bone-attachment binding.
 * Returns true if attached.
 */
function rigidAttach(editor: Editor, shapeId: TLShapeId, bones: ResolvedBone[]): boolean {
	const bounds = editor.getShapePageBounds(shapeId)
	if (!bounds) return false
	const center = { x: bounds.midX, y: bounds.midY }

	let best = bones[0]
	let bestDist = Infinity
	for (const b of bones) {
		const d = distToSegment(center, b.head, b.tail)
		if (d < bestDist) {
			bestDist = d
			best = b
		}
	}

	const shape = editor.getShape(shapeId)
	if (!shape) return false
	const shapePagePoint = editor.getShapePageTransform(shapeId).applyToPoint({ x: 0, y: 0 })
	const local = best.transform.clone().invert().applyToPoint(shapePagePoint)
	const rot = shape.rotation - best.transform.rotation()

	editor.createBinding({
		id: createBindingId(),
		type: 'bone-attachment',
		fromId: best.id, // the bone drives
		toId: shapeId, // the drawing rides
		props: { dx: local.x, dy: local.y, rot },
	})
	return true
}
