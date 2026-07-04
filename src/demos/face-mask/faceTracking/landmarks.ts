/**
 * Named anchor points into MediaPipe FaceLandmarker's 478-point face mesh
 * (468 mesh vertices + 10 iris points, present when refineLandmarks is on).
 * Indices are MediaPipe's canonical topology — see
 * https://storage.googleapis.com/mediapipe-assets/documentation/mediapipe_face_landmark_fullsize.png
 *
 * Raw indices are anatomical (subject-relative), not screen-relative — the
 * demo mirrors the video for a selfie-style view, so "eyeA"/"eyeB" are
 * deliberately unlabeled left/right. Snap-target UI can distinguish them by
 * comparing mirrored x position at runtime if it ever needs to.
 */
export type NormalizedPoint = { x: number; y: number }

const singleIndex = (i: number) => [i]

/** landmark name -> the mesh vertex indices to average for its anchor point */
export const NAMED_LANDMARKS: Record<string, number[]> = {
	eyeA: singleIndex(468), // left iris center
	eyeB: singleIndex(473), // right iris center
	noseTip: singleIndex(1),
	mouthCenter: [13, 14], // upper/lower inner lip center
	chin: singleIndex(152),
	forehead: singleIndex(10),
	eyebrowA: singleIndex(105),
	eyebrowB: singleIndex(334),
	// Face-oval extremes — used for the auto-framing bounding box, and left in
	// as valid snap targets too (they land roughly at the cheeks/jawline).
	cheekA: singleIndex(234),
	cheekB: singleIndex(454),
}

/** Landmarks used to compute a face bounding box for auto-zoom framing. */
export const FACE_BOUNDS_LANDMARKS = ['cheekA', 'cheekB', 'forehead', 'chin'] as const

export type LandmarkName = keyof typeof NAMED_LANDMARKS

/**
 * How far above the forehead the synthetic 'head' marker floats, as a fraction of the
 * forehead-chin distance. Far enough to clear the forehead marker as a distinct snap target,
 * close enough to stay inside the auto-crop's padding (and thus on screen).
 */
const HEAD_MARKER_OFFSET = 0.15

/** Resolve every named anchor to a normalized (0..1) point from a raw mesh. */
export function resolveNamedLandmarks(
	mesh: NormalizedPoint[]
): Record<string, NormalizedPoint> {
	const out: Record<string, NormalizedPoint> = {}
	for (const [name, indices] of Object.entries(NAMED_LANDMARKS)) {
		let x = 0
		let y = 0
		let count = 0
		for (const i of indices) {
			const p = mesh[i]
			if (!p) continue
			x += p.x
			y += p.y
			count++
		}
		if (count > 0) {
			out[name] = { x: x / count, y: y / count }
		}
	}

	// Synthetic 'head' marker — an explicit snap target for attaching whole-head shapes, which
	// bind to the forehead+chin axis (see snapToFace) rather than to a single point. It floats
	// just above the forehead along the head's own chin->forehead axis: the geometric center of
	// the head would sit right on top of the noseTip marker, making both unhittable.
	const forehead = out.forehead
	const chin = out.chin
	if (forehead && chin) {
		out.head = {
			x: forehead.x + (forehead.x - chin.x) * HEAD_MARKER_OFFSET,
			y: forehead.y + (forehead.y - chin.y) * HEAD_MARKER_OFFSET,
		}
	}
	return out
}

export type PixelBounds = { minX: number; minY: number; maxX: number; maxY: number }

/**
 * A rough face bounding box in raw video pixel space, from a handful of
 * face-oval landmarks. Returns null until all of them are visible.
 */
export function faceBoundsPx(
	landmarks: Record<string, NormalizedPoint>,
	videoW: number,
	videoH: number
): PixelBounds | null {
	let minX = Infinity
	let minY = Infinity
	let maxX = -Infinity
	let maxY = -Infinity
	for (const name of FACE_BOUNDS_LANDMARKS) {
		const p = landmarks[name]
		if (!p) return null
		const px = p.x * videoW
		const py = p.y * videoH
		if (px < minX) minX = px
		if (px > maxX) maxX = px
		if (py < minY) minY = py
		if (py > maxY) maxY = py
	}
	return { minX, minY, maxX, maxY }
}

const MOUTH_TOP_IDX = 13 // upper inner lip center
const MOUTH_BOTTOM_IDX = 14 // lower inner lip center
const MOUTH_CORNER_A_IDX = 61 // mouth corner
const MOUTH_CORNER_B_IDX = 291 // mouth corner
const EYE_A_IDX = 468 // left iris center
const EYE_B_IDX = 473 // right iris center

function distancePx(mesh: NormalizedPoint[], a: number, b: number, videoW: number, videoH: number): number | null {
	const pa = mesh[a]
	const pb = mesh[b]
	if (!pa || !pb) return null
	return Math.hypot((pa.x - pb.x) * videoW, (pa.y - pb.y) * videoH)
}

/**
 * How far apart the lips are, as a fraction of interocular distance (so it stays roughly
 * constant regardless of how close the face is to the camera). Null until all four points
 * needed are visible.
 */
export function mouthOpenRatio(mesh: NormalizedPoint[], videoW: number, videoH: number): number | null {
	const lipDist = distancePx(mesh, MOUTH_TOP_IDX, MOUTH_BOTTOM_IDX, videoW, videoH)
	const eyeDist = distancePx(mesh, EYE_A_IDX, EYE_B_IDX, videoW, videoH)
	if (lipDist === null || !eyeDist) return null
	return lipDist / eyeDist
}

/**
 * How far apart the mouth corners are (narrow/pursed vs. wide/smiling), as a fraction of
 * interocular distance. Null until all four points needed are visible.
 */
export function mouthWidthRatio(mesh: NormalizedPoint[], videoW: number, videoH: number): number | null {
	const cornerDist = distancePx(mesh, MOUTH_CORNER_A_IDX, MOUTH_CORNER_B_IDX, videoW, videoH)
	const eyeDist = distancePx(mesh, EYE_A_IDX, EYE_B_IDX, videoW, videoH)
	if (cornerDist === null || !eyeDist) return null
	return cornerDist / eyeDist
}
