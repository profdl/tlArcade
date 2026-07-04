import { createShapeId, type Editor, type TLDefaultColorStyle, type TLGeoShapeProps, type TLShapeId } from 'tldraw'
import type { FaceFeatureBinding } from './bindings/faceFeatureBinding'
import { FACE_VIDEO_DEFAULT_H, FACE_VIDEO_DEFAULT_W } from './shapes/faceVideoShape'

const HEAD_W = 210
const HEAD_H = 280
const STICKER_SIZE = HEAD_W * 0.2 // scale with the head oval, so features aren't a fixed size regardless of how big the head is

type DefaultFeature = {
	landmark: string
	/** When set, the shape spans both landmarks (see FaceFeatureBindingUtil's axis mode) instead of following just `landmark`. */
	secondaryLandmark?: string
	geo: TLGeoShapeProps['geo']
	nx: number
	ny: number
	w: number
	h: number
	color: TLDefaultColorStyle
}

// Rough default face proportions, used only until real tracking data repositions these —
// landmarks aren't known yet at creation time, so this just avoids an initial pile-up.
// The head oval is listed first so it's created (and z-ordered) behind the other features. Its
// size/position matches computeFaceCrop's own math (default shape aspect, PADDING_FACTOR, and a
// ~0.75 typical cheek-width-to-face-height ratio), so it reaches from forehead to chin and
// cheek to cheek — the same box the auto-crop frames once real tracking takes over. It spans
// forehead<->chin (axis mode) so it stretches to stay attached to both as the jaw drops, rather
// than following one point at a fixed size.
const DEFAULT_FEATURES: DefaultFeature[] = [
	{ landmark: 'forehead', secondaryLandmark: 'chin', geo: 'ellipse', nx: 0.5, ny: 0.5, w: HEAD_W, h: HEAD_H, color: 'green' },
	{ landmark: 'eyeA', geo: 'star', nx: 0.32, ny: 0.38, w: STICKER_SIZE, h: STICKER_SIZE, color: 'violet' },
	{ landmark: 'eyeB', geo: 'star', nx: 0.68, ny: 0.38, w: STICKER_SIZE, h: STICKER_SIZE, color: 'violet' },
	{ landmark: 'noseTip', geo: 'ellipse', nx: 0.5, ny: 0.55, w: STICKER_SIZE, h: STICKER_SIZE, color: 'violet' },
	{ landmark: 'mouthCenter', geo: 'rectangle', nx: 0.5, ny: 0.75, w: STICKER_SIZE, h: STICKER_SIZE, color: 'violet' },
]

/** Pins a head oval, a star to each eye, a circle to the nose, and a rectangle to the mouth on a fresh face-video shape. */
export function addDefaultFaceFeatures(editor: Editor, faceShapeId: TLShapeId, faceX: number, faceY: number) {
	for (const feature of DEFAULT_FEATURES) {
		const stickerId = createShapeId()
		const x = faceX + feature.nx * FACE_VIDEO_DEFAULT_W - feature.w / 2
		const y = faceY + feature.ny * FACE_VIDEO_DEFAULT_H - feature.h / 2

		editor.createShape({
			id: stickerId,
			type: 'geo',
			x,
			y,
			props: { geo: feature.geo, w: feature.w, h: feature.h, color: feature.color, fill: 'solid' },
		})

		editor.createBinding<FaceFeatureBinding>({
			type: 'face-feature',
			fromId: faceShapeId,
			toId: stickerId,
			props: {
				landmark: feature.landmark,
				offsetX: 0,
				offsetY: 0,
				rotationOffset: 0,
				baseHeight: feature.h,
				baseWidth: feature.w,
				baseLandmarkScaleX: 1,
				baseLandmarkScaleY: 1,
				secondaryLandmark: feature.secondaryLandmark ?? '',
				axisMode: 'span',
				baseAxisLength: 0,
				lastAppliedX: x,
				lastAppliedY: y,
				lastAppliedRotation: 0,
			},
		})
	}
}
