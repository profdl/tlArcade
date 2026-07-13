import { createBindingId, createShapeId, type Editor, type TLShapeId } from 'tldraw'
import type { BoneShape } from '../shapes/boneShape'
import { HUMANOID_BONES, sharedBoneProps } from './humanoidTemplate'
import type { JointKey, JointPositions } from './jointMarkers'

/**
 * Build a `poser-bone` figure whose bone lengths, angles, and shoulder/hip widths
 * come from user-placed joint markers (Mixamo-style rigging). This is the
 * proportion-preserving counterpart to buildFigure's fixed template: rig a drawing
 * with short legs and you get short leg bones, because each bone spans exactly the
 * two joints the user dropped.
 *
 * Topology, names, size, and color come from HUMANOID_BONES (humanoidTemplate.ts) —
 * the same set the default rig uses, so every downstream consumer (applyPose,
 * getIkChains, attachDrawing) works unchanged. This table adds only the per-bone
 * GEOMETRY SOURCE: which two joint markers each bone spans (head→tail), plus optional
 * length limits. `parentBone` still drives the bone-joint binding chain.
 */
interface BoneGeometryFromJoints {
	head: JointKey
	tail: JointKey
	/** Which template bone this bone pins to; child heads pin to parent tails. */
	parentBone?: string
	/** Minimum length (px) so a degenerate marker pair still yields a valid bone. */
	minLength?: number
	/**
	 * Cap the bone's length to this many px regardless of marker distance. Used only
	 * for the pelvis hub, which must stay a TINY stub at the pelvis joint (like the
	 * default rig) even though it's oriented toward the chest — otherwise the spine,
	 * which pins to the pelvis's tail, would start at the chest and double the torso.
	 */
	maxLength?: number
}

// Per-bone geometry source, keyed by the HUMANOID_BONES name. Every posable/structural
// bone maps to the two markers it spans. Notes on the tricky ones:
//   pelvis — a near-zero-length hub AT the pelvis marker (spine + hips pin to its TAIL,
//     so it's clamped to 1px toward the chest; a longer hub shifts the whole trunk up).
//   clavicles — parented to `spine` (not neck) so their heads pin to the CHEST marker
//     (the shoulder line), keeping the arms at the shoulder markers, not up by the head.
const GEOMETRY: Record<string, BoneGeometryFromJoints> = {
	pelvis: { head: 'pelvis', tail: 'chest', minLength: 1, maxLength: 1 },
	spine: { head: 'pelvis', tail: 'chest', parentBone: 'pelvis' },
	neck: { head: 'chest', tail: 'neck', parentBone: 'spine' },
	head: { head: 'neck', tail: 'head', parentBone: 'neck' },
	'clavicle-l': { head: 'chest', tail: 'shoulder-l', parentBone: 'spine', minLength: 6 },
	'clavicle-r': { head: 'chest', tail: 'shoulder-r', parentBone: 'spine', minLength: 6 },
	'upper-arm-l': { head: 'shoulder-l', tail: 'elbow-l', parentBone: 'clavicle-l' },
	'forearm-l': { head: 'elbow-l', tail: 'wrist-l', parentBone: 'upper-arm-l' },
	'upper-arm-r': { head: 'shoulder-r', tail: 'elbow-r', parentBone: 'clavicle-r' },
	'forearm-r': { head: 'elbow-r', tail: 'wrist-r', parentBone: 'upper-arm-r' },
	'hip-l': { head: 'pelvis', tail: 'hip-l', parentBone: 'pelvis', minLength: 6 },
	'hip-r': { head: 'pelvis', tail: 'hip-r', parentBone: 'pelvis', minLength: 6 },
	'thigh-l': { head: 'hip-l', tail: 'knee-l', parentBone: 'hip-l' },
	'shin-l': { head: 'knee-l', tail: 'ankle-l', parentBone: 'thigh-l' },
	'thigh-r': { head: 'hip-r', tail: 'knee-r', parentBone: 'hip-r' },
	'shin-r': { head: 'knee-r', tail: 'ankle-r', parentBone: 'thigh-r' },
}

/**
 * Build a fitted figure from placed joint positions (page coords). Returns the new
 * figure's id (the pelvis shape id), or null if the joints are missing.
 */
export function buildFigureFromJoints(editor: Editor, joints: JointPositions): TLShapeId | null {
	const ids = new Map<string, TLShapeId>()
	const figureId = createShapeId()

	editor.run(() => {
		for (const bone of HUMANOID_BONES) {
			const geom = GEOMETRY[bone.name]
			if (!geom) continue // template bone with no geometry source — skip

			const head = joints[geom.head]
			const tail = joints[geom.tail]
			if (!head || !tail) continue

			const dx = tail.x - head.x
			const dy = tail.y - head.y
			const rawLen = Math.hypot(dx, dy)
			let length = Math.max(geom.minLength ?? 1, rawLen)
			if (geom.maxLength != null) length = Math.min(length, geom.maxLength)
			// Angle from head→tail; if the two markers coincide (rawLen≈0), fall back to
			// pointing up so the hub still has a defined orientation.
			const rotation = rawLen < 0.001 ? -Math.PI / 2 : Math.atan2(dy, dx)

			const id = bone.name === 'pelvis' ? figureId : createShapeId()
			ids.set(bone.name, id)

			editor.createShape<BoneShape>({
				id,
				type: 'poser-bone',
				x: head.x,
				y: head.y,
				rotation,
				meta: { figureId },
				// name/size/color come from the shared template; length from the markers.
				props: sharedBoneProps(bone.color, length, bone.name),
			})

			// The joint-fitted rig re-parents a few bones vs. the default template (e.g.
			// clavicles pin to `spine`/chest here, not `neck`), so the binding parent comes
			// from the GEOMETRY source, not HUMANOID_BONES.parent.
			if (geom.parentBone) {
				const parentId = ids.get(geom.parentBone)
				if (parentId) {
					editor.createBinding({
						id: createBindingId(),
						type: 'bone-joint',
						fromId: parentId,
						toId: id,
						props: {},
					})
				}
			}
		}
	})

	return ids.get('pelvis') ?? null
}
