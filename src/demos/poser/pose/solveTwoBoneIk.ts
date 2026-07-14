import type { Editor, TLShapeId, TLShapePartial, VecLike } from 'tldraw'
import { boneTailLocal, type BoneShape } from '../shapes/boneShape'
import { withSuppressed } from './bindingSuppression'
import { bendSignFromRest, normalizeAngle, solveTwoBone } from './ik'

/**
 * Pose one two-bone limb so its tip (the effector bone's tail) reaches
 * `targetPage`. Reads the current bone geometry, runs the pure analytic solver
 * (ik.ts), and writes the two bones' rotations.
 *
 * Write strategy (see the tldraw-integration research):
 * - We set ONLY the two bones' `rotation`s. Because every bone is page-parented
 *   (a flat rig — bones connect via bindings, not tldraw parenting), a bone's
 *   local `rotation` prop IS its page-space angle, so the solver's angles apply
 *   directly.
 * - The bone-joint binding's `onAfterChangeFromShape` then re-pins positions: the
 *   effector's head slides onto the root's (rotated) tail, and any grandchildren
 *   (e.g. a hand bone) cascade. So we never write x/y here.
 * - The writes are wrapped in `withSuppressed` so the binding's
 *   `onAfterChangeToShape` doesn't reinterpret our rotation as a user drag, and
 *   in `editor.run({history:'ignore'})` so a live drag doesn't spam undo history
 *   (the caller places one history stopping point per gesture).
 *
 * The bend direction (elbow up vs down) is taken from the limb's CURRENT pose, so
 * a solve never flips the joint to its mirror mid-drag.
 */
export function solveTwoBoneIk(
	editor: Editor,
	rootBoneId: TLShapeId,
	effectorBoneId: TLShapeId,
	targetPage: VecLike
): void {
	const rootBone = editor.getShape(rootBoneId) as BoneShape | undefined
	const effectorBone = editor.getShape(effectorBoneId) as BoneShape | undefined
	if (!rootBone || !effectorBone || rootBone.type !== 'poser-bone' || effectorBone.type !== 'poser-bone') return

	// Root joint (the fixed pivot) = the root bone's head = its origin in page space.
	// getShapePageTransform is Mat | undefined — a shape deleted or a page switched
	// mid-drag (this runs on every pointermove) would otherwise throw here.
	const rootTransform = editor.getShapePageTransform(rootBoneId)
	if (!rootTransform) return
	const rootJointPage = rootTransform.applyToPoint({ x: 0, y: 0 })

	const l1 = rootBone.props.length
	const l2 = effectorBone.props.length
	const bendSign = bendSignFromRest(rootBone.rotation, effectorBone.rotation)

	const solution = solveTwoBone(rootJointPage, l1, l2, targetPage, bendSign)

	// Skip if both bones are already at the solved angles (avoid thrash / echo).
	const rootSame = Math.abs(normalizeAngle(rootBone.rotation - solution.rootAngle)) < 1e-4
	const effSame = Math.abs(normalizeAngle(effectorBone.rotation - solution.effectorAngle)) < 1e-4
	if (rootSame && effSame) return

	withSuppressed([rootBoneId, effectorBoneId], () => {
		editor.run(
			() => {
				editor.updateShape({ id: rootBoneId, type: 'poser-bone', rotation: solution.rootAngle } as TLShapePartial)
				editor.updateShape({
					id: effectorBoneId,
					type: 'poser-bone',
					rotation: solution.effectorAngle,
				} as TLShapePartial)
			},
			{ history: 'ignore' }
		)
	})
}

/** The effector tip (the effector bone's tail) in page space — where its drag handle sits. */
export function effectorTipPage(editor: Editor, effectorBoneId: TLShapeId): VecLike | null {
	const bone = editor.getShape(effectorBoneId) as BoneShape | undefined
	if (!bone || bone.type !== 'poser-bone') return null
	const transform = editor.getShapePageTransform(effectorBoneId)
	if (!transform) return null
	return transform.applyToPoint(boneTailLocal(bone))
}
