import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'
const MODEL_URL =
	'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

let landmarkerPromise: Promise<FaceLandmarker> | null = null

/**
 * A single video-mode FaceLandmarker configured for VTuber rigging: unlike the
 * face-mask demo's tracker, this one turns ON the two outputs a puppet needs —
 * the 52 ARKit-style blendshape scores (jawOpen, eyeBlink*, browUp*, mouthSmile*,
 * …) and the 4x4 facial transformation matrix (head pose: translation + rotation).
 */
function getLandmarker(): Promise<FaceLandmarker> {
	if (!landmarkerPromise) {
		landmarkerPromise = FilesetResolver.forVisionTasks(WASM_BASE).then((fileset) =>
			FaceLandmarker.createFromOptions(fileset, {
				baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
				runningMode: 'VIDEO',
				numFaces: 1,
				outputFaceBlendshapes: true,
				outputFacialTransformationMatrixes: true,
			})
		)
	}
	return landmarkerPromise
}

/** Head pose decomposed from the facial transformation matrix, in radians / normalized units. */
export type HeadPose = {
	/** Look up (+) / down (-). */
	pitch: number
	/** Turn left (+) / right (-), viewer-relative after mirroring. */
	yaw: number
	/** Head tilt / roll. */
	roll: number
	/** Face center in normalized viewport space (0..1), for body-position follow. */
	x: number
	y: number
}

export type FaceFrame = {
	found: boolean
	/** ARKit-style blendshape scores keyed by name (0..1). Empty when no face. */
	blendshapes: Record<string, number>
	/** Decomposed head pose. Null when no face this frame. */
	pose: HeadPose | null
}

const NOT_FOUND: FaceFrame = { found: false, blendshapes: {}, pose: null }

/** Decompose the row-major 4x4 transformation matrix into Euler angles + screen position. */
function decomposePose(matrix: number[]): HeadPose {
	// Column-major layout from MediaPipe: rotation in the upper-left 3x3.
	const m = matrix
	const yaw = Math.atan2(-m[8], Math.hypot(m[9], m[10]))
	const pitch = Math.atan2(m[9], m[10])
	const roll = Math.atan2(m[4], m[0])
	// Translation (m[12], m[13]) is in the model's metric space; normalize loosely to 0..1.
	const x = 0.5 + (m[12] ?? 0) / 40
	const y = 0.5 + (m[13] ?? 0) / 40
	return { pitch, yaw, roll, x, y }
}

/**
 * Detect a face on one video frame and return VTuber-ready params. `timestampMs`
 * must be monotonically increasing per landmarker instance (video mode).
 */
export async function trackFace(video: HTMLVideoElement, timestampMs: number): Promise<FaceFrame> {
	const landmarker = await getLandmarker()
	const result = landmarker.detectForVideo(video, timestampMs)
	const mesh = result.faceLandmarks[0]
	if (!mesh) return NOT_FOUND

	const blendshapes: Record<string, number> = {}
	const categories = result.faceBlendshapes?.[0]?.categories
	if (categories) {
		for (const c of categories) blendshapes[c.categoryName] = c.score
	}

	const matrix = result.facialTransformationMatrixes?.[0]?.data
	const pose = matrix ? decomposePose(Array.from(matrix)) : null

	return { found: true, blendshapes, pose }
}
