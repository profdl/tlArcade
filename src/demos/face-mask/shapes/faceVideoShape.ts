import { DefaultColorStyle, T, type RecordProps, type TLBaseShape, type TLDefaultColorStyle } from 'tldraw'

/** A landmark position in the face-video shape's own local px space (0..w, 0..h). */
export type ShapeLocalPoint = { x: number; y: number }

export type FaceVideoShapeProps = {
	w: number
	h: number
	/** Latest tracked landmark positions, in this shape's local space. Empty when no face is found. */
	landmarks: Record<string, ShapeLocalPoint>
	/** Head roll (radians) measured from the eye line, in this shape's own local space. Holds its last value when no face is found. */
	faceRotation: number
	/** How open the mouth is, as a scale factor (~0.02 closed to ~1.1 wide open). Holds its last value when no face is found. */
	mouthScale: number
	/** How wide the mouth is (corner to corner), as a scale factor (~0.5 pursed to ~1.1 wide/smiling). Holds its last value when no face is found. */
	mouthWidthScale: number
	/** Vertical scale for eye-pinned shapes, driven by a synthetic blink animation (not real eye tracking) — ~0.02 mid-blink, 1 open. */
	eyeScale: number
	/** Whether tracked-feature dots are drawn over the video. Tracking itself keeps running either way. */
	showMarkers: boolean
	/** Whether the camera feed is drawn at all. When off, the shape renders as a plain color fill. */
	showVideo: boolean
	/** Fill color used when the video feed is hidden. */
	color: TLDefaultColorStyle
}

export type FaceVideoShape = TLBaseShape<'face-video', FaceVideoShapeProps>

// Register with tldraw's shape type union so Editor methods (getShape, createShape, etc.)
// accept and narrow to FaceVideoShape without manual casts everywhere.
declare module '@tldraw/tlschema' {
	interface TLGlobalShapePropsMap {
		'face-video': FaceVideoShapeProps
	}
}

export const faceVideoShapeProps: RecordProps<FaceVideoShape> = {
	w: T.nonZeroNumber,
	h: T.nonZeroNumber,
	landmarks: T.dict(T.string, T.object({ x: T.number, y: T.number })),
	faceRotation: T.number,
	mouthScale: T.number,
	mouthWidthScale: T.number,
	eyeScale: T.number,
	showMarkers: T.boolean,
	showVideo: T.boolean,
	color: DefaultColorStyle,
}

// Faces (and the padded box computeFaceCrop frames them with) are portrait-shaped, not the old
// 4:3 landscape default — narrower here means the auto-crop doesn't have to pad out extra empty
// width just to satisfy the shape's aspect ratio.
export const FACE_VIDEO_DEFAULT_W = 400
export const FACE_VIDEO_DEFAULT_H = 480
