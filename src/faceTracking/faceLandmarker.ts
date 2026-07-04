import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import { mouthOpenRatio, mouthWidthRatio, resolveNamedLandmarks, type NormalizedPoint } from './landmarks'

const WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm'
const MODEL_URL =
	'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

let landmarkerPromise: Promise<FaceLandmarker> | null = null

/** Lazily creates (and reuses) a single video-mode FaceLandmarker instance. */
function getLandmarker(): Promise<FaceLandmarker> {
	if (!landmarkerPromise) {
		landmarkerPromise = FilesetResolver.forVisionTasks(WASM_BASE).then((fileset) =>
			FaceLandmarker.createFromOptions(fileset, {
				baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
				runningMode: 'VIDEO',
				numFaces: 1,
				outputFaceBlendshapes: false,
				outputFacialTransformationMatrixes: false,
			})
		)
	}
	return landmarkerPromise
}

export type FaceDetectionResult = {
	found: boolean
	landmarks: Record<string, NormalizedPoint>
	/** Lip separation as a fraction of interocular distance. Null if not computable this frame. */
	mouthOpenRatio: number | null
	/** Mouth corner-to-corner distance as a fraction of interocular distance. Null if not computable this frame. */
	mouthWidthRatio: number | null
}

const NOT_FOUND: FaceDetectionResult = { found: false, landmarks: {}, mouthOpenRatio: null, mouthWidthRatio: null }

/**
 * Runs face landmark detection on a single video frame. `timestampMs` must
 * be monotonically increasing per FaceLandmarker instance (video mode).
 */
export async function detectFace(
	video: HTMLVideoElement,
	timestampMs: number
): Promise<FaceDetectionResult> {
	const landmarker = await getLandmarker()
	const result = landmarker.detectForVideo(video, timestampMs)
	const mesh = result.faceLandmarks[0]
	if (!mesh) return NOT_FOUND
	return {
		found: true,
		landmarks: resolveNamedLandmarks(mesh),
		mouthOpenRatio: mouthOpenRatio(mesh, video.videoWidth, video.videoHeight),
		mouthWidthRatio: mouthWidthRatio(mesh, video.videoWidth, video.videoHeight),
	}
}
