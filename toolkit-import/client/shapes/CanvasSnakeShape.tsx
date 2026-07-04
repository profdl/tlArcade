/**
 * CANVAS SNAKE SHAPE  (a perfect-freehand ink serpent that roams the viewport)
 * ============================================================================
 * A slithering snake drawn as ONE filled perfect-freehand outline whose `d` we
 * rewrite each frame. It is two experiments wired together:
 *
 *   • THE BODY (this file) — a travelling sine wave sampled into a spine, fed
 *     through tldraw's NATIVE hand-drawn pipeline as a FILLED, tapered ink stroke
 *     (fat head → whip-thin tail). Rewritten per tick off the shared clock, so the
 *     snake undulates. One animated <path> = the cheap end of gotcha #9.
 *   • THE ROAMING (client/creature/registerCanvasSnake.ts) — a per-frame behaviour
 *     that steers the whole shape's x/y + rotation around the visible view area,
 *     wandering and bouncing off the viewport edges. That is the "moves around the
 *     canvas" half; it writes positions natively so sync replicates them for free.
 *
 * WHY FILLED (not the centerline) freehand: the brief asked for an *exaggerated*
 * look. `getStrokePoints → getSvgPathFromStrokePoints` gives a constant-width
 * centerline; `getStroke → getSvgPathFromPoints(closed)` gives the variable-width
 * INK OUTLINE — the same machinery that makes the Draw tool's strokes taper. We
 * push per-point PRESSURE (z) so the head is fat and the tail tapers to nothing,
 * which reads as a real snake. This is still ONE path / ONE write per frame.
 *
 * Pure function of synced `seed`/`speed`/size + the shared clock for the body, so
 * every client draws the identical wriggle with nothing per-frame in the store
 * (CLAUDE.md gotchas #5 & #7). The roaming owner writes x/y; viewers just re-render.
 */
import {
	Geometry2d,
	HTMLContainer,
	Rectangle2d,
	RecordProps,
	ShapeUtil,
	TLBaseShape,
	TLDefaultColorStyle,
	TLDefaultDashStyle,
	TLDefaultSizeStyle,
	TLResizeInfo,
	getColorValue,
	getStroke,
	getSvgPathFromPoints,
	resizeBox,
	useEditor,
	useReactor,
	useValue,
} from 'tldraw'
import { useEffect, useMemo, useRef } from 'react'
import { canvasSnakeValidators } from '../../shared/shape-schemas'
import { creatureClock, subscribeCreatureClock } from '../creature/clock'

// ── 1. THE SHAPE TYPE ────────────────────────────────────────────────────────
export type CanvasSnakeShapeProps = {
	w: number
	h: number
	// Deterministic seed: spine wobble phase + per-eye jitter. Same on every client.
	seed: number
	// Slither rate. Higher = faster undulation (and the roamer reads it for travel speed).
	speed: number
	// NATIVE tldraw style props only (CLAUDE.md gotcha #8): color/size/dash.
	color: TLDefaultColorStyle
	size: TLDefaultSizeStyle
	dash: TLDefaultDashStyle
}

export type CanvasSnakeShape = TLBaseShape<'canvasSnake', CanvasSnakeShapeProps>

// REGISTER THE TYPE (required — TLShape is a closed union in v5; gotcha #1).
declare module 'tldraw' {
	interface TLGlobalShapePropsMap {
		canvasSnake: CanvasSnakeShapeProps
	}
}

// ── 2. TUNING ────────────────────────────────────────────────────────────────
// Body thickness scales with the native size style (diameter of the fattest point).
const BODY_SIZES: Record<TLDefaultSizeStyle, number> = { s: 14, m: 20, l: 28, xl: 44 }

// SAMPLES along the spine. More = smoother snake AND more polyline points, but it's
// still ONE filled path / ONE write. ~64 spine points reads as a continuous serpent.
const SAMPLES = 64

// How many full sine humps live along the body at once. ~2 reads as a classic
// S-slither; the wave travels down the body each frame so it appears to crawl.
const HUMPS = 2

/** Cheap fixed-precision rounder for the per-frame `d` string (toFixed is slow). */
const r1 = (x: number) => ((x * 10) | 0) / 10

/** strokeDasharray for the centre-seam line style (in stroke-width units). */
function seamDash(dash: TLDefaultDashStyle, sw: number): string | undefined {
	switch (dash) {
		case 'dotted':
			return `0 ${sw * 2.2}`
		case 'dashed':
			return `${sw * 2.5} ${sw * 2}`
		default:
			return undefined // 'solid' | 'draw' → continuous seam
	}
}

// ── 3. THE UTIL ──────────────────────────────────────────────────────────────
export class CanvasSnakeShapeUtil extends ShapeUtil<CanvasSnakeShape> {
	static override type = 'canvasSnake' as const
	static override props = canvasSnakeValidators as RecordProps<CanvasSnakeShape>

	getDefaultProps(): CanvasSnakeShape['props'] {
		return {
			w: 260,
			h: 120,
			seed: Math.round(Math.random() * 1e6),
			speed: 1,
			color: 'green',
			size: 'l',
			dash: 'draw',
		}
	}

	getGeometry(shape: CanvasSnakeShape): Geometry2d {
		return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
	}

	override canResize() {
		return true
	}
	override onResize(shape: CanvasSnakeShape, info: TLResizeInfo<CanvasSnakeShape>) {
		return resizeBox(shape, info)
	}

	component(shape: CanvasSnakeShape) {
		return <SnakeBody shape={shape} />
	}

	getIndicatorPath(shape: CanvasSnakeShape) {
		const path = new Path2D()
		path.roundRect(0, 0, shape.props.w, shape.props.h, 8)
		return path
	}
}

// ── 4. THE RENDER + IMPERATIVE ANIMATION ─────────────────────────────────────
function SnakeBody({ shape }: { shape: CanvasSnakeShape }) {
	const { w, h, seed, speed, color, size, dash } = shape.props
	const editor = useEditor()

	useEffect(() => subscribeCreatureClock(editor), [editor])

	// The ONE animated body node: a single filled <path>; we rewrite its `d` each frame.
	const bodyRef = useRef<SVGPathElement | null>(null)
	// The head <g> rides the front of the spine — we set its transform (translate+rotate)
	// each frame so the eyes track the head direction. Two cheap attribute writes, no React.
	const headRef = useRef<SVGGElement | null>(null)

	const { stroke, strokeWidth } = useValue(
		'snakeDisplay',
		() => {
			const theme = editor.getCurrentTheme()
			const colors = theme.colors[editor.getColorMode()]
			return {
				stroke: getColorValue(colors, color, 'solid'),
				strokeWidth: BODY_SIZES[size],
			}
		},
		[editor, color, size]
	)
	// A darker centre seam down the back, for a bit of depth. 'draw' keeps it solid.
	const seam = seamDash(dash, Math.max(2, strokeWidth * 0.18))

	// THE SPINE LAYOUT. The body runs left→right across the box; the head is at the
	// right (the direction the roamer points the shape). The vertical wobble is a
	// travelling sine; amplitude eases to 0 at both ends so the snake whips, not flaps.
	const midY = h / 2
	const amp = Math.min(h * 0.42, strokeWidth * 1.6) // hump height
	const headX = w * 0.96
	const tailX = w * 0.04

	// Seeded RNG → tiny per-snake variation in eye offset + wobble phase.
	const dna = useMemo(() => {
		const rand = (i: number) => {
			const v = Math.sin((seed * 100 + i) * 127.1 + 311.7) * 43758.5453
			return v - Math.floor(v)
		}
		return { phase: rand(0) * Math.PI * 2, eyeJitter: (rand(1) - 0.5) * strokeWidth * 0.2 }
	}, [seed, strokeWidth])

	// IMPERATIVE ANIMATION. Each frame we sample the travelling-wave spine into points,
	// attach a PRESSURE taper (fat head → thin tail), run it through perfect-freehand's
	// FILLED outline, and write the one `d`. The head <g> follows the front of the spine.
	useReactor(
		'snakeSlither',
		() => {
			if (editor.getCulledShapes().has(shape.id)) return
			const path = bodyRef.current
			if (!path) return

			const t = creatureClock.get() * (1.5 + Math.max(0, speed))

			// Sample the spine from TAIL (i=0) to HEAD (i=SAMPLES). u∈[0,1] is 0 at the
			// tail, 1 at the head. Pressure follows u so freehand fattens toward the head.
			const pts: { x: number; y: number; z: number }[] = new Array(SAMPLES + 1)
			for (let i = 0; i <= SAMPLES; i++) {
				const u = i / SAMPLES
				const x = tailX + (headX - tailX) * u
				// Travelling sine: phase decreases with u and advances with the clock, so the
				// crest crawls from head to tail (the snake appears to push itself forward).
				const wavePhase = HUMPS * Math.PI * 2 * u - t + dna.phase
				// Envelope: sin(πu) is 0 at both ends, 1 in the middle → no flapping at the tips.
				const env = Math.sin(Math.PI * u)
				const y = midY + Math.sin(wavePhase) * amp * env
				// PRESSURE (z): thin whip tail (u→0) swelling to a fat head (u→1), with a tiny
				// dip right at the snout so the head reads as rounded, not blunt.
				const z = 0.12 + 0.88 * Math.pow(u, 0.7) * (1 - 0.25 * Math.pow(u, 8))
				pts[i] = { x, y, z }
			}

			// FILLED perfect-freehand outline. thinning>0 makes pressure shrink the width;
			// taper the tail to a point and round the head cap. This is the exaggerated,
			// hand-inked look. getSvgPathFromPoints(closed=true) closes the ink blob.
			const outline = getStroke(pts, {
				size: strokeWidth,
				thinning: 0.85,
				smoothing: 0.6,
				streamline: 0.4,
				simulatePressure: false, // we supply real pressure via z
				start: { taper: 0, cap: true },
				end: { taper: strokeWidth * 6, cap: false }, // long pointed tail
			})
			// getStroke returns the closed outline polygon; getSvgPathFromPoints(closed=true)
			// turns it into the filled ink-blob `d` — the same helper the Draw shape uses.
			path.setAttribute('d', getSvgPathFromPoints(outline, true))

			// Point the head <g> along the spine at the snout. Aim from the second-to-last
			// sample to the last so the eyes lean into the current wriggle.
			const head = pts[SAMPLES]
			const neck = pts[SAMPLES - 2]
			const ang = (Math.atan2(head.y - neck.y, head.x - neck.x) * 180) / Math.PI
			headRef.current?.setAttribute('transform', `translate(${r1(head.x)} ${r1(head.y)}) rotate(${r1(ang)})`)
		},
		[editor, shape.id, tailX, headX, midY, amp, speed, strokeWidth, dna]
	)

	// Eye geometry, in the head's LOCAL frame (origin = snout, +x points forward).
	const eyeBack = -strokeWidth * 0.45 // eyes sit just behind the snout
	const eyeSpread = strokeWidth * 0.42 // up/down off the centreline
	const eyeR = Math.max(2.2, strokeWidth * 0.2)
	const pupilR = eyeR * 0.5

	// THE TREE. ONE filled body <path> (rewritten per frame) + a small static head group
	// (transform-only per frame). Native stroke/fill styling; the seam is a thin overlay.
	return (
		<HTMLContainer style={{ width: w, height: h, pointerEvents: 'all' }}>
			<svg width={w} height={h} style={{ overflow: 'visible', display: 'block' }}>
				{/* the ink body — fill IS the snake; a faint same-colour stroke rounds the rim */}
				<path
					ref={bodyRef}
					fill={stroke}
					stroke={stroke}
					strokeWidth={Math.max(1, strokeWidth * 0.08)}
					strokeLinejoin="round"
					strokeDasharray={seam}
				/>
				{/* the head: googly eyes that ride and rotate with the snout */}
				<g ref={headRef}>
					<circle cx={eyeBack} cy={-eyeSpread + dna.eyeJitter} r={eyeR} fill="#fff" stroke="#0008" strokeWidth={0.75} />
					<circle cx={eyeBack} cy={eyeSpread + dna.eyeJitter} r={eyeR} fill="#fff" stroke="#0008" strokeWidth={0.75} />
					<circle cx={eyeBack + eyeR * 0.35} cy={-eyeSpread + dna.eyeJitter} r={pupilR} fill="#000" />
					<circle cx={eyeBack + eyeR * 0.35} cy={eyeSpread + dna.eyeJitter} r={pupilR} fill="#000" />
				</g>
			</svg>
		</HTMLContainer>
	)
}
