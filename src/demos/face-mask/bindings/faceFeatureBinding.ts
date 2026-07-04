import { T, type RecordProps, type TLBaseBinding } from 'tldraw'

export type FaceFeatureBindingProps = {
	/** Which named landmark on the face-video shape this binding tracks. */
	landmark: string
	/** Offset from the landmark to the bound shape's center, as a fraction of the face shape's w/h, captured at bind time. */
	offsetX: number
	offsetY: number
	/** Rotation (radians) to add on top of the tracked head roll, captured at bind time so the shape keeps whatever tilt it was dropped at. */
	rotationOffset: number
	/** The shape's height/width at bind time — mouth-pinned shapes scale off of these as the mouth opens/closes and widens/narrows. 0 for other landmarks. */
	baseHeight: number
	baseWidth: number
	/**
	 * The landmark's own (width, height) scale factor at bind time, captured so later frames can
	 * scale the shape *relative* to wherever the user's mouth/eye happened to be when it was
	 * attached, rather than to the tracker's absolute closed/open calibration. 1 for landmarks with
	 * no expression behavior.
	 */
	baseLandmarkScaleX: number
	baseLandmarkScaleY: number
	/**
	 * A second landmark forming an axis with `landmark`, e.g. 'chin' when `landmark` is 'forehead'
	 * — for shapes that should track the whole head rather than one point. Empty string means
	 * single-landmark mode. See `axisMode` for how the shape follows the axis.
	 */
	secondaryLandmark: string
	/**
	 * How an axis-bound shape follows its two landmarks (meaningless when `secondaryLandmark` is
	 * empty):
	 * - 'span' (head outlines): the shape's local top-center edge attaches to `landmark` and its
	 *   bottom-center edge to `secondaryLandmark` — height is set to the distance between them
	 *   (width left as bound), rotation aligns the shape's vertical to the axis, and
	 *   `offsetX/offsetY`/`rotationOffset` are ignored. Strict attachment fully determines the
	 *   pose, e.g. growing taller as the jaw drops.
	 * - 'follow' (accessories like hats or rabbit ears): the shape keeps its bound size and offset
	 *   but tracks the axis *frame* — it translates with the midpoint, rotates with the axis
	 *   angle, and scales uniformly with the axis length. `offsetX/offsetY` are in the axis frame
	 *   (un-rotated, as a fraction of `baseAxisLength`), so the offset itself swings and stretches
	 *   with the head.
	 */
	axisMode: 'span' | 'follow'
	/**
	 * The forehead-chin (axis) distance in face-local px at bind time — 'follow' shapes scale
	 * uniformly by how the current distance compares to this. Unused for 'span' and single-landmark
	 * bindings (0).
	 */
	baseAxisLength: number
	/** The page-space position/rotation we last set on the bound shape — lets us tell "we moved it" from "the user moved it". */
	lastAppliedX: number
	lastAppliedY: number
	lastAppliedRotation: number
}

export type FaceFeatureBinding = TLBaseBinding<'face-feature', FaceFeatureBindingProps>

declare module '@tldraw/tlschema' {
	interface TLGlobalBindingPropsMap {
		'face-feature': FaceFeatureBindingProps
	}
}

export const faceFeatureBindingProps: RecordProps<FaceFeatureBinding> = {
	landmark: T.string,
	offsetX: T.number,
	offsetY: T.number,
	rotationOffset: T.number,
	baseHeight: T.number,
	baseWidth: T.number,
	baseLandmarkScaleX: T.number,
	baseLandmarkScaleY: T.number,
	secondaryLandmark: T.string,
	axisMode: T.literalEnum('span', 'follow'),
	baseAxisLength: T.number,
	lastAppliedX: T.number,
	lastAppliedY: T.number,
	lastAppliedRotation: T.number,
}
