import {
	createBindingId,
	createShapeId,
	type Editor,
	type TLDefaultColorStyle,
	type TLDefaultSizeStyle,
	type TLShapeId,
} from 'tldraw'
import type { BoneShape } from '../shapes/boneShape'
import type { JointKey, JointPositions } from './jointMarkers'

/**
 * Build a `poser-bone` figure whose bone lengths, angles, and shoulder/hip widths
 * come from user-placed joint markers (Mixamo-style rigging). This is the
 * proportion-preserving counterpart to buildFigure's fixed template: rig a drawing
 * with short legs and you get short leg bones, because each bone spans exactly the
 * two joints the user dropped.
 *
 * Each bone is a (head joint → tail joint) pair. `parentBone` gives the bone-joint
 * binding chain (same topology as the default rig): child heads pin to parent tails
 * so posing propagates. `pelvis` is a tiny hub whose head/tail sit at the pelvis
 * marker; the clavicle/hip spreaders run from chest/pelvis out to the shoulder/hip
 * markers, so torso and hip WIDTH are just the marker spacing.
 */
interface BoneFromJoints {
	name: string
	head: JointKey
	tail: JointKey
	size: TLDefaultSizeStyle
	color: TLDefaultColorStyle
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

const SPINE: TLDefaultColorStyle = 'grey'
const LIMB: TLDefaultColorStyle = 'blue'
const HEAD_C: TLDefaultColorStyle = 'light-blue'
const CONNECT: TLDefaultColorStyle = 'grey'

// Bone list mirrors the default rig's names/topology so every downstream consumer
// (applyPose, getIkChains, attachDrawing) works unchanged — only the geometry now
// comes from the markers. The pelvis is a short hub from the pelvis marker toward
// the chest, giving the spine a stable pivot.
const BONES: BoneFromJoints[] = [
	// pelvis: the figure root — a near-zero-length hub AT the pelvis marker. The spine
	// and hips pin to its TAIL, so the hub is kept as short as the schema allows (1px)
	// and oriented toward the chest; that way the spine and legs start essentially
	// exactly on the pelvis marker with no visible overshoot. (A 12px hub used to shift
	// the whole trunk up ~12px, which read as a too-long torso / arms above the
	// shoulder markers.)
	{ name: 'pelvis', head: 'pelvis', tail: 'chest', size: 'l', color: SPINE, minLength: 1, maxLength: 1 },
	{ name: 'spine', head: 'pelvis', tail: 'chest', size: 'l', color: SPINE, parentBone: 'pelvis' },
	{ name: 'neck', head: 'chest', tail: 'neck', size: 'm', color: SPINE, parentBone: 'spine' },
	{ name: 'head', head: 'neck', tail: 'head', size: 'xl', color: HEAD_C, parentBone: 'neck' },

	// Clavicles hang from the CHEST (spine's tail), not the neck. The chest marker is
	// the shoulder line, so parenting to `spine` pins each clavicle's head to the chest
	// — otherwise it re-pins to the neck marker (up near the head) and drags the arms
	// above where the shoulder markers were placed.
	{ name: 'clavicle-l', head: 'chest', tail: 'shoulder-l', size: 's', color: CONNECT, parentBone: 'spine', minLength: 6 },
	{ name: 'clavicle-r', head: 'chest', tail: 'shoulder-r', size: 's', color: CONNECT, parentBone: 'spine', minLength: 6 },
	{ name: 'upper-arm-l', head: 'shoulder-l', tail: 'elbow-l', size: 'm', color: LIMB, parentBone: 'clavicle-l' },
	{ name: 'forearm-l', head: 'elbow-l', tail: 'wrist-l', size: 'm', color: LIMB, parentBone: 'upper-arm-l' },
	{ name: 'upper-arm-r', head: 'shoulder-r', tail: 'elbow-r', size: 'm', color: LIMB, parentBone: 'clavicle-r' },
	{ name: 'forearm-r', head: 'elbow-r', tail: 'wrist-r', size: 'm', color: LIMB, parentBone: 'upper-arm-r' },

	{ name: 'hip-l', head: 'pelvis', tail: 'hip-l', size: 'm', color: CONNECT, parentBone: 'pelvis', minLength: 6 },
	{ name: 'hip-r', head: 'pelvis', tail: 'hip-r', size: 'm', color: CONNECT, parentBone: 'pelvis', minLength: 6 },
	{ name: 'thigh-l', head: 'hip-l', tail: 'knee-l', size: 'm', color: LIMB, parentBone: 'hip-l' },
	{ name: 'shin-l', head: 'knee-l', tail: 'ankle-l', size: 'm', color: LIMB, parentBone: 'thigh-l' },
	{ name: 'thigh-r', head: 'hip-r', tail: 'knee-r', size: 'm', color: LIMB, parentBone: 'hip-r' },
	{ name: 'shin-r', head: 'knee-r', tail: 'ankle-r', size: 'm', color: LIMB, parentBone: 'thigh-r' },
]

/**
 * Build a fitted figure from placed joint positions (page coords). Returns the new
 * figure's id (the pelvis shape id), or null if the joints are missing.
 */
export function buildFigureFromJoints(editor: Editor, joints: JointPositions): TLShapeId | null {
	const ids = new Map<string, TLShapeId>()
	const figureId = createShapeId()

	editor.run(() => {
		for (const spec of BONES) {
			const head = joints[spec.head]
			const tail = joints[spec.tail]
			if (!head || !tail) continue

			const dx = tail.x - head.x
			const dy = tail.y - head.y
			const rawLen = Math.hypot(dx, dy)
			let length = Math.max(spec.minLength ?? 1, rawLen)
			if (spec.maxLength != null) length = Math.min(length, spec.maxLength)
			// Angle from head→tail; if the two markers coincide (rawLen≈0), fall back to
			// pointing up so the hub still has a defined orientation.
			const rotation = rawLen < 0.001 ? -Math.PI / 2 : Math.atan2(dy, dx)

			const id = spec.name === 'pelvis' ? figureId : createShapeId()
			ids.set(spec.name, id)

			editor.createShape<BoneShape>({
				id,
				type: 'poser-bone',
				x: head.x,
				y: head.y,
				rotation,
				meta: { figureId },
				props: {
					length,
					size: 's',
					color: spec.color,
					dash: 'dotted',
					fill: 'semi',
					name: spec.name,
				},
			})

			if (spec.parentBone) {
				const parentId = ids.get(spec.parentBone)
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
