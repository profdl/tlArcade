import {
	DefaultColorStyle,
	DefaultDashStyle,
	DefaultFillStyle,
	DefaultSizeStyle,
	T,
	type RecordProps,
	type TLBaseShape,
	type TLDefaultColorStyle,
	type TLDefaultDashStyle,
	type TLDefaultFillStyle,
	type TLDefaultSizeStyle,
} from 'tldraw'

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
 * Styling is the FULL native geo-shape style set — `color`, `size`, `dash`, and
 * `fill` are the same built-in `StyleProp`s a `geo` shape uses, so a bone offers
 * every styling option a geo oval does (outline color, stroke weight, dash
 * pattern, interior fill) and shares the style panel + global palette + light/
 * dark theming. The bone even renders as a stadium (rounded oval), so visually
 * it's an oval geo shape — but it stays a custom shape because a bone must pivot
 * around its *head* (its origin), which a real geo shape (corner-origin) can't do
 * without breaking the joint bindings and IK.
 *
 * `length` and `name` stay bespoke — they're geometry / identity, not style. The
 * rendered bone diameter comes from `size` via BONE_THICKNESS below.
 */
export type BoneShapeProps = {
	length: number
	color: TLDefaultColorStyle
	size: TLDefaultSizeStyle
	dash: TLDefaultDashStyle
	fill: TLDefaultFillStyle
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
	// positiveNumber (> 0), not nonZeroNumber: a negative length would render the
	// capsule / hit-rect backwards. Builders always emit length ≥ 1, so 0 is also
	// never valid — this encodes the true geometric invariant.
	length: T.positiveNumber,
	// StyleProp instances — tldraw scans the util's props for these and auto-adds
	// them to the style panel; no extra worker/schema wiring needed. Same set a
	// geo shape carries.
	color: DefaultColorStyle,
	size: DefaultSizeStyle,
	dash: DefaultDashStyle,
	fill: DefaultFillStyle,
	name: T.string,
}

export const BONE_DEFAULT_LENGTH = 80

/**
 * Bone diameter (px) per native size step. Analogous to tldraw's own STROKE_SIZES
 * (which isn't a public export in this version), but scaled up to limb thicknesses
 * rather than stroke widths.
 */
export const BONE_THICKNESS: Record<TLDefaultSizeStyle, number> = {
	s: 10,
	m: 18,
	l: 26,
	xl: 40,
}

/** The rendered thickness (px) of a bone, from its native `size` style. */
export function boneThickness(shape: BoneShape): number {
	return BONE_THICKNESS[shape.props.size]
}

/** The bone's distal joint ("tail") in its own local space. */
export function boneTailLocal(shape: BoneShape) {
	return { x: shape.props.length, y: 0 }
}
