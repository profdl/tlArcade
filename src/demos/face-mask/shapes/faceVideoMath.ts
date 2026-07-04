import type { PixelBounds } from '../faceTracking/landmarks'
import type { FaceVideoShape, ShapeLocalPoint } from './faceVideoShape'

/** A source rectangle (raw video pixel space) to draw into the shape's box. */
export type CropRect = { x0: number; y0: number; w: number; h: number }

const PADDING_FACTOR = 0.35 // breathing room around the face, as a fraction of its (padded) size — applied equally on all four sides so the crop stays centered on the face

/** The largest `shapeAspect`-shaped crop centered in the full video frame — used before a face is found. */
export function defaultFullFrameCrop(videoW: number, videoH: number, shapeAspect: number): CropRect {
	let w: number
	let h: number
	if (videoW / videoH > shapeAspect) {
		h = videoH
		w = h * shapeAspect
	} else {
		w = videoW
		h = w / shapeAspect
	}
	return { x0: (videoW - w) / 2, y0: (videoH - h) / 2, w, h }
}

/**
 * A `shapeAspect`-shaped crop that frames a detected face, padded and clamped to the video
 * bounds. Uses "cover" fit — the padded face box is clamped tight to whichever axis the shape's
 * aspect ratio constrains, so the face (and thus its landmark markers) fills as much of the shape
 * as possible. The crop is never allowed to shrink past `bounds` itself, though — the cheek/
 * forehead/chin landmarks (and everything between them: eyes, nose, mouth) always stay fully
 * in frame, even if that means falling back off the tightest possible zoom. Padding is added
 * equally on all sides, so (barring a face near the edge of the webcam frame) the crop is
 * centered on `bounds` — equal space above and below the topmost/bottommost markers.
 */
export function computeFaceCrop(
	bounds: PixelBounds,
	videoW: number,
	videoH: number,
	shapeAspect: number
): CropRect {
	const requiredW = bounds.maxX - bounds.minX
	const requiredH = bounds.maxY - bounds.minY

	let { minX, minY, maxX, maxY } = bounds
	const pad = Math.max(requiredW, requiredH) * PADDING_FACTOR
	minX -= pad
	maxX += pad
	minY -= pad
	maxY += pad

	const centerX = (minX + maxX) / 2
	const centerY = (minY + maxY) / 2
	const desiredW = maxX - minX
	const desiredH = maxY - minY

	let w: number
	let h: number
	if (desiredW / desiredH > shapeAspect) {
		h = desiredH
		w = h * shapeAspect
	} else {
		w = desiredW
		h = w / shapeAspect
	}

	// The cover-fit above can crop tighter than `bounds` itself (e.g. cutting off the chin) when
	// the shape's aspect ratio is a poor match for the face's. Floor the crop at the smallest
	// shapeAspect-shaped box that still fully contains the raw landmark bounds.
	if (requiredW / requiredH > shapeAspect) {
		w = Math.max(w, requiredW)
		h = w / shapeAspect
	} else {
		h = Math.max(h, requiredH)
		w = h * shapeAspect
	}

	// Can't zoom out past the full frame.
	w = Math.min(w, videoW)
	h = Math.min(h, videoH)
	if (w / h > shapeAspect) w = h * shapeAspect
	else h = w / shapeAspect

	// Clamp the position so the crop stays inside the video frame *and* keeps `bounds` fully
	// inside the crop. These ranges always overlap: `bounds` sits inside the video frame, and w/h
	// are now at least as big as `bounds` itself.
	const x0 = clamp(centerX - w / 2, Math.max(0, bounds.maxX - w), Math.min(videoW - w, bounds.minX))
	const y0 = clamp(centerY - h / 2, Math.max(0, bounds.maxY - h), Math.min(videoH - h, bounds.minY))

	return { x0, y0, w, h }
}

export function lerpCrop(a: CropRect, b: CropRect, t: number): CropRect {
	return {
		x0: a.x0 + (b.x0 - a.x0) * t,
		y0: a.y0 + (b.y0 - a.y0) * t,
		w: a.w + (b.w - a.w) * t,
		h: a.h + (b.h - a.h) * t,
	}
}

/**
 * Maps a raw video pixel point through a crop rect into the shape's local px
 * space, mirroring horizontally (selfie view) to match how the crop is drawn.
 */
export function mapRawPxToShapeLocal(
	x: number,
	y: number,
	crop: CropRect,
	shapeW: number,
	shapeH: number
): ShapeLocalPoint {
	const unmirroredX = ((x - crop.x0) / crop.w) * shapeW
	const localY = ((y - crop.y0) / crop.h) * shapeH
	return { x: shapeW - unmirroredX, y: localY }
}

function clamp(v: number, min: number, max: number): number {
	return Math.min(Math.max(v, min), max)
}

/** Rotates a 2D vector by `angle` radians. */
export function rotateVector(dx: number, dy: number, angle: number): { x: number; y: number } {
	const cos = Math.cos(angle)
	const sin = Math.sin(angle)
	return { x: dx * cos - dy * sin, y: dx * sin + dy * cos }
}

/**
 * The (width, height) scale factor a landmark drives on its own, or null for landmarks with no
 * expression behavior. These scales are absolute — calibrated against a fixed closed/open range,
 * not relative to any particular user's mouth — so callers that want shapes to scale relative to
 * where the user's mouth was at bind time must divide by the scale captured at that moment.
 */
export function scaleForLandmark(landmark: string, faceShape: FaceVideoShape): { x: number; y: number } | null {
	if (landmark === 'mouthCenter') {
		return { x: faceShape.props.mouthWidthScale, y: faceShape.props.mouthScale }
	}
	if (landmark === 'eyeA' || landmark === 'eyeB') {
		return { x: 1, y: faceShape.props.eyeScale }
	}
	return null
}
