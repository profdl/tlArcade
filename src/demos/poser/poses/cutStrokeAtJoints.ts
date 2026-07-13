import { b64Vecs } from '@tldraw/tlschema'
import { createBindingId, createShapeId, type Editor, type TLDrawShape, type TLShapeId, type VecModel } from 'tldraw'

/** A bone resolved to its page-space centerline + transform (see attachDrawing). */
export interface ResolvedBone {
	id: TLShapeId
	transform: ReturnType<Editor['getShapePageTransform']>
	head: { x: number; y: number }
	tail: { x: number; y: number }
}

/**
 * Cut a single draw stroke into per-bone pieces so a limb drawn as ONE line bends at
 * the joints. Without this, a whole-arm stroke binds rigidly to one bone and stays
 * straight when the elbow bends.
 *
 * How: decode the stroke's points to page space, label each by its nearest bone
 * (centerline distance), and split the point sequence wherever that label changes.
 * Each run becomes a new draw shape attached to its bone (bone-attachment), so the
 * originally-single line is now a hinged polyline that folds as the rig poses. The
 * original stroke is deleted.
 *
 * Runs shorter than 2 points are folded into their neighbor so we never emit a
 * degenerate one-point stroke. Returns the number of pieces created (0 if the shape
 * couldn't be read as a stroke, so the caller can fall back to a rigid attach).
 */
export function cutStrokeAtJoints(editor: Editor, shape: TLDrawShape, bones: ResolvedBone[]): number {
	const pagePoints = strokePagePoints(editor, shape)
	if (pagePoints.length < 2 || bones.length === 0) return 0

	// Label each point by nearest bone index.
	const labels = pagePoints.map((p) => nearestBoneIndex(p, bones))

	// Group consecutive same-label points into runs. To avoid a fold at the very seam
	// leaving orphan single points, we carry a run until the label changes.
	const runs: { boneIdx: number; pts: { x: number; y: number }[] }[] = []
	for (let i = 0; i < pagePoints.length; i++) {
		const last = runs[runs.length - 1]
		if (last && last.boneIdx === labels[i]) {
			last.pts.push(pagePoints[i])
		} else {
			// Bridge the cut: start the new run with the boundary point too, so adjacent
			// pieces visually meet at the joint instead of leaving a gap.
			const seed = last ? [last.pts[last.pts.length - 1], pagePoints[i]] : [pagePoints[i]]
			runs.push({ boneIdx: labels[i], pts: seed })
		}
	}

	// Merge any sub-2-point run into its previous neighbor (degenerate guard).
	const merged = runs.filter((r) => r.pts.length >= 2)
	if (merged.length === 0) return 0

	let made = 0
	for (const run of merged) {
		const bone = bones[run.boneIdx]
		// New stroke origin = the run's first page point; its points become local deltas.
		const origin = run.pts[0]
		const localPts: VecModel[] = run.pts.map((p) => ({ x: p.x - origin.x, y: p.y - origin.y, z: 0.5 }))

		const id = createShapeId()
		editor.createShape<TLDrawShape>({
			id,
			type: 'draw',
			x: origin.x,
			y: origin.y,
			props: {
				...shape.props,
				segments: [{ type: 'free', path: b64Vecs.encodePoints(localPts) }],
			},
		})

		// Attach this piece to its bone at the piece's captured local offset.
		const local = bone.transform.clone().invert().applyToPoint(origin)
		editor.createBinding({
			id: createBindingId(),
			type: 'bone-attachment',
			fromId: bone.id,
			toId: id,
			props: { dx: local.x, dy: local.y, rot: -bone.transform.rotation() },
		})
		made++
	}

	// Replace the original single stroke with its cut pieces.
	editor.deleteShape(shape.id)
	return made
}

/** All of a draw shape's points in PAGE space (decoded across every segment). */
function strokePagePoints(editor: Editor, shape: TLDrawShape): { x: number; y: number }[] {
	const t = editor.getShapePageTransform(shape.id)
	const out: { x: number; y: number }[] = []
	for (const seg of shape.props.segments) {
		const pts = b64Vecs.decodePoints(seg.path, seg.dim ?? 3)
		for (const p of pts) out.push(t.applyToPoint({ x: p.x, y: p.y }))
	}
	return out
}

function nearestBoneIndex(p: { x: number; y: number }, bones: ResolvedBone[]): number {
	let best = 0
	let bestDist = Infinity
	for (let i = 0; i < bones.length; i++) {
		const d = distToSegment(p, bones[i].head, bones[i].tail)
		if (d < bestDist) {
			bestDist = d
			best = i
		}
	}
	return best
}

/** Perpendicular distance from point `p` to the segment `a`–`b` (page space). */
export function distToSegment(
	p: { x: number; y: number },
	a: { x: number; y: number },
	b: { x: number; y: number }
): number {
	const abx = b.x - a.x
	const aby = b.y - a.y
	const apx = p.x - a.x
	const apy = p.y - a.y
	const lenSq = abx * abx + aby * aby
	const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / lenSq))
	const cx = a.x + t * abx
	const cy = a.y + t * aby
	return Math.hypot(p.x - cx, p.y - cy)
}
