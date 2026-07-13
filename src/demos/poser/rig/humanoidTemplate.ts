import type { TLDefaultColorStyle, TLDefaultSizeStyle } from 'tldraw'
import type { BoneShape } from '../shapes/boneShape'

/**
 * The single source of truth for the humanoid rig's TOPOLOGY and STYLING — shared by
 * both builders (buildFigure = fixed template angles/lengths; buildFigureFromJoints =
 * geometry fitted to user-placed joint markers). Only the GEOMETRY differs between
 * them; the bone set, parent chain, per-bone size/color, and render props are
 * identical, so they live here and can't drift apart.
 *
 * Skeleton = the classic COCO-18 keypoint humanoid (OpenPose): a central spine with
 * SHOULDERS spread horizontally from the chest and HIPS spread from the pelvis, so
 * arms and legs drop from separated points (that breadth is what makes it read as a
 * person). The clavicle/hip bones are the horizontal spreaders; their tails ARE the
 * shoulder/hip keypoints. Every child pins its head to its parent's tail via a
 * bone-joint binding, so posing propagates down the chain.
 */

/** Native theme palette names (adapt to light/dark, share the style panel). */
export const BONE_COLORS = {
	spine: 'grey' as TLDefaultColorStyle,
	limb: 'blue' as TLDefaultColorStyle,
	head: 'light-blue' as TLDefaultColorStyle,
	connect: 'grey' as TLDefaultColorStyle, // clavicle / hip spreaders — read as connective structure
}

/**
 * One bone's identity + styling, geometry-free. `size`/`color` are per-bone
 * documentation of the intended proportions; the actual rendered diameter is uniform
 * Small (see SHARED_BONE_PROPS) so the rig reads as thin guide-bones. `parent` names
 * another bone (its tail is this bone's head joint); the root (pelvis) has none.
 */
export interface BoneTemplate {
	name: string
	size: TLDefaultSizeStyle
	color: TLDefaultColorStyle
	parent?: string
}

// Ordered top-down (pelvis root first) so a parent is always created before its
// children — every consumer relies on this order for parent-before-child creation
// and for the parent→child pose-application order.
export const HUMANOID_BONES: BoneTemplate[] = [
	{ name: 'pelvis', size: 'l', color: BONE_COLORS.spine },
	{ name: 'spine', size: 'l', color: BONE_COLORS.spine, parent: 'pelvis' },
	{ name: 'neck', size: 'm', color: BONE_COLORS.spine, parent: 'spine' },
	{ name: 'head', size: 'xl', color: BONE_COLORS.head, parent: 'neck' },

	{ name: 'clavicle-l', size: 's', color: BONE_COLORS.connect, parent: 'neck' },
	{ name: 'clavicle-r', size: 's', color: BONE_COLORS.connect, parent: 'neck' },
	{ name: 'upper-arm-l', size: 'm', color: BONE_COLORS.limb, parent: 'clavicle-l' },
	{ name: 'forearm-l', size: 'm', color: BONE_COLORS.limb, parent: 'upper-arm-l' },
	{ name: 'upper-arm-r', size: 'm', color: BONE_COLORS.limb, parent: 'clavicle-r' },
	{ name: 'forearm-r', size: 'm', color: BONE_COLORS.limb, parent: 'upper-arm-r' },

	{ name: 'hip-l', size: 'm', color: BONE_COLORS.connect, parent: 'pelvis' },
	{ name: 'hip-r', size: 'm', color: BONE_COLORS.connect, parent: 'pelvis' },
	{ name: 'thigh-l', size: 'm', color: BONE_COLORS.limb, parent: 'hip-l' },
	{ name: 'shin-l', size: 'm', color: BONE_COLORS.limb, parent: 'thigh-l' },
	{ name: 'thigh-r', size: 'm', color: BONE_COLORS.limb, parent: 'hip-r' },
	{ name: 'shin-r', size: 'm', color: BONE_COLORS.limb, parent: 'thigh-r' },
]

/** Bone name → its template, for O(1) lookup by consumers. */
export const BONE_BY_NAME: ReadonlyMap<string, BoneTemplate> = new Map(HUMANOID_BONES.map((b) => [b.name, b]))

/**
 * The bones a pose actually rotates: the trunk + limbs, top-down. Derived from the
 * topology (everything except the root pelvis and the horizontal clavicle/hip
 * spreaders, whose lengths define torso/hip WIDTH and must stay constant). This is
 * the one list APPLY_ORDER and REST_FRAME both consume, so there's no hand-synced
 * copy of the posable-bone set.
 */
const NON_POSABLE = new Set(['pelvis', 'clavicle-l', 'clavicle-r', 'hip-l', 'hip-r'])
export const POSABLE_BONES: string[] = HUMANOID_BONES.filter((b) => !NON_POSABLE.has(b.name)).map((b) => b.name)

/**
 * The render props every bone shares regardless of builder: uniform Small so the rig
 * reads as thin, subtle, dotted guide-bones (see the "Style rig bones" decision). The
 * per-bone `size` in the template is kept only as proportion documentation. Callers
 * supply the per-bone `length`, `color`, and `name`.
 */
export function sharedBoneProps(
	color: TLDefaultColorStyle,
	length: number,
	name: string
): BoneShape['props'] {
	return {
		length,
		size: 's',
		color,
		dash: 'dotted',
		fill: 'semi',
		name,
	}
}
