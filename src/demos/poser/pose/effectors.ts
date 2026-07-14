import type { Editor, TLShapeId } from 'tldraw'
import { allFigureIds, bonesByName } from '../rig/buildFigure'

/**
 * A two-bone IK chain: root joint → middle joint → tip. For an arm that's
 * shoulder → elbow → wrist; for a leg, hip → knee → ankle. The tip is the drag
 * handle; the solver bends `rootBone` and `effectorBone` so the tip reaches it.
 */
export interface IkChain {
	/** Bone 1 (upper arm / thigh) — pivots at its head (the root joint). */
	rootBoneId: TLShapeId
	/** Bone 2 (forearm / shin) — its tail is the tip/effector (wrist / ankle). */
	effectorBoneId: TLShapeId
	/** The figure this chain belongs to (its pelvis/root shape id). */
	figureId: TLShapeId
	/** Label for the handle, e.g. 'wrist-l'. Unique per figure, not per page. */
	label: string
}

// The four limb chains, by the bone `name`s the rig builder assigns. Each chain's
// effector is a leaf bone whose tail is the hand/foot the user grabs.
const CHAIN_SPECS: { root: string; effector: string; label: string }[] = [
	{ root: 'upper-arm-l', effector: 'forearm-l', label: 'wrist-l' },
	{ root: 'upper-arm-r', effector: 'forearm-r', label: 'wrist-r' },
	{ root: 'thigh-l', effector: 'shin-l', label: 'ankle-l' },
	{ root: 'thigh-r', effector: 'shin-r', label: 'ankle-r' },
]

/**
 * Find the IK chains for every figure on the page. A "figure" is the set of bones
 * sharing a `meta.figureId` (stamped by buildFigure). We resolve the four limb
 * chains per figure and tag each with its `figureId`, so N figures yield up to 4·N
 * chains — bone names repeat across figures, but the figureId keeps them apart.
 */
export function getIkChains(editor: Editor): IkChain[] {
	const chains: IkChain[] = []
	for (const figureId of allFigureIds(editor)) {
		const byName = bonesByName(editor, figureId)
		for (const spec of CHAIN_SPECS) {
			const rootBoneId = byName.get(spec.root)
			const effectorBoneId = byName.get(spec.effector)
			if (rootBoneId && effectorBoneId) {
				chains.push({ rootBoneId, effectorBoneId, figureId, label: spec.label })
			}
		}
	}
	return chains
}
