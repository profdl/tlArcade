import { createBindingId, type Editor, type TLShapeId } from 'tldraw'
import { boneTailLocal, type BoneShape } from '../shapes/boneShape'
import { bonesByName } from '../rig/buildFigure'

/**
 * "Apply rig": bind every free-drawn shape near a figure to the nearest bone, so the
 * drawing rides the rig and poses with it.
 *
 * Flow (the chosen UX): the user drags the rig over their drawing, lines the bones
 * up with the limbs, then calls this. For each non-bone shape we find the bone whose
 * centerline (head→tail segment) passes closest to the shape's center, capture the
 * shape's rigid offset in that bone's local frame, and create a `bone-attachment`
 * binding. From then on the BoneAttachmentBindingUtil keeps the shape glued to that
 * bone through every pose.
 *
 * Returns the number of shapes attached.
 */
export function attachDrawing(editor: Editor, figure: TLShapeId): number {
	const boneIds = [...bonesByName(editor, figure).values()]
	if (boneIds.length === 0) return 0

	// Pre-resolve each bone's page-space segment (head→tail) + transform once.
	const bones = boneIds.map((id) => {
		const bone = editor.getShape(id) as BoneShape
		const t = editor.getShapePageTransform(id)
		return {
			id,
			transform: t,
			head: t.applyToPoint({ x: 0, y: 0 }),
			tail: t.applyToPoint(boneTailLocal(bone)),
		}
	})

	// Candidate shapes: everything on the page that isn't a bone and isn't already
	// attached. (A shape already riding a bone shouldn't be re-grabbed.)
	const attachedShapeIds = new Set<TLShapeId>()
	for (const b of editor.getBindingsInvolvingShape(figure)) {
		if (b.type === 'bone-attachment') attachedShapeIds.add(b.toId)
	}

	let count = 0
	editor.run(() => {
		for (const shape of editor.getCurrentPageShapes()) {
			if (shape.type === 'poser-bone') continue
			if (attachedShapeIds.has(shape.id)) continue

			const bounds = editor.getShapePageBounds(shape.id)
			if (!bounds) continue
			const center = { x: bounds.midX, y: bounds.midY }

			// Nearest bone by distance from the shape center to the bone's centerline.
			let best = bones[0]
			let bestDist = Infinity
			for (const b of bones) {
				const d = distToSegment(center, b.head, b.tail)
				if (d < bestDist) {
					bestDist = d
					best = b
				}
			}

			// Capture the shape origin in the bone's LOCAL frame (invert the bone's page
			// transform), plus the shape's rotation relative to the bone's.
			const shapePagePoint = editor.getShapePageTransform(shape.id).applyToPoint({ x: 0, y: 0 })
			const local = best.transform.clone().invert().applyToPoint(shapePagePoint)
			const rot = shape.rotation - best.transform.rotation()

			editor.createBinding({
				id: createBindingId(),
				type: 'bone-attachment',
				fromId: best.id, // the bone drives
				toId: shape.id, // the drawing rides
				props: { dx: local.x, dy: local.y, rot },
			})
			count++
		}
	})

	return count
}

/** Perpendicular distance from point `p` to the segment `a`–`b` (page space). */
function distToSegment(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
	const abx = b.x - a.x
	const aby = b.y - a.y
	const apx = p.x - a.x
	const apy = p.y - a.y
	const lenSq = abx * abx + aby * aby
	// t = clamped projection of ap onto ab, so we measure to the nearest point on the segment.
	const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / lenSq))
	const cx = a.x + t * abx
	const cy = a.y + t * aby
	return Math.hypot(p.x - cx, p.y - cy)
}
