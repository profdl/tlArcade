import { useEffect, useRef, useState } from 'react'
import { BaseBoxShapeUtil, HTMLContainer, useEditor } from 'tldraw'
import { dragSnapCandidateAtom } from '../dragSnapPreview'
import { detectFace } from '../faceTracking/faceLandmarker'
import { faceBoundsPx, type NormalizedPoint } from '../faceTracking/landmarks'
import { computeFaceCrop, defaultFullFrameCrop, lerpCrop, mapRawPxToShapeLocal, type CropRect } from './faceVideoMath'
import {
	FACE_VIDEO_DEFAULT_H,
	FACE_VIDEO_DEFAULT_W,
	faceVideoShapeProps,
	type FaceVideoShape,
	type ShapeLocalPoint,
} from './faceVideoShape'

const DETECT_INTERVAL_MS = 66 // ~15fps — inference is the expensive part, not the draw loop
const CROP_FOLLOW_FACTOR = 0.12 // per-frame lerp toward the target crop — smooths out zoom/pan jitter

// Calibration for mouthOpenRatio (lip separation / interocular distance) -> mouth scale.
// These are rough defaults, not measured — tune if a real face tracks noticeably off.
const MOUTH_CLOSED_RATIO = 0.02
const MOUTH_OPEN_RATIO = 0.45
const MOUTH_SCALE_MIN = 0.02
const MOUTH_SCALE_MAX = 1.1

function mouthRatioToScale(ratio: number): number {
	const t = clamp((ratio - MOUTH_CLOSED_RATIO) / (MOUTH_OPEN_RATIO - MOUTH_CLOSED_RATIO), 0, 1)
	return MOUTH_SCALE_MIN + t * (MOUTH_SCALE_MAX - MOUTH_SCALE_MIN)
}

// Calibration for mouthWidthRatio (corner-to-corner distance / interocular distance) -> width scale.
const MOUTH_NARROW_RATIO = 0.7
const MOUTH_WIDE_RATIO = 1.3
const MOUTH_WIDTH_SCALE_MIN = 0.5
const MOUTH_WIDTH_SCALE_MAX = 1.1

function mouthWidthRatioToScale(ratio: number): number {
	const t = clamp((ratio - MOUTH_NARROW_RATIO) / (MOUTH_WIDE_RATIO - MOUTH_NARROW_RATIO), 0, 1)
	return MOUTH_WIDTH_SCALE_MIN + t * (MOUTH_WIDTH_SCALE_MAX - MOUTH_WIDTH_SCALE_MIN)
}

function clamp(v: number, min: number, max: number): number {
	return Math.min(Math.max(v, min), max)
}

const LANDMARK_EPSILON_PX = 0.05 // below this, treat re-mapped landmarks as "unchanged" (skip the store write)

/** Compares by key and (x, y), not reference — the crop's lerp asymptotically approaches its target and would otherwise trigger a store write on essentially every frame, forever. */
function landmarksRoughlyEqual(a: Record<string, ShapeLocalPoint>, b: Record<string, ShapeLocalPoint>): boolean {
	const aKeys = Object.keys(a)
	if (aKeys.length !== Object.keys(b).length) return false
	for (const key of aKeys) {
		const pa = a[key]
		const pb = b[key]
		if (!pb || Math.abs(pa.x - pb.x) > LANDMARK_EPSILON_PX || Math.abs(pa.y - pb.y) > LANDMARK_EPSILON_PX) return false
	}
	return true
}

// Synthetic blink animation — not driven by real eye tracking. Eyes scale down to
// EYE_SCALE_CLOSED and back to EYE_SCALE_OPEN on a semi-random schedule, for a natural look.
const EYE_SCALE_OPEN = 1
const EYE_SCALE_CLOSED = 0.02
const BLINK_DURATION_MS = 150
const BLINK_MIN_INTERVAL_MS = 2000
const BLINK_MAX_INTERVAL_MS = 6000

function randomBlinkInterval(): number {
	return BLINK_MIN_INTERVAL_MS + Math.random() * (BLINK_MAX_INTERVAL_MS - BLINK_MIN_INTERVAL_MS)
}

/** Tracks blink timing across ticks; call `update(now)` every frame for the current eye scale. */
function createBlinkAnimator(nowMs: number) {
	let nextBlinkAt = nowMs + randomBlinkInterval()
	let blinkStartedAt: number | null = null

	return {
		update(now: number): number {
			if (blinkStartedAt === null) {
				if (now < nextBlinkAt) return EYE_SCALE_OPEN
				blinkStartedAt = now
			}
			const elapsed = now - blinkStartedAt
			if (elapsed >= BLINK_DURATION_MS) {
				blinkStartedAt = null
				nextBlinkAt = now + randomBlinkInterval()
				return EYE_SCALE_OPEN
			}
			// Trapezoidal profile: close (40%) -> hold fully closed (20%) -> reopen (40%). The hold
			// phase guarantees a few frames land at EYE_SCALE_CLOSED regardless of frame timing —
			// an instantaneous triangular peak can otherwise get skipped between frames.
			const t = elapsed / BLINK_DURATION_MS
			let closedness: number
			if (t < 0.4) closedness = t / 0.4
			else if (t < 0.6) closedness = 1
			else closedness = (1 - t) / 0.4
			return EYE_SCALE_OPEN - closedness * (EYE_SCALE_OPEN - EYE_SCALE_CLOSED)
		},
	}
}

export class FaceVideoShapeUtil extends BaseBoxShapeUtil<FaceVideoShape> {
	static override type = 'face-video' as const
	static override props = faceVideoShapeProps

	override canEdit() {
		return false
	}

	override getDefaultProps(): FaceVideoShape['props'] {
		return {
			w: FACE_VIDEO_DEFAULT_W,
			h: FACE_VIDEO_DEFAULT_H,
			landmarks: {},
			faceRotation: 0,
			mouthScale: 1,
			mouthWidthScale: 1,
			eyeScale: 1,
			showMarkers: true,
			showVideo: false,
			color: 'orange',
		}
	}

	override getIndicatorPath(shape: FaceVideoShape) {
		const path = new Path2D()
		path.rect(0, 0, shape.props.w, shape.props.h)
		return path
	}

	component(shape: FaceVideoShape) {
		return <FaceVideoShapeComponent shape={shape} />
	}
}

type CameraStatus = 'requesting' | 'ready' | 'denied' | 'error'

function FaceVideoShapeComponent({ shape }: { shape: FaceVideoShape }) {
	const editor = useEditor()
	const videoRef = useRef<HTMLVideoElement>(null)
	const canvasRef = useRef<HTMLCanvasElement>(null)
	const [status, setStatus] = useState<CameraStatus>('requesting')
	const [errorMessage, setErrorMessage] = useState<string | null>(null)
	const [retryToken, setRetryToken] = useState(0)

	// Acquire (and release) the webcam stream.
	useEffect(() => {
		let cancelled = false
		let stream: MediaStream | null = null
		setStatus('requesting')
		setErrorMessage(null)

		navigator.mediaDevices
			.getUserMedia({ video: { facingMode: 'user' }, audio: false })
			.then((s) => {
				if (cancelled) {
					s.getTracks().forEach((t) => t.stop())
					return
				}
				stream = s
				if (videoRef.current) {
					videoRef.current.srcObject = s
					videoRef.current.play().catch(() => {})
				}
				setStatus('ready')
			})
			.catch((err: unknown) => {
				if (cancelled) return
				const name = err instanceof DOMException ? err.name : ''
				setStatus(name === 'NotAllowedError' || name === 'PermissionDeniedError' ? 'denied' : 'error')
				setErrorMessage(err instanceof Error ? err.message : String(err))
			})

		return () => {
			cancelled = true
			stream?.getTracks().forEach((t) => t.stop())
		}
	}, [retryToken])

	// Draw + track loop: every video frame we redraw the (smoothed) crop, but only
	// run the expensive ML detection at DETECT_INTERVAL_MS.
	useEffect(() => {
		if (status !== 'ready') return
		const video = videoRef.current
		const canvas = canvasRef.current
		if (!video || !canvas) return

		let stopped = false
		let handle = 0
		let lastDetectTime = 0
		let targetCrop: CropRect | null = null
		let smoothedCrop: CropRect | null = null
		// Raw, crop-independent tracked positions (normalized 0..1 video space) from the last
		// detection. Re-mapped into shape-local space every tick below, against whatever the crop
		// currently is — not just at detection time, since the crop keeps smoothing toward its
		// target on every frame in between (see the re-map comment further down).
		let lastRawLandmarks: Record<string, NormalizedPoint> = {}
		let lastLandmarks: Record<string, ShapeLocalPoint> = {}
		let lastWrittenLandmarks: Record<string, ShapeLocalPoint> = {}
		let lastWrittenEyeScale = 1
		const blinkAnimator = createBlinkAnimator(performance.now())
		const hasRvfc = 'requestVideoFrameCallback' in video

		const scheduleNext = () => {
			if (stopped) return
			handle = hasRvfc ? (video as any).requestVideoFrameCallback(tick) : requestAnimationFrame(tick)
		}

		const tick = async () => {
			if (stopped) return
			const vw = video.videoWidth
			const vh = video.videoHeight
			const currentShape = editor.getShape(shape.id) as FaceVideoShape | undefined

			if (vw && vh && currentShape && video.readyState >= 2) {
				const shapeAspect = currentShape.props.w / currentShape.props.h
				if (!targetCrop) targetCrop = defaultFullFrameCrop(vw, vh, shapeAspect)
				if (!smoothedCrop) smoothedCrop = targetCrop

				const nowMs = performance.now()
				if (nowMs - lastDetectTime >= DETECT_INTERVAL_MS) {
					lastDetectTime = nowMs
					const result = await detectFace(video, nowMs)
					if (stopped) return

					if (result.found) {
						const bounds = faceBoundsPx(result.landmarks, vw, vh)
						if (bounds) targetCrop = computeFaceCrop(bounds, vw, vh, shapeAspect)
					}
					lastRawLandmarks = result.landmarks

					const propsPatch: Partial<FaceVideoShape['props']> = {}
					if (result.mouthOpenRatio !== null) {
						propsPatch.mouthScale = mouthRatioToScale(result.mouthOpenRatio)
					}
					if (result.mouthWidthRatio !== null) {
						propsPatch.mouthWidthScale = mouthWidthRatioToScale(result.mouthWidthRatio)
					}
					if (Object.keys(propsPatch).length > 0) {
						editor.run(
							() => {
								editor.updateShape<FaceVideoShape>({ id: shape.id, type: 'face-video', props: propsPatch })
							},
							{ history: 'ignore' }
						)
					}
				}

				// The crop keeps smoothing toward its target every frame, independent of the
				// (throttled) detection cadence above — so re-map the last known raw positions
				// through it every frame too. Baking a stale crop into `landmarks` only at
				// detection time let markers visibly drift off the video during fast head
				// movement, snapping back into place only when detection next ran.
				smoothedCrop = lerpCrop(smoothedCrop, targetCrop, CROP_FOLLOW_FACTOR)
				lastLandmarks = {}
				for (const [name, pt] of Object.entries(lastRawLandmarks)) {
					lastLandmarks[name] = mapRawPxToShapeLocal(pt.x * vw, pt.y * vh, smoothedCrop, currentShape.props.w, currentShape.props.h)
				}

				// Roll, from the eye line — omitted (holds its last value) when either eye isn't visible.
				const eyeA = lastLandmarks.eyeA
				const eyeB = lastLandmarks.eyeB
				const faceRotation = eyeA && eyeB ? Math.atan2(eyeB.y - eyeA.y, eyeB.x - eyeA.x) : undefined

				if (!landmarksRoughlyEqual(lastLandmarks, lastWrittenLandmarks)) {
					lastWrittenLandmarks = lastLandmarks
					editor.run(
						() => {
							editor.updateShape<FaceVideoShape>({
								id: shape.id,
								type: 'face-video',
								props: { landmarks: lastLandmarks, ...(faceRotation !== undefined ? { faceRotation } : {}) },
							})
						},
						{ history: 'ignore' }
					)
				}

				// Blinking runs every frame (not gated by DETECT_INTERVAL_MS) so the ~150ms blink itself looks smooth.
				const eyeScale = blinkAnimator.update(nowMs)
				if (Math.abs(eyeScale - lastWrittenEyeScale) > 0.001) {
					lastWrittenEyeScale = eyeScale
					editor.run(
						() => {
							editor.updateShape<FaceVideoShape>({ id: shape.id, type: 'face-video', props: { eyeScale } })
						},
						{ history: 'ignore' }
					)
				}

				// An axis binding (forehead+chin) occupies both its landmarks and the synthetic
				// 'head' marker that stands for the pair.
				const boundLandmarks = new Set<string>()
				for (const b of editor.getBindingsFromShape(shape.id, 'face-feature')) {
					boundLandmarks.add(b.props.landmark)
					if (b.props.secondaryLandmark) {
						boundLandmarks.add(b.props.secondaryLandmark)
						boundLandmarks.add('head')
					}
				}
				const dragCandidate = dragSnapCandidateAtom.get()
				// A head outline attaches to two landmarks at once (forehead+chin) — halo both. The
				// 'head' marker stands for that same pair, so hovering it halos all three.
				const hoverLandmarks =
					dragCandidate?.faceShapeId === shape.id
						? new Set([dragCandidate.landmark, ...(dragCandidate.secondaryLandmark ? [dragCandidate.secondaryLandmark] : [])])
						: null
				if (hoverLandmarks?.has('head')) {
					hoverLandmarks.add('forehead')
					hoverLandmarks.add('chin')
				}
				drawFrame({
					canvas,
					video,
					crop: smoothedCrop,
					landmarks: lastLandmarks,
					boundLandmarks,
					hoverLandmarks,
					showVideo: currentShape.props.showVideo,
					showMarkers: currentShape.props.showMarkers,
					w: currentShape.props.w,
					h: currentShape.props.h,
				})
			}

			scheduleNext()
		}

		scheduleNext()

		return () => {
			stopped = true
			if (hasRvfc) (video as any).cancelVideoFrameCallback(handle)
			else cancelAnimationFrame(handle)
		}
	}, [status, editor, shape.id])

	const colors = editor.getCurrentTheme().colors[editor.getColorMode()]
	const fillColor = colors[shape.props.color]?.solid ?? colors.black.solid

	return (
		<HTMLContainer id={shape.id} style={{ overflow: 'hidden', width: shape.props.w, height: shape.props.h }}>
			<div
				style={{
					position: 'relative',
					width: '100%',
					height: '100%',
					background: shape.props.showVideo ? 'var(--tl-color-low)' : fillColor,
					borderRadius: 4,
				}}
			>
				{/* Hidden decode source for both MediaPipe and canvas drawImage — the canvas below is what's shown. */}
				<video ref={videoRef} muted playsInline style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }} />
				<canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
				{shape.props.showVideo && status !== 'ready' && (
					<div
						style={{
							position: 'absolute',
							inset: 0,
							display: 'flex',
							flexDirection: 'column',
							alignItems: 'center',
							justifyContent: 'center',
							gap: 8,
							textAlign: 'center',
							padding: 12,
							color: 'var(--tl-color-text-1)',
							fontSize: 13,
						}}
					>
						{status === 'requesting' && <span>Requesting camera…</span>}
						{status === 'denied' && (
							<>
								<span>Camera access was denied.</span>
								<button onPointerDown={(e) => e.stopPropagation()} onClick={() => setRetryToken((t) => t + 1)}>
									Try again
								</button>
							</>
						)}
						{status === 'error' && (
							<>
								<span>Couldn't start the camera{errorMessage ? `: ${errorMessage}` : '.'}</span>
								<button onPointerDown={(e) => e.stopPropagation()} onClick={() => setRetryToken((t) => t + 1)}>
									Try again
								</button>
							</>
						)}
					</div>
				)}
			</div>
		</HTMLContainer>
	)
}

function drawFrame({
	canvas,
	video,
	crop,
	landmarks,
	boundLandmarks,
	hoverLandmarks,
	showVideo,
	showMarkers,
	w,
	h,
}: {
	canvas: HTMLCanvasElement
	video: HTMLVideoElement
	crop: CropRect
	landmarks: Record<string, ShapeLocalPoint>
	boundLandmarks: Set<string>
	hoverLandmarks: Set<string> | null
	showVideo: boolean
	showMarkers: boolean
	w: number
	h: number
}) {
	if (canvas.width !== w) canvas.width = w
	if (canvas.height !== h) canvas.height = h
	const ctx = canvas.getContext('2d')
	if (!ctx) return

	ctx.clearRect(0, 0, w, h)
	if (showVideo) {
		ctx.save()
		// Mirror horizontally so the video reads like a mirror (selfie view).
		ctx.translate(w, 0)
		ctx.scale(-1, 1)
		ctx.drawImage(video, crop.x0, crop.y0, crop.w, crop.h, 0, 0, w, h)
		ctx.restore()
	}

	if (!showMarkers) return
	for (const [name, pt] of Object.entries(landmarks)) {
		const isBound = boundLandmarks.has(name)
		const radius = isBound ? 6 : 4
		ctx.beginPath()
		ctx.fillStyle = isBound ? 'rgba(56, 189, 248, 0.95)' : 'rgba(255, 255, 255, 0.85)'
		ctx.strokeStyle = isBound ? 'rgba(8, 47, 73, 0.9)' : 'rgba(0, 0, 0, 0.35)'
		ctx.lineWidth = isBound ? 1.5 : 1
		ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2)
		ctx.fill()
		ctx.stroke()

		// A shape is currently being dragged toward this landmark — halo it so the drop target is
		// obvious. A head outline halos two at once (forehead+chin).
		if (hoverLandmarks?.has(name)) {
			ctx.beginPath()
			ctx.strokeStyle = 'rgba(250, 204, 21, 0.95)'
			ctx.lineWidth = 2.5
			ctx.arc(pt.x, pt.y, radius + 5, 0, Math.PI * 2)
			ctx.stroke()
		}

		// Tiny label so it's clear which named landmark each dot is, at a glance.
		const labelX = pt.x + radius + 3
		const labelY = pt.y + 3
		ctx.font = '8px sans-serif'
		ctx.textBaseline = 'alphabetic'
		ctx.lineWidth = 2
		ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)'
		ctx.strokeText(name, labelX, labelY)
		ctx.fillStyle = isBound ? 'rgba(56, 189, 248, 0.95)' : 'rgba(255, 255, 255, 0.9)'
		ctx.fillText(name, labelX, labelY)
	}
}
