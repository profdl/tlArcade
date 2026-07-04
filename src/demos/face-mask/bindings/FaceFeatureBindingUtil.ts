import { BindingUtil, type BindingOnShapeChangeOptions, type TLShapeId, type TLShapePartial } from 'tldraw'
import { rotateVector, scaleForLandmark } from '../shapes/faceVideoMath'
import type { FaceVideoShape } from '../shapes/faceVideoShape'
import { faceFeatureBindingProps, type FaceFeatureBinding } from './faceFeatureBinding'

const MOVE_EPSILON = 0.5 // px — below this, treat a shape's position as "unchanged" (float noise)
const ROTATE_EPSILON = 0.01 // radians — same idea, for rotation

export class FaceFeatureBindingUtil extends BindingUtil<FaceFeatureBinding> {
	static override type = 'face-feature' as const
	static override props = faceFeatureBindingProps

	getDefaultProps(): FaceFeatureBinding['props'] {
		return {
			landmark: '',
			offsetX: 0,
			offsetY: 0,
			rotationOffset: 0,
			baseHeight: 0,
			baseWidth: 0,
			baseLandmarkScaleX: 1,
			baseLandmarkScaleY: 1,
			secondaryLandmark: '',
			axisMode: 'span',
			baseAxisLength: 0,
			lastAppliedX: 0,
			lastAppliedY: 0,
			lastAppliedRotation: 0,
		}
	}

	override onAfterCreate({ binding }: { binding: FaceFeatureBinding }) {
		this.reposition(binding)
	}

	override onAfterChangeFromShape({ binding }: BindingOnShapeChangeOptions<FaceFeatureBinding>) {
		this.reposition(binding)
	}

	/**
	 * The bound shape can change for two reasons: we just repositioned it to follow the
	 * landmark, or the user grabbed and moved it themselves. If the new position doesn't match
	 * what we last applied, it's the user — release the pin so they can freely regrab it.
	 */
	override onAfterChangeToShape({ binding, shapeAfter }: BindingOnShapeChangeOptions<FaceFeatureBinding>) {
		const dx = Math.abs(shapeAfter.x - binding.props.lastAppliedX)
		const dy = Math.abs(shapeAfter.y - binding.props.lastAppliedY)
		const dr = Math.abs(normalizeAngle(shapeAfter.rotation - binding.props.lastAppliedRotation))
		if (dx > MOVE_EPSILON || dy > MOVE_EPSILON || dr > ROTATE_EPSILON) {
			this.editor.deleteBinding(binding.id)
		}
	}

	private reposition(binding: FaceFeatureBinding) {
		const faceShape = this.editor.getShape(binding.fromId) as FaceVideoShape | undefined
		let toShape = this.editor.getShape(binding.toId)
		if (!faceShape || !toShape) return

		const landmark = faceShape.props.landmarks[binding.props.landmark]
		if (!landmark) return // feature not currently visible — leave the shape where it last was

		// Two-landmark ("axis") mode — e.g. landmark='forehead', secondaryLandmark='chin'. Two
		// flavors (see faceFeatureBinding.ts): 'span' fits the shape exactly between the two
		// markers (head outlines); 'follow' keeps the shape's bound size/offset but tracks the
		// axis frame — translating with the midpoint, rotating with the axis angle, and scaling
		// uniformly with the axis length (accessories like hats or rabbit ears).
		const secondaryLandmark = binding.props.secondaryLandmark
			? faceShape.props.landmarks[binding.props.secondaryLandmark]
			: undefined
		const axis = secondaryLandmark
			? { dx: secondaryLandmark.x - landmark.x, dy: secondaryLandmark.y - landmark.y }
			: null
		const axisLength = axis ? Math.hypot(axis.dx, axis.dy) : 0
		if (axis && axisLength < 1) return // markers coincide (degenerate frame) — hold position
		const isFollow = axis !== null && binding.props.axisMode === 'follow'
		const axisScale = isFollow && binding.props.baseAxisLength > 0 ? axisLength / binding.props.baseAxisLength : 1

		// Mouth-pinned shapes stretch with how open/wide the mouth is; eye-pinned shapes stretch
		// vertically with the (synthetic) blink animation; span-mode shapes set their height to the
		// distance between the two landmarks so the top/bottom edges land exactly on them; follow-
		// mode shapes scale uniformly with that distance. Resized before the position step below,
		// so that step re-centers using the post-resize geometry. The tracker's scale factors are
		// calibrated to an absolute closed/open range, not to this particular user's mouth — so we
		// divide by the scale captured at bind time to get growth *relative* to wherever the mouth
		// was when the shape was attached, keeping the shape at its base size at that moment.
		const scale = axis ? { x: 1, y: 1 } : scaleForLandmark(binding.props.landmark, faceShape)
		if (scale && binding.props.baseWidth > 0 && binding.props.baseHeight > 0) {
			const relativeScaleX = axis
				? scale.x
				: binding.props.baseLandmarkScaleX > 0
					? scale.x / binding.props.baseLandmarkScaleX
					: 1
			const relativeScaleY = axis
				? scale.y
				: binding.props.baseLandmarkScaleY > 0
					? scale.y / binding.props.baseLandmarkScaleY
					: 1
			const targetWidth = axis ? binding.props.baseWidth * axisScale : binding.props.baseWidth * relativeScaleX
			const targetHeight = axis
				? isFollow
					? binding.props.baseHeight * axisScale
					: axisLength
				: binding.props.baseHeight * relativeScaleY

			if (
				'w' in toShape.props &&
				'h' in toShape.props &&
				typeof toShape.props.w === 'number' &&
				typeof toShape.props.h === 'number'
			) {
				// Shapes with plain numeric w/h (geo, image, video, note, ...) — set directly, so tiny
				// closed-mouth/blink sizes aren't clamped by whatever minimum size onResize enforces.
				if (Math.abs(toShape.props.w - targetWidth) > 0.01 || Math.abs(toShape.props.h - targetHeight) > 0.01) {
					this.editor.updateShape({
						id: toShape.id,
						type: toShape.type,
						props: { w: targetWidth, h: targetHeight },
					} as any)
				}
			} else {
				// Everything else (e.g. draw shapes, which store points instead of w/h) — go through
				// the shape's own resize handling, subject to whatever minimum size it enforces.
				const bounds = this.editor.getShapeGeometry(toShape.id).bounds
				if (bounds.width > 0 && bounds.height > 0) {
					const scaleX = targetWidth / bounds.width
					const scaleY = targetHeight / bounds.height
					if (Math.abs(scaleX - 1) > 0.001 || Math.abs(scaleY - 1) > 0.001) {
						this.editor.resizeShape(toShape.id, { x: scaleX, y: scaleY })
					}
				}
			}

			const resized = this.editor.getShape(toShape.id)
			if (!resized) return
			toShape = resized
		}

		// Axis modes anchor to the midpoint of the two landmarks and rotate against the axis's own
		// angle — atan2 measures from the +x axis, and the shape's top→bottom direction is its
		// local +y, so subtract π/2 to make an upright (straight-down) axis mean "no rotation".
		// 'span' ignores the stored offset/rotationOffset (strict attachment fully determines the
		// pose); 'follow' reapplies them relative to the current axis. Single-landmark bindings
		// anchor to their landmark and rotate with the tracked head roll, as before.
		const anchorLocal = axis ? { x: landmark.x + axis.dx / 2, y: landmark.y + axis.dy / 2 } : landmark
		const rotationBasis = axis ? Math.atan2(axis.dy, axis.dx) - Math.PI / 2 : faceShape.props.faceRotation

		// The stored offset is frame-relative (see snapToFace.ts) — rotate it back into the video's
		// local space using the current basis so it tracks however the head is turned now. Follow
		// offsets are normalized by the bind-time axis length, so multiplying by the *current*
		// length makes the offset stretch with the head too.
		const rotatedOffset = axis
			? isFollow
				? rotateVector(binding.props.offsetX * axisLength, binding.props.offsetY * axisLength, rotationBasis)
				: { x: 0, y: 0 }
			: rotateVector(binding.props.offsetX * faceShape.props.w, binding.props.offsetY * faceShape.props.h, rotationBasis)
		const localX = anchorLocal.x + rotatedOffset.x
		const localY = anchorLocal.y + rotatedOffset.y
		const faceTransform = this.editor.getShapePageTransform(faceShape.id)
		const targetCenterPage = faceTransform.applyToPoint({ x: localX, y: localY })

		// Move the shape's center to the landmark — a plain (x, y) shift in parent space, so it's
		// correct regardless of the shape's current rotation (translation doesn't care about it).
		const currentCenterInParent = this.editor.getPointInParentSpace(toShape.id, this.shapeCenterPage(toShape.id))
		const targetCenterInParent = this.editor.getPointInParentSpace(toShape.id, targetCenterPage)
		const targetX = toShape.x + (targetCenterInParent.x - currentCenterInParent.x)
		const targetY = toShape.y + (targetCenterInParent.y - currentCenterInParent.y)

		const targetPageRotation =
			faceTransform.rotation() + rotationBasis + (axis && !isFollow ? 0 : binding.props.rotationOffset)
		const rotationDelta = normalizeAngle(targetPageRotation - this.editor.getShapePageTransform(toShape.id).rotation())

		// `toShape.type` is a wide (non-literal) union; with the number of custom
		// shape types now registered project-wide, TS's discriminated-union check
		// on the partial no longer resolves it structurally. Assert instead —
		// this is always one of `toShape`'s own actual (valid) partials at runtime.
		this.editor.updateShape({ id: toShape.id, type: toShape.type, x: targetX, y: targetY } as TLShapePartial)
		// Rotate in place around the (now-centered) landmark point, per tldraw's own rotate-in-place
		// semantics — this also swings (x, y) around the center as part of spinning, so the shape's
		// final x/y aren't targetX/targetY anymore; read them back below instead of assuming.
		this.editor.rotateShapesBy([toShape.id], rotationDelta, { center: targetCenterPage })

		const finalShape = this.editor.getShape(toShape.id)
		if (!finalShape) return
		this.editor.updateBinding<FaceFeatureBinding>({
			id: binding.id,
			type: 'face-feature',
			props: {
				...binding.props,
				lastAppliedX: finalShape.x,
				lastAppliedY: finalShape.y,
				lastAppliedRotation: finalShape.rotation,
			},
		})
	}

	/**
	 * The shape's true geometric center in page space, via its local geometry bounds and page
	 * transform — NOT `getShapePageBounds`' AABB, which for non-rectangular content (e.g. a star)
	 * isn't centered on the same point once the shape is rotated.
	 */
	private shapeCenterPage(shapeId: TLShapeId) {
		const bounds = this.editor.getShapeGeometry(shapeId).bounds
		const localCenter = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
		return this.editor.getShapePageTransform(shapeId).applyToPoint(localCenter)
	}
}

function normalizeAngle(a: number): number {
	let r = a % (Math.PI * 2)
	if (r > Math.PI) r -= Math.PI * 2
	if (r < -Math.PI) r += Math.PI * 2
	return r
}
