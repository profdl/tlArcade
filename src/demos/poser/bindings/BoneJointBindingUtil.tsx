import { BindingUtil, type BindingOnShapeChangeOptions, type TLShapePartial } from 'tldraw'
import { isSuppressed, withSuppressed } from '../pose/bindingSuppression'
import { boneTailLocal, type BoneShape } from '../shapes/boneShape'
import { boneJointBindingProps, type BoneJointBinding } from './boneJointBinding'

/**
 * Keeps a child bone attached to its parent so the figure can be *posed*.
 *
 * Two directions, both routed through the parent's tail (the shared joint):
 *
 * - **Parent moved** (`onAfterChangeFromShape`): the joint moved, so slide the
 *   child's head back onto the parent's tail, keeping the child's own rotation.
 *   This is how a pose cascades down the chain — moving the upper arm drags the
 *   forearm along, which drags the hand, etc.
 *
 * - **Child moved by the user** (`onAfterChangeToShape`): the user grabbed this
 *   bone and dragged it. Instead of letting it translate off the body, we treat
 *   the drag as a *pose*: pin the head back to the joint and rotate the bone so
 *   it points from the joint toward wherever the user dragged its far end. The
 *   bone swings around its joint like a real limb, and its own children follow.
 *
 * The tricky part is telling "the user moved it" from "I just moved it" — our
 * own reposition writes (and the IK solver's) re-enter these handlers. We guard
 * with a shared in-flight set (pose/bindingSuppression), so both the binding's
 * self-writes and the IK solver's rotation writes are ignored here.
 */
export class BoneJointBindingUtil extends BindingUtil<BoneJointBinding> {
	static override type = 'bone-joint' as const
	static override props = boneJointBindingProps

	override getDefaultProps() {
		return {}
	}

	override onAfterCreate({ binding }: { binding: BoneJointBinding }) {
		this.pinToJoint(binding)
	}

	override onAfterChangeFromShape({ binding }: BindingOnShapeChangeOptions<BoneJointBinding>) {
		// The joint (parent tail) moved — slide the child's head back onto it, rotation unchanged.
		this.pinToJoint(binding)
	}

	override onAfterChangeToShape({ binding, shapeAfter }: BindingOnShapeChangeOptions<BoneJointBinding>) {
		// Ignore the echo from our own pin/pose writes and the IK solver's writes.
		if (isSuppressed(binding.toId)) return

		const parent = this.editor.getShape(binding.fromId) as BoneShape | undefined
		const child = shapeAfter as BoneShape
		if (!parent || parent.type !== 'poser-bone' || child.type !== 'poser-bone') return

		// The user dragged the bone somewhere. Its far end (tail) after the drag is the target the
		// bone should now aim at; the joint (parent's tail) is the fixed pivot it must stay pinned to.
		const jointPage = this.tailPage(parent)
		const draggedTailPage = this.tailPage(child)

		// Angle from the joint toward where the user pulled the far end. atan2 measures from +x,
		// and a bone's body runs along its local +x from head→tail, so this is exactly the
		// page-space rotation that makes head sit at the joint and tail point at the drag target.
		const targetRotation = Math.atan2(draggedTailPage.y - jointPage.y, draggedTailPage.x - jointPage.x)

		this.applyPose(child, jointPage, targetRotation)
	}

	/** Slide the child's head onto the parent's tail; keep the child's current rotation. */
	private pinToJoint(binding: BoneJointBinding) {
		const parent = this.editor.getShape(binding.fromId) as BoneShape | undefined
		const child = this.editor.getShape(binding.toId) as BoneShape | undefined
		if (!parent || !child || parent.type !== 'poser-bone' || child.type !== 'poser-bone') return
		this.applyPose(child, this.tailPage(parent), child.rotation)
	}

	/**
	 * Places `child` so its head sits at `jointPage` (page coords) with the given page rotation.
	 * A bone's head is its local origin, so once we've decided the rotation, the head's page
	 * position is just the shape's (x, y) mapped through its tldraw parent (the page here).
	 */
	private applyPose(child: BoneShape, jointPage: { x: number; y: number }, rotation: number) {
		const targetXY = this.editor.getPointInParentSpace(child.id, jointPage)

		const samePos = Math.abs(child.x - targetXY.x) < 0.01 && Math.abs(child.y - targetXY.y) < 0.01
		const sameRot = Math.abs(normalizeAngle(child.rotation - rotation)) < 0.0001
		if (samePos && sameRot) return // already there — don't thrash / echo

		withSuppressed([child.id], () => {
			this.editor.updateShape({
				id: child.id,
				type: 'poser-bone',
				x: targetXY.x,
				y: targetXY.y,
				rotation,
			} as TLShapePartial)
		})
	}

	/** A bone's tail (distal joint) in page space. */
	private tailPage(bone: BoneShape) {
		return this.editor.getShapePageTransform(bone.id).applyToPoint(boneTailLocal(bone))
	}
}

function normalizeAngle(a: number): number {
	let r = a % (Math.PI * 2)
	if (r > Math.PI) r -= Math.PI * 2
	if (r < -Math.PI) r += Math.PI * 2
	return r
}

// Re-export so App can register from one place if desired.
export { boneJointBindingProps }
