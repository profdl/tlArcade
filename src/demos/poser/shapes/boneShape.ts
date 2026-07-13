import { T, type RecordProps, type TLBaseShape } from 'tldraw'

/**
 * A single limb segment of the articulated figure.
 *
 * Geometry convention (the whole rig depends on it):
 * - The shape's origin `(x, y)` is the *proximal* joint — the end nearer the
 *   torso / the end that gets pinned to its parent. Call it the "head".
 * - The bone extends along the shape's local +x axis for `length` px, so the
 *   *distal* joint (the "tail", where children attach) is at local `(length, 0)`.
 * - The shape's native `rotation` prop is the bone's angle. Because the head is
 *   the origin, rotating the shape swings the tail around the head — exactly the
 *   pivot you want for a joint.
 *
 * `thickness` is the capsule's diameter (visual only). `color` is a plain CSS
 * color string so the rig can tint bones without pulling in tldraw's style set.
 */
export type BoneShapeProps = {
	length: number
	thickness: number
	color: string
	/** Human-readable joint name, e.g. 'upper-arm-l'. Used by the rig builder and for debugging. */
	name: string
}

export type BoneShape = TLBaseShape<'poser-bone', BoneShapeProps>

// Register with tldraw's global shape-type union so editor.getShape / createShape
// narrow to BoneShape. This augmentation is program-global (see repo CLAUDE.md).
declare module '@tldraw/tlschema' {
	interface TLGlobalShapePropsMap {
		'poser-bone': BoneShapeProps
	}
}

export const boneShapeProps: RecordProps<BoneShape> = {
	length: T.nonZeroNumber,
	thickness: T.positiveNumber,
	color: T.string,
	name: T.string,
}

export const BONE_DEFAULT_LENGTH = 80
export const BONE_DEFAULT_THICKNESS = 18

/** The bone's distal joint ("tail") in its own local space. */
export function boneTailLocal(shape: BoneShape) {
	return { x: shape.props.length, y: 0 }
}
