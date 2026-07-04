/**
 * SPIDER (OVAL) SHAPE  — single CONTINUOUS pen-stroke variant, approach B
 * ======================================================================
 * A stress-test sibling of SpiderShape. Same ant-style gait and leg layout, but the body
 * is ONE oval (cephalothorax+abdomen merged) and the `d` is ONE CONTINUOUS pen-stroke:
 * a single `M`, only `L`s, no lifts. As the pen traces around the oval rim it DETOURS at
 * each leg's hip — out along the leg and back to the rim — before continuing around. So the
 * legs branch from the body with no connecting overlap across the body interior (cleaner
 * than approach A's retrace-through-the-blobs), at the cost of a slightly different body
 * silhouette (one oval, not two distinct blobs).
 *
 * THE ROUTE: walk the oval rim in order; the eight hip anchors are placed AROUND the rim
 * (four per side, fore→aft), so when the rim-walk reaches a hip we splice in hip→knee→foot
 * →knee→hip and resume the rim. The whole thing is one connected point list → one `M`.
 *
 * ONE <path>, polyline `d` (no Bézier), no willChange, freezes when culled, pure function
 * of synced seed/speed + the shared clock (CLAUDE.md gotchas #5/#7/#9).
 */
import type {
	Geometry2d,
	RecordProps,
	TLBaseShape,
	TLDefaultColorStyle,
	TLDefaultDashStyle,
	TLDefaultSizeStyle,
	TLResizeInfo} from 'tldraw';
import {
	HTMLContainer,
	Rectangle2d,
	ShapeUtil,
	getColorValue,
	getStrokePoints,
	getSvgPathFromStrokePoints,
	resizeBox,
	useEditor,
	useReactor,
	useValue,
} from 'tldraw'
import { useEffect, useMemo, useRef } from 'react'
import { spiderOvalShapeValidators } from 'shared/shape-schemas'
import { creatureClock, subscribeCreatureClock } from '../creature/clock'

// ── 1. THE SHAPE TYPE ────────────────────────────────────────────────────────
export type SpiderOvalShapeProps = {
	w: number
	h: number
	seed: number
	speed: number
	color: TLDefaultColorStyle
	size: TLDefaultSizeStyle
	dash: TLDefaultDashStyle
}

export type SpiderOvalShape = TLBaseShape<'spiderOval', SpiderOvalShapeProps>

declare module 'tldraw' {
	interface TLGlobalShapePropsMap {
		spiderOval: SpiderOvalShapeProps
	}
}

// ── 2. TUNING ────────────────────────────────────────────────────────────────
const STROKE_SIZES: Record<TLDefaultSizeStyle, number> = { s: 1.25, m: 2, l: 3, xl: 6 }

const LEGS_PER_SIDE = 4
const RIM_STEPS = 48 // resolution of the body oval (more = smoother, still one stroke)

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
export class SpiderOvalShapeUtil extends ShapeUtil<SpiderOvalShape> {
	static override type = 'spiderOval' as const
	static override props = spiderOvalShapeValidators as RecordProps<SpiderOvalShape>

	getDefaultProps(): SpiderOvalShape['props'] {
		return { w: 200, h: 200, seed: Math.round(Math.random() * 1e6), speed: 1, color: 'black', size: 'm', dash: 'solid' }
	}

	getGeometry(shape: SpiderOvalShape): Geometry2d {
		return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
	}

	override canResize() {
		return true
	}
	override onResize(shape: SpiderOvalShape, info: TLResizeInfo<SpiderOvalShape>) {
		return resizeBox(shape, info)
	}

	component(shape: SpiderOvalShape) {
		return <SpiderOvalBody shape={shape} />
	}

	getIndicatorPath(shape: SpiderOvalShape) {
		const path = new Path2D()
		path.roundRect(0, 0, shape.props.w, shape.props.h, 8)
		return path
	}
}

// ── 4. THE RENDER + IMPERATIVE ANIMATION ─────────────────────────────────────
function SpiderOvalBody({ shape }: { shape: SpiderOvalShape }) {
	const { w, h, seed, speed, color, size, dash } = shape.props
	const editor = useEditor()

	useEffect(() => subscribeCreatureClock(editor), [editor])

	const pathRef = useRef<SVGPathElement | null>(null)

	const { stroke, strokeWidth } = useValue(
		'spiderOvalDisplay',
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

	// Anatomy: ONE body oval (spanning where the two blobs were) + the same eight legs. Each
	// leg's hip gets a RIM ANGLE so the rim-walk knows where to splice the leg in. The legs'
	// fore/aft + reach + gait set match SpiderShape exactly (fair comparison).
	const dna = useMemo(() => {
		const rand = (i: number) => {
			const v = Math.sin((seed * 100 + i) * 127.1 + 311.7) * 43758.5453
			return v - Math.floor(v)
		}
		// Oval spanning the old cephalothorax→abdomen extent. rx along the body axis, ry across.
		const rx = h * 0.2
		const ry = h * 0.13
		type Leg = {
			rimAngle: number // where on the oval rim this leg's hip sits
			side: 1 | -1
			foreAft: number
			reach: number
			set: 0 | 1
			jitter: number
		}
		const legs: Leg[] = []
		const stations = [-0.2, -0.07, 0.07, 0.2]
		for (let s = 0; s < LEGS_PER_SIDE; s++) {
			const foreAft = stations[s]
			const reach = 0.34
			for (const side of [-1, 1] as const) {
				// Map the fore/aft station to a rim angle: front stations toward the front of the
				// oval (angle near π for −x = forward), spread across the top/bottom by side.
				// foreAft∈[-0.2,0.2] → fraction along the body; convert to an angle on the rim.
				const along = (foreAft + 0.2) / 0.4 // 0 (front) .. 1 (rear)
				const base = side < 0 ? Math.PI : Math.PI // start at front
				// sweep from front(−x) toward rear(+x) along the chosen side's half of the rim.
				const ang = side < 0 ? Math.PI - along * Math.PI * 0.6 : Math.PI + along * Math.PI * 0.6
				void base
				const set = (((s + (side > 0 ? 1 : 0)) % 2) as 0 | 1)
				legs.push({ rimAngle: ang, side, foreAft, reach, set, jitter: (rand(legs.length) - 0.5) * 0.5 })
			}
		}
		// Sort legs by rim angle so the rim-walk meets them in order (one clean pass around).
		legs.sort((a, b) => a.rimAngle - b.rimAngle)
		return { rx, ry, legs }
	}, [cx, cy, w, h, seed])

	useReactor(
		'spiderOvalScuttle',
		() => {
			if (editor.getCulledShapes().has(shape.id)) return
			const path = pathRef.current
			if (!path) return

			const t = creatureClock.get() * (0.5 + Math.max(0, speed))
			const beat = t * 2.2
			const bobX = Math.sin(beat * 2) * (w * 0.006)
			const bobY = Math.cos(beat * 2) * (h * 0.006)
			const ox = cx + bobX
			const oy = cy + bobY

			const rimPoint = (a: number) => ({ x: ox + Math.cos(a) * dna.rx, y: oy + Math.sin(a) * dna.ry })

			// Precompute each leg's branch (hip on the rim → knee → foot), keyed by rim angle.
			const branches = dna.legs.map((leg) => {
				const ph = beat + (leg.set === 0 ? 0 : Math.PI) + leg.jitter
				const swing = Math.sin(ph)
				const lift = Math.max(0, Math.cos(ph))
				const hip = rimPoint(leg.rimAngle)
				// Foot relative to the hip, using the same fore/aft + reach math as SpiderShape.
				const footX = hip.x + leg.foreAft * w + swing * (w * 0.05)
				const footY = hip.y + leg.side * leg.reach * h
				const midX = (hip.x + footX) / 2
				const midY = (hip.y + footY) / 2
				const knee = { x: midX, y: midY + leg.side * h * (0.07 + 0.05 * lift) }
				return { rimAngle: leg.rimAngle, hip, knee, foot: { x: footX, y: footY } }
			})

			// ONE continuous route: walk the rim; at each step, if a leg's hip angle falls in
			// this segment, splice hip→knee→foot→knee→hip before continuing the rim.
			const route: { x: number; y: number }[] = []
			let bi = 0
			for (let i = 0; i <= RIM_STEPS; i++) {
				const a = -Math.PI + (i / RIM_STEPS) * Math.PI * 2 // walk full rim from −π
				route.push(rimPoint(a))
				while (bi < branches.length && branches[bi].rimAngle <= a) {
					const b = branches[bi]
					route.push(b.hip, b.knee, b.foot, b.knee, b.hip)
					bi++
				}
			}
			// Any legs past the last rim sample (numerical edge) — append at the end.
			for (; bi < branches.length; bi++) {
				const b = branches[bi]
				route.push(b.hip, b.knee, b.foot, b.knee, b.hip)
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
