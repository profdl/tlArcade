import {
	getPointsFromDrawSegments,
	type Editor,
	type TLArrowShape,
	type TLDrawShape,
	type TLHighlightShape,
	type TLShape,
	type TLShapeId,
} from 'tldraw'
import type { FaceFeatureBinding } from './bindings/faceFeatureBinding'
import { dragSnapCandidateAtom } from './dragSnapPreview'
import { rotateVector, scaleForLandmark } from './shapes/faceVideoMath'
import type { FaceVideoShape } from './shapes/faceVideoShape'

const SNAP_RADIUS_SCREEN_PX = 36
// How far past a stroke's bounding box the forehead/chin markers may sit and still count as
// "spanned" by it, as a fraction of the forehead-chin distance. Users rarely draw a head outline
// that fully encloses both markers — the chin marker especially tends to sit just below the
// drawn jawline — so containment is tested with this much slack.
const HEAD_SPAN_TOLERANCE = 0.2

type LandmarkMatch = {
	faceShape: FaceVideoShape
	landmark: string
	distance: number
	/** Set for two-landmark axis attachment (head outline spanning forehead+chin). */
	secondaryLandmark?: string
}

/**
 * While a shape is being dragged, preview which landmark it would snap to if dropped right now
 * (or clear the preview if none). Call this on every pointer-move while dragging.
 */
export function updateDragSnapPreview(editor: Editor) {
	const faceShapes = getFaceShapes(editor)
	if (faceShapes.length === 0) {
		dragSnapCandidateAtom.set(null)
		return
	}

	const snapRadiusPage = SNAP_RADIUS_SCREEN_PX / editor.getZoomLevel()
	// While drawing, nothing is selected — fall back to whichever draw/highlight shape is
	// currently mid-stroke so the nearest landmark still previews as the pointer moves over it.
	const shapesToCheck = editor.getSelectedShapes()
	const candidates = shapesToCheck.length > 0 ? shapesToCheck : getActivelyDrawingShapes(editor)

	let best: LandmarkMatch | null = null
	for (const shape of candidates) {
		if (shape.type === 'face-video') continue
		const candidate = findSnapCandidate(editor, shape, faceShapes, snapRadiusPage)
		if (candidate && (!best || candidate.distance < best.distance)) best = candidate
	}

	dragSnapCandidateAtom.set(
		best
			? { faceShapeId: best.faceShape.id, landmark: best.landmark, secondaryLandmark: best.secondaryLandmark }
			: null
	)
}

export function clearDragSnapPreview() {
	dragSnapCandidateAtom.set(null)
}

/**
 * Called after a pointer-up. If the just-dropped shape landed on top of a face-video shape, pin
 * it to whichever tracked landmark is nearest (no distance limit — being on the video is intent
 * enough). Otherwise, fall back to snapping only if it landed within a small radius of a landmark.
 */
export function trySnapSelectedShapesToFace(editor: Editor) {
	const faceShapes = getFaceShapes(editor)
	if (faceShapes.length === 0) return

	const snapRadiusPage = SNAP_RADIUS_SCREEN_PX / editor.getZoomLevel()

	for (const shape of editor.getSelectedShapes()) {
		if (shape.type === 'face-video') continue
		trySnapShape(editor, shape, faceShapes, snapRadiusPage)
	}
}

/**
 * Wire up snapping for shapes drawn straight onto the face-video shape: whenever a draw/highlight
 * shape finishes its stroke (props.isComplete flips true), snap it to the nearest landmark the
 * same way a dropped shape snaps. Returns an unsubscribe function.
 */
export function setupDrawShapeSnapping(editor: Editor) {
	return editor.store.listen(
		(entry) => {
			for (const [from, to] of Object.values(entry.changes.updated)) {
				if (!isDrawableShape(from) || !isDrawableShape(to)) continue
				if (!from.props.isComplete && to.props.isComplete) {
					trySnapShapeToFace(editor, to.id)
				}
			}
		},
		{ source: 'user', scope: 'document' }
	)
}

function isDrawableShape(record: unknown): record is TLDrawShape | TLHighlightShape {
	const shape = record as TLShape
	return shape?.typeName === 'shape' && (shape.type === 'draw' || shape.type === 'highlight')
}

function getActivelyDrawingShapes(editor: Editor): TLShape[] {
	return editor
		.getCurrentPageShapes()
		.filter((s) => isDrawableShape(s) && !s.props.isComplete)
}

/** Snap a single shape (by id) to the nearest face landmark, same rules as a dropped shape. */
export function trySnapShapeToFace(editor: Editor, shapeId: TLShapeId) {
	const shape = editor.getShape(shapeId)
	if (!shape) return
	const faceShapes = getFaceShapes(editor)
	if (faceShapes.length === 0) return
	const snapRadiusPage = SNAP_RADIUS_SCREEN_PX / editor.getZoomLevel()
	trySnapShape(editor, shape, faceShapes, snapRadiusPage)
}

function getFaceShapes(editor: Editor): FaceVideoShape[] {
	return editor.getCurrentPageShapes().filter((s): s is FaceVideoShape => s.type === 'face-video')
}

function trySnapShape(editor: Editor, shape: TLShape, faceShapes: FaceVideoShape[], snapRadiusPage: number) {
	let best = findSnapCandidate(editor, shape, faceShapes, snapRadiusPage)

	// Clear any existing pin — a shape can only follow one landmark at a time.
	for (const binding of editor.getBindingsToShape(shape.id, 'face-feature')) {
		editor.deleteBinding(binding.id)
	}

	if (!best) return

	// The synthetic 'head' marker is a proxy for the whole head: the shape attaches to the
	// forehead-chin axis in 'follow' mode — it keeps its drawn size and position (rabbit ears stay
	// where you drew them) but translates, rotates, and scales with the head. Spanning outlines
	// (secondaryLandmark already set by findSnapCandidate) instead get strict 'span' fitting.
	if (best.landmark === 'head' && tryCreateFollowBinding(editor, shape, best.faceShape)) return

	// Spanning head outline: offsets and rotation are ignored by span mode — strict attachment to
	// both markers fully determines the pose — so bind with neutral values.
	if (best.secondaryLandmark) {
		editor.createBinding<FaceFeatureBinding>({
			type: 'face-feature',
			fromId: best.faceShape.id,
			toId: shape.id,
			props: {
				landmark: best.landmark,
				offsetX: 0,
				offsetY: 0,
				rotationOffset: 0,
				baseHeight: editor.getShapeGeometry(shape.id).bounds.height,
				baseWidth: editor.getShapeGeometry(shape.id).bounds.width,
				baseLandmarkScaleX: 1,
				baseLandmarkScaleY: 1,
				secondaryLandmark: best.secondaryLandmark,
				axisMode: 'span',
				baseAxisLength: 0,
				lastAppliedX: shape.x,
				lastAppliedY: shape.y,
				lastAppliedRotation: shape.rotation,
			},
		})
		return
	}

	const shapeCenter = editor.getShapePageBounds(shape.id)!.center
	const landmarkLocal = best.faceShape.props.landmarks[best.landmark]
	const shapeCenterInFaceLocal = editor.getPointInShapeSpace(best.faceShape.id, shapeCenter)
	// Store the offset in a "head-relative" frame — un-rotated by however tilted the head is right
	// now — so FaceFeatureBindingUtil can re-rotate it to match the head's tilt on later frames.
	// Otherwise the offset stays aligned to the video's fixed axes and drifts off as the head turns.
	const headRelative = rotateVector(
		shapeCenterInFaceLocal.x - landmarkLocal.x,
		shapeCenterInFaceLocal.y - landmarkLocal.y,
		-best.faceShape.props.faceRotation
	)
	const offsetX = headRelative.x / best.faceShape.props.w
	const offsetY = headRelative.y / best.faceShape.props.h

	// Preserve whatever tilt the shape was dropped at, relative to the current head roll.
	const shapePageRotation = editor.getShapePageTransform(shape.id).rotation()
	const facePageRotation = editor.getShapePageTransform(best.faceShape.id).rotation()
	const rotationOffset = shapePageRotation - facePageRotation - best.faceShape.props.faceRotation

	// Capture the landmark's own scale factor now, so later frames can grow/shrink the shape
	// relative to wherever the user's mouth/eye was at bind time instead of the tracker's absolute
	// closed/open calibration (see FaceFeatureBindingUtil.reposition).
	const landmarkScale = scaleForLandmark(best.landmark, best.faceShape)

	editor.createBinding<FaceFeatureBinding>({
		type: 'face-feature',
		fromId: best.faceShape.id,
		toId: shape.id,
		props: {
			landmark: best.landmark,
			offsetX,
			offsetY,
			rotationOffset,
			baseHeight: editor.getShapeGeometry(shape.id).bounds.height,
			baseWidth: editor.getShapeGeometry(shape.id).bounds.width,
			baseLandmarkScaleX: landmarkScale?.x ?? 1,
			baseLandmarkScaleY: landmarkScale?.y ?? 1,
			secondaryLandmark: '',
			axisMode: 'span',
			baseAxisLength: 0,
			lastAppliedX: shape.x,
			lastAppliedY: shape.y,
			lastAppliedRotation: shape.rotation,
		},
	})
}

/**
 * Attach a shape to the forehead-chin axis in 'follow' mode: capture its current center offset
 * from the axis midpoint (in the axis's own un-rotated frame, normalized by the axis length so it
 * stretches with the head), its rotation relative to the axis angle, and the axis length itself —
 * FaceFeatureBindingUtil reapplies all three against the axis's pose on every tracked frame.
 * Returns false (binding nothing) if either end of the axis isn't currently tracked.
 */
function tryCreateFollowBinding(editor: Editor, shape: TLShape, faceShape: FaceVideoShape): boolean {
	const forehead = faceShape.props.landmarks.forehead
	const chin = faceShape.props.landmarks.chin
	if (!forehead || !chin) return false

	const dx = chin.x - forehead.x
	const dy = chin.y - forehead.y
	const axisLength = Math.hypot(dx, dy)
	if (axisLength < 1) return false
	// Same convention as FaceFeatureBindingUtil: local +y along the axis means "no rotation".
	const axisAngle = Math.atan2(dy, dx) - Math.PI / 2
	const mid = { x: forehead.x + dx / 2, y: forehead.y + dy / 2 }

	const shapeCenter = editor.getShapePageBounds(shape.id)!.center
	const centerInFaceLocal = editor.getPointInShapeSpace(faceShape.id, shapeCenter)
	const offsetInAxisFrame = rotateVector(centerInFaceLocal.x - mid.x, centerInFaceLocal.y - mid.y, -axisAngle)

	const shapePageRotation = editor.getShapePageTransform(shape.id).rotation()
	const facePageRotation = editor.getShapePageTransform(faceShape.id).rotation()

	editor.createBinding<FaceFeatureBinding>({
		type: 'face-feature',
		fromId: faceShape.id,
		toId: shape.id,
		props: {
			landmark: 'forehead',
			offsetX: offsetInAxisFrame.x / axisLength,
			offsetY: offsetInAxisFrame.y / axisLength,
			rotationOffset: shapePageRotation - facePageRotation - axisAngle,
			baseHeight: editor.getShapeGeometry(shape.id).bounds.height,
			baseWidth: editor.getShapeGeometry(shape.id).bounds.width,
			baseLandmarkScaleX: 1,
			baseLandmarkScaleY: 1,
			secondaryLandmark: 'chin',
			axisMode: 'follow',
			baseAxisLength: axisLength,
			lastAppliedX: shape.x,
			lastAppliedY: shape.y,
			lastAppliedRotation: shape.rotation,
		},
	})
	return true
}

/**
 * A drawn stroke big enough to span both the forehead and chin markers is a head outline, not a
 * feature — attach it to both (axis mode) instead of the single nearest landmark. Otherwise: if
 * any point along the shape is over a face-video shape, the nearest landmark on it wins
 * regardless of distance, or else the nearest landmark across all face shapes within
 * snapRadiusPage.
 */
function findSnapCandidate(
	editor: Editor,
	shape: TLShape,
	faceShapes: FaceVideoShape[],
	snapRadiusPage: number
): LandmarkMatch | null {
	const anchorPoints = getSnapAnchorPointsPage(editor, shape)
	if (anchorPoints.length === 0) return null

	if (isDrawableShape(shape)) {
		const headFace = faceShapes.find((faceShape) => strokeSpansHeadAxis(editor, anchorPoints, faceShape))
		if (headFace) {
			return { faceShape: headFace, landmark: 'forehead', secondaryLandmark: 'chin', distance: 0 }
		}
	}

	const overlappingFace = faceShapes.find((faceShape) =>
		anchorPoints.some((point) => isPointOverShape(editor, faceShape, point))
	)

	return overlappingFace
		? nearestLandmark(editor, overlappingFace, anchorPoints, Infinity)
		: bestOf(faceShapes.map((faceShape) => nearestLandmark(editor, faceShape, anchorPoints, snapRadiusPage)))
}

/**
 * Whether a stroke's extent covers both the forehead and chin markers (with HEAD_SPAN_TOLERANCE
 * slack) — the signature of a drawn head outline. Small feature scribbles (an eye, a mouth) fail
 * this by construction: their bounding box can't reach both ends of the face at once.
 */
function strokeSpansHeadAxis(
	editor: Editor,
	anchorPoints: { x: number; y: number }[],
	faceShape: FaceVideoShape
): boolean {
	const forehead = faceShape.props.landmarks.forehead
	const chin = faceShape.props.landmarks.chin
	if (!forehead || !chin) return false

	const transform = editor.getShapePageTransform(faceShape.id)
	const foreheadPage = transform.applyToPoint(forehead)
	const chinPage = transform.applyToPoint(chin)
	const tolerance = Math.hypot(chinPage.x - foreheadPage.x, chinPage.y - foreheadPage.y) * HEAD_SPAN_TOLERANCE

	let minX = Infinity
	let minY = Infinity
	let maxX = -Infinity
	let maxY = -Infinity
	for (const p of anchorPoints) {
		if (p.x < minX) minX = p.x
		if (p.x > maxX) maxX = p.x
		if (p.y < minY) minY = p.y
		if (p.y > maxY) maxY = p.y
	}

	const contains = (p: { x: number; y: number }) =>
		p.x >= minX - tolerance && p.x <= maxX + tolerance && p.y >= minY - tolerance && p.y <= maxY + tolerance
	return contains(foreheadPage) && contains(chinPage)
}

/**
 * The points used to measure distance to a landmark. For draw/highlight shapes this is every
 * point along the stroke (in page space), so a curve that only passes near a landmark at one end
 * — e.g. a chin arc whose bounding-box center sits nearer the mouth — still matches on its
 * closest point rather than its centroid. For arrows it's the two endpoints: an arrow pointing at
 * a landmark from across the canvas has a bounding-box center nowhere near either end, so the
 * centroid fallback would almost always miss. Other shape types fall back to their bounds center.
 */
function getSnapAnchorPointsPage(editor: Editor, shape: TLShape): { x: number; y: number }[] {
	if (isDrawableShape(shape)) {
		const localPoints = getPointsFromDrawSegments(shape.props.segments, shape.props.scaleX, shape.props.scaleY)
		if (localPoints.length > 0) {
			const transform = editor.getShapePageTransform(shape.id)
			return localPoints.map((p) => transform.applyToPoint(p))
		}
	}
	if (isArrowShape(shape)) {
		const transform = editor.getShapePageTransform(shape.id)
		return [transform.applyToPoint(shape.props.start), transform.applyToPoint(shape.props.end)]
	}
	const bounds = editor.getShapePageBounds(shape.id)
	return bounds ? [bounds.center] : []
}

function isArrowShape(shape: TLShape): shape is TLArrowShape {
	return shape.type === 'arrow'
}

/** Rotation-aware "is this page point over the shape's box" test. */
function isPointOverShape(editor: Editor, shape: FaceVideoShape, pagePoint: { x: number; y: number }): boolean {
	const local = editor.getPointInShapeSpace(shape.id, pagePoint)
	return local.x >= 0 && local.x <= shape.props.w && local.y >= 0 && local.y <= shape.props.h
}

function nearestLandmark(
	editor: Editor,
	faceShape: FaceVideoShape,
	points: { x: number; y: number }[],
	maxDistance: number
): LandmarkMatch | null {
	const transform = editor.getShapePageTransform(faceShape.id)
	let best: LandmarkMatch | null = null
	for (const [name, localPt] of Object.entries(faceShape.props.landmarks)) {
		const pagePt = transform.applyToPoint(localPt)
		let distance = Infinity
		for (const point of points) {
			const d = Math.hypot(pagePt.x - point.x, pagePt.y - point.y)
			if (d < distance) distance = d
		}
		if (distance <= maxDistance && (!best || distance < best.distance)) {
			best = { faceShape, landmark: name, distance }
		}
	}
	return best
}

function bestOf(matches: (LandmarkMatch | null)[]): LandmarkMatch | null {
	let best: LandmarkMatch | null = null
	for (const match of matches) {
		if (match && (!best || match.distance < best.distance)) best = match
	}
	return best
}
