/**
 * SPIDER (BLOBS) SHAPE  — single CONTINUOUS pen-stroke variant, approach A
 * =======================================================================
 * A stress-test sibling of SpiderShape. Same anatomy and ant-style gait, but the `d`
 * is ONE CONTINUOUS pen-stroke: a single `M` followed by only `L`s, NEVER lifting the
 * pen. (SpiderShape uses one <path> ELEMENT but its `d` has 10 disconnected sub-paths,
 * one `M` each.) Here the stroke overlaps itself to stay connected.
 *
 * THE ROUTE (why it can be one stroke): the pen
 *   1. traces the abdomen loop, walks forward into the cephalothorax loop, and ends that
 *      loop back near the body centre;
 *   2. for EACH leg, darts hip → knee → foot → knee → hip (out, then RETRACE back), so the
 *      pen always returns to the body to start the next leg. The retrace doubles each leg's
 *      stroke (a faint double-thickness) — the visual cost of staying connected.
 * Connecting moves between blobs/legs are real strokes too (they overlap the body), so the
 * silhouette is the current spider with a few extra hairline crossings.
 *
 * Built to compare against SpiderShape (multi-subpath) and SpiderOvalShape (approach B) in
 * the stress test. ONE <path>, polyline `d` (no Bézier), no willChange, freezes when culled,
 * pure function of synced seed/speed + the shared clock (CLAUDE.md gotchas #5/#7/#9).
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
	getStrokePoints,
	getSvgPathFromStrokePoints,
	resizeBox,
	useEditor,
	useReactor,
	useValue,
} from 'tldraw'
import { useEffect, useMemo, useRef } from 'react'
import { spiderBlobsShapeValidators } from '../../shared/shape-schemas'
import { creatureClock, subscribeCreatureClock } from '../creature/clock'

// ── 1. THE SHAPE TYPE ────────────────────────────────────────────────────────
export type SpiderBlobsShapeProps = {
	w: number
	h: number
	seed: number
	speed: number
	color: TLDefaultColorStyle
	size: TLDefaultSizeStyle
	dash: TLDefaultDashStyle
}

export type SpiderBlobsShape = TLBaseShape<'spiderBlobs', SpiderBlobsShapeProps>

declare module 'tldraw' {
	interface TLGlobalShapePropsMap {
		spiderBlobs: SpiderBlobsShapeProps
	}
}

// ── 2. TUNING ────────────────────────────────────────────────────────────────
const STROKE_SIZES: Record<TLDefaultSizeStyle, number> = { s: 1.25, m: 2, l: 3, xl: 6 }

const LEGS_PER_SIDE = 4
const BODY_LOOP_STEPS = 18

const r1 = (x: number) => ((x * 10) | 0) / 10

function dashArray(dash: TLDefaultDashStyle, sw: number): string | undefined {
	switch (dash) {
		case 'dotted':
			return `0 ${sw * 2.2}`
		case 'dashed':
			return `${sw * 2.5} ${sw * 2}`
		default:
			return undefined
	}
}

/**
 * Emit ONE continuous `d`. `draw` runs tldraw's NATIVE hand-drawn pipeline on the whole
 * polyline; otherwise a plain polyline (`M` once, then `L`s). The points are already a
 * single connected route (legs retraced, blobs walked into), so there is exactly one `M`.
 */
function pointsToD(pts: { x: number; y: number }[], draw: boolean, sw: number): string {
	if (draw) {
		const sp = getStrokePoints(pts, { size: sw, streamline: 0.5, last: true })
		return getSvgPathFromStrokePoints(sp, false)
	}
	let d = ''
	for (let i = 0; i < pts.length; i++) d += (i === 0 ? 'M' : 'L') + `${r1(pts[i].x)} ${r1(pts[i].y)}`
	return d
}

// ── 3. THE UTIL ──────────────────────────────────────────────────────────────
export class SpiderBlobsShapeUtil extends ShapeUtil<SpiderBlobsShape> {
	static override type = 'spiderBlobs' as const
	static override props = spiderBlobsShapeValidators as RecordProps<SpiderBlobsShape>

	getDefaultProps(): SpiderBlobsShape['props'] {
		return { w: 200, h: 200, seed: Math.round(Math.random() * 1e6), speed: 1, color: 'black', size: 'm', dash: 'solid' }
	}

	getGeometry(shape: SpiderBlobsShape): Geometry2d {
		return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
	}

	override canResize() {
		return true
	}
	override onResize(shape: SpiderBlobsShape, info: TLResizeInfo<SpiderBlobsShape>) {
		return resizeBox(shape, info)
	}

	component(shape: SpiderBlobsShape) {
		return <SpiderBlobsBody shape={shape} />
	}

	getIndicatorPath(shape: SpiderBlobsShape) {
		const path = new Path2D()
		path.roundRect(0, 0, shape.props.w, shape.props.h, 8)
		return path
	}
}

// ── 4. THE RENDER + IMPERATIVE ANIMATION ─────────────────────────────────────
function SpiderBlobsBody({ shape }: { shape: SpiderBlobsShape }) {
	const { w, h, seed, speed, color, size, dash } = shape.props
	const editor = useEditor()

	useEffect(() => subscribeCreatureClock(editor), [editor])

	const pathRef = useRef<SVGPathElement | null>(null)

	const { stroke, strokeWidth } = useValue(
		'spiderBlobsDisplay',
		() => {
			const theme = editor.getCurrentTheme()
			const colors = theme.colors[editor.getColorMode()]
			return { stroke: getColorValue(colors, color, 'solid'), strokeWidth: theme.strokeWidth * STROKE_SIZES[size] }
		},
		[editor, color, size]
	)
	const dashes = dashArray(dash, strokeWidth)
	const isDraw = dash === 'draw'

	const cx = w / 2
	const cy = h / 2

	// Identical anatomy to SpiderShape (so the comparison is fair) — see that file for the
	// commentary. Only the per-frame ROUTE differs.
	const dna = useMemo(() => {
		const rand = (i: number) => {
			const v = Math.sin((seed * 100 + i) * 127.1 + 311.7) * 43758.5453
			return v - Math.floor(v)
		}
		const ctR = h * 0.1
		const abR = h * 0.15
		const ctCx = cx - h * 0.02
		const abCx = cx + h * 0.16
		type Leg = { hip: { x: number; y: number }; side: 1 | -1; foreAft: number; reach: number; set: 0 | 1; jitter: number }
		const legs: Leg[] = []
		const stations = [-0.2, -0.07, 0.07, 0.2]
		for (let s = 0; s < LEGS_PER_SIDE; s++) {
			const foreAft = stations[s]
			const reach = 0.34
			const hipX = ctCx + foreAft * w * 0.35
			for (const side of [-1, 1] as const) {
				const set = (((s + (side > 0 ? 1 : 0)) % 2) as 0 | 1)
				legs.push({ hip: { x: hipX, y: cy + side * ctR * 0.7 }, side, foreAft, reach, set, jitter: (rand(legs.length) - 0.5) * 0.5 })
			}
		}
		return { ctR, abR, ctCx, abCx, legs }
	}, [cx, cy, w, h, seed])

	// IMPERATIVE ANIMATION — build ONE connected point list (single pen-stroke).
	useReactor(
		'spiderBlobsScuttle',
		() => {
			if (editor.getCulledShapes().has(shape.id)) return
			const path = pathRef.current
			if (!path) return

			const t = creatureClock.get() * (0.5 + Math.max(0, speed))
			const beat = t * 2.2
			const bobX = Math.sin(beat * 2) * (w * 0.006)
			const bobY = Math.cos(beat * 2) * (h * 0.006)

			// A body-blob loop's points, starting/ending at angle 0 (its rightmost point) so the
			// pen can walk INTO and OUT of it along the body axis without an ugly jump.
			const loopPts = (bx: number, r: number): { x: number; y: number }[] => {
				const pts: { x: number; y: number }[] = []
				for (let i = 0; i <= BODY_LOOP_STEPS; i++) {
					const a = (i / BODY_LOOP_STEPS) * Math.PI * 2
					pts.push({ x: bx + bobX + Math.cos(a) * r, y: cy + bobY + Math.sin(a) * r })
				}
				return pts
			}

			// ONE continuous route. Start at the abdomen, loop it, walk forward to the
			// cephalothorax, loop that, then visit every leg out-and-back (retrace).
			const route: { x: number; y: number }[] = []
			route.push(...loopPts(dna.abCx, dna.abR)) // abdomen loop (rear)
			route.push(...loopPts(dna.ctCx, dna.ctR)) // walk forward + cephalothorax loop

			for (const leg of dna.legs) {
				const ph = beat + (leg.set === 0 ? 0 : Math.PI) + leg.jitter
				const swing = Math.sin(ph)
				const lift = Math.max(0, Math.cos(ph))

				const hip = { x: leg.hip.x + bobX, y: leg.hip.y + bobY }
				const footX = hip.x + leg.foreAft * w + swing * (w * 0.05)
				const footY = hip.y + leg.side * leg.reach * h
				const midX = (hip.x + footX) / 2
				const midY = (hip.y + footY) / 2
				const knee = { x: midX, y: midY + leg.side * h * (0.07 + 0.05 * lift) }
				const foot = { x: footX, y: footY }

				// hip → knee → foot → knee → hip : out and BACK, so the pen returns to the body.
				route.push(hip, knee, foot, knee, hip)
			}

			path.setAttribute('d', pointsToD(route, isDraw, strokeWidth))
		},
		[editor, shape.id, dna, cx, cy, w, h, speed, isDraw, strokeWidth]
	)

	return (
		<HTMLContainer style={{ width: w, height: h, pointerEvents: 'all' }}>
			<svg width={w} height={h} style={{ overflow: 'visible', display: 'block' }}>
				<path ref={pathRef} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dashes} />
			</svg>
		</HTMLContainer>
	)
}
