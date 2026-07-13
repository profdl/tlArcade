import type { Editor, TLShapeId } from 'tldraw'
import type { BoneShape } from '../shapes/boneShape'

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
	/** Label for the handle, e.g. 'wrist-l'. */
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
 * Find the IK chains for every figure on the page. A "figure" is a connected set
 * of bones; we key purely off bone `name`s (unique per figure in the current
 * single-figure rig — see the note below for multi-figure).
 *
 * NOTE: with more than one figure on the page, bone names repeat, so this returns
 * chains built from the *first* bone of each name. Multi-figure support would tag
 * each bone with a `meta.figureId` at build time and group by it; single-figure
 * is all the current demo spawns by default.
 */
export function getIkChains(editor: Editor): IkChain[] {
	const byName = new Map<string, TLShapeId>()
	for (const shape of editor.getCurrentPageShapes()) {
		if (shape.type !== 'poser-bone') continue
		const name = (shape as BoneShape).props.name
		if (!byName.has(name)) byName.set(name, shape.id)
	}

	const chains: IkChain[] = []
	for (const spec of CHAIN_SPECS) {
		const rootBoneId = byName.get(spec.root)
		const effectorBoneId = byName.get(spec.effector)
		if (rootBoneId && effectorBoneId) {
			chains.push({ rootBoneId, effectorBoneId, label: spec.label })
		}
	}
	return chains
}
