/**
 * FROND SHAPE  (open-path tendrils — one polyline per arm, fewer animated nodes)
 * =============================================================================
 * A sibling of HydraShape with the SAME radial-writhing-tentacle aesthetic, but
 * built to test a different perf strategy: instead of a nested kinematic chain of
 * `<g>` segments (5 transform writes/arm), each arm is ONE open `<path>` whose
 * point list we recompute every frame by forward-kinematics in JS.
 *
 * WHY THIS MIGHT BE LIGHTER (the hypothesis we're measuring):
 *   • Hydra animates ARMS×SEGS `<g>` transforms (~50 DOM writes/shape). The cost we
 *     measured at scale is per-DOM-mutation, so fewer mutations = lighter.
 *   • Frond animates ARMS `<path>` `d` strings (~9 writes/shape) — ~5× fewer
 *     animated nodes. We walk the joint chain in JS (cheap: SEGS sin/cos), emit a
 *     POLYLINE `d` (`M..L..L..`). A polyline `d` is NOT the bloom's cliff: the cliff
 *     was BÉZIER tessellation + per-element `willChange`. A polyline just re-parses
 *     a short point list — no curve maths in the browser, no layers.
 *
 * SEPARATING THE TWO BUDGETS (the key idea):
 *   • ANIMATED nodes (cost per frame) → minimised: ARMS paths, nothing else moves.
 *   • STATIC detail + PAINT (cost once / on the GPU) → spent freely: a built-once
 *     body, and `stroke-dasharray` ridging come for free.
 *
 * Pure function of synced `seed`/`speed`/size + the shared clock — identical on
 * every client, nothing extra in the store, no referee (CLAUDE.md gotchas #5/#7).
 * NO `willChange`. Freezes when culled. NATIVE styles only (color/size/dash).
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
	resizeBox,
	useEditor,
	useReactor,
	useValue,
} from 'tldraw'
import { useEffect, useMemo, useRef } from 'react'
import { frondShapeValidators } from '../../shared/shape-schemas'
import { creatureClock, subscribeCreatureClock } from '../creature/clock'

// ── 1. THE SHAPE TYPE ────────────────────────────────────────────────────────
export type FrondShapeProps = {
	w: number
	h: number
	seed: number
	speed: number
	color: TLDefaultColorStyle
	size: TLDefaultSizeStyle
	dash: TLDefaultDashStyle
}

export type FrondShape = TLBaseShape<'frond', FrondShapeProps>

// REGISTER THE TYPE (required — TLShape is a closed union in v5; gotcha #1).
declare module 'tldraw' {
	interface TLGlobalShapePropsMap {
		frond: FrondShapeProps
	}
}

// ── 2. TUNING ────────────────────────────────────────────────────────────────
const STROKE_SIZES: Record<TLDefaultSizeStyle, number> = { s: 1.25, m: 2, l: 3, xl: 6 }

const ARMS_MIN = 7
const ARMS_MAX = 11
// Joints per arm. Higher = smoother curl AND more points in the polyline `d`, but
// NO extra DOM nodes (it's all one path) — so we can afford more here than the
// hydra's SEGS without adding animated elements. The per-frame cost is JS-only.
const JOINTS = 10

/** Cheap fixed-precision rounders for the per-frame `d` string (toFixed is slow). */
const r1 = (x: number) => ((x * 10) | 0) / 10

/** strokeDasharray for the arms (in stroke-width units); same as CreatureShape. */
function dashArray(dash: TLDefaultDashStyle, sw: number): string | undefined {
	switch (dash) {
		case 'dashed':
			return `${sw * 2} ${sw * 2}`
		case 'dotted':
			return `0 ${sw * 2}`
		default:
			return undefined
	}
}

// ── 3. THE UTIL ──────────────────────────────────────────────────────────────
export class FrondShapeUtil extends ShapeUtil<FrondShape> {
	static override type = 'frond' as const
	static override props = frondShapeValidators as RecordProps<FrondShape>

	getDefaultProps(): FrondShape['props'] {
		return {
			w: 220,
			h: 220,
			seed: Math.round(Math.random() * 1e6),
			speed: 1,
			color: 'blue',
			size: 'm',
			dash: 'solid',
		}
	}

	getGeometry(shape: FrondShape): Geometry2d {
		return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
	}

	override canResize() {
		return true
	}
	override onResize(shape: FrondShape, info: TLResizeInfo<FrondShape>) {
		return resizeBox(shape, info)
	}

	component(shape: FrondShape) {
		return <FrondBody shape={shape} />
	}

	getIndicatorPath(shape: FrondShape) {
		const path = new Path2D()
		path.roundRect(0, 0, shape.props.w, shape.props.h, 8)
		return path
	}
}

// ── 4. THE RENDER + IMPERATIVE ANIMATION ─────────────────────────────────────
function FrondBody({ shape }: { shape: FrondShape }) {
	const { w, h, seed, speed, color, size, dash } = shape.props
	const editor = useEditor()

	useEffect(() => subscribeCreatureClock(editor), [editor])

	// One ref PER ARM (not per segment): each is a single open <path> whose `d` we
	// rewrite each tick. This is the whole point — ARMS animated nodes, not ARMS×SEGS.
	const armRefs = useRef<Array<SVGPathElement | null>>([])

	const { stroke, strokeWidth } = useValue(
		'frondDisplay',
		() => {
			const theme = editor.getCurrentTheme()
			const colors = theme.colors[editor.getColorMode()]
			return {
				stroke: getColorValue(colors, color, 'solid'),
				strokeWidth: theme.strokeWidth * STROKE_SIZES[size],
			}
		},
		[editor, color, size]
	)
	const dashes = dashArray(dash, strokeWidth)

	const cx = w / 2
	const cy = h / 2
	const bodyR = Math.min(w, h) * 0.12
	const segLen = (Math.min(w, h) * 0.5 - bodyR) / JOINTS

	// DNA — per-arm constants from the seed (same scheme as the hydra).
	const dna = useMemo(() => {
		const rand = (i: number) => {
			const v = Math.sin((seed * 100 + i) * 127.1 + 311.7) * 43758.5453
			return v - Math.floor(v)
		}
		const arms = ARMS_MIN + Math.floor(rand(0) * (ARMS_MAX - ARMS_MIN + 1))
		const freqB = 1.7 + rand(1) * 1.0
		return {
			arms,
			freqB,
			perArm: Array.from({ length: arms }, (_, a) => {
				const phase = rand(a + 10) * Math.PI * 2
				const curlSign = rand(a + 30) < 0.5 ? -1 : 1
				return {
					angle: (a / arms) * Math.PI * 2,
					phase,
					phase2: phase * 1.3,
					lenJitter: 0.8 + rand(a + 50) * 0.4,
					baseCurl: (rand(a + 70) - 0.5) * 0.24, // resting curl, RADIANS/joint
					curlSign,
				}
			}),
		}
	}, [seed])

	// IMPERATIVE ANIMATION. For each arm we FORWARD-KINEMATIC walk the chain: start at
	// the body rim aimed outward, then at each joint accumulate a small curl angle
	// (the travelling interference wave) and step `segLen` in the running direction.
	// Collect the points into ONE polyline `d` and write it. That's ONE `d` write per
	// arm — no per-segment DOM nodes, no transforms, no Bézier tessellation.
	useReactor(
		'frondWrithe',
		() => {
			if (editor.getCulledShapes().has(shape.id)) return

			const t = creatureClock.get() * (0.5 + Math.max(0, speed))
			const refs = armRefs.current
			const w1 = t * 1.4
			const w2 = t * 1.4 * dna.freqB
			const perArm = dna.perArm

			for (let a = 0; a < perArm.length; a++) {
				const path = refs[a]
				if (!path) continue
				const arm = perArm[a]

				// Start point: on the body rim, in the arm's outward direction.
				let dir = arm.angle // running heading (radians)
				let px = cx + Math.cos(dir) * bodyR
				let py = cy + Math.sin(dir) * bodyR
				const step = segLen * arm.lenJitter
				// Build the polyline. One Move + JOINTS Lines.
				let d = `M${r1(px)} ${r1(py)}`
				for (let s = 0; s < JOINTS; s++) {
					// Per-joint curl: resting curl + a wave that LAGS by joint so it travels
					// out along the arm; a 2nd seeded frequency interferes (organic writhe).
					const lag = s * 0.6
					const wave = Math.sin(w1 + arm.phase + lag) + 0.5 * Math.sin(w2 + arm.phase2 + lag)
					dir += (arm.baseCurl + wave * 0.13) * arm.curlSign // accumulate heading
					px += Math.cos(dir) * step
					py += Math.sin(dir) * step
					d += `L${r1(px)} ${r1(py)}`
				}
				path.setAttribute('d', d)
			}
		},
		[editor, shape.id, dna, cx, cy, bodyR, segLen, speed]
	)

	// FREE STATIC COMPLEXITY — a richer hub, built ONCE and NEVER animated, so it costs
	// nothing per frame (paint only, on mount). Two concentric rings + a ring of small
	// nubs where the arms emerge. This is the "spend on static detail" half of the
	// budget split: the animated nodes stay at ARMS, the visual richness goes here.
	const bodyDecor = useMemo(() => {
		const nubs: { x: number; y: number }[] = []
		for (let a = 0; a < dna.arms; a++) {
			const ang = dna.perArm[a].angle
			nubs.push({ x: cx + Math.cos(ang) * bodyR, y: cy + Math.sin(ang) * bodyR })
		}
		return { nubs, innerR: bodyR * 0.55, nubR: strokeWidth * 1.4 }
	}, [dna, cx, cy, bodyR, strokeWidth])

	// THE TREE. A static decorated body + ONE open <path> per arm. The arms' `d` is a
	// placeholder at mount (straight spokes); the reactor rewrites it each frame.
	// Nothing here is nested or per-segment — React mounts ARMS paths and never
	// reconciles them again; all motion is the imperative `d` writes above.
	const restD = (a: number) => {
		const arm = dna.perArm[a]
		const x0 = cx + Math.cos(arm.angle) * bodyR
		const y0 = cy + Math.sin(arm.angle) * bodyR
		const x1 = cx + Math.cos(arm.angle) * (bodyR + segLen * JOINTS * arm.lenJitter)
		const y1 = cy + Math.sin(arm.angle) * (bodyR + segLen * JOINTS * arm.lenJitter)
		return `M${r1(x0)} ${r1(y0)}L${r1(x1)} ${r1(y1)}`
	}

	return (
		<HTMLContainer style={{ width: w, height: h, pointerEvents: 'all' }}>
			<svg width={w} height={h} style={{ overflow: 'visible', display: 'block' }}>
				{/* Static decorated body (built once, never animated → zero per-frame cost). */}
				<circle cx={cx} cy={cy} r={bodyR} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeDasharray={dashes} />
				<circle cx={cx} cy={cy} r={bodyDecor.innerR} fill="none" stroke={stroke} strokeWidth={strokeWidth * 0.7} />
				{bodyDecor.nubs.map((n, i) => (
					<circle key={i} cx={n.x} cy={n.y} r={bodyDecor.nubR} fill={stroke} stroke="none" />
				))}
				{/* One open polyline per arm — the reactor rewrites each `d` per frame. */}
				{Array.from({ length: dna.arms }, (_, a) => (
					<path
						key={a}
						ref={(el) => {
							armRefs.current[a] = el
						}}
						d={restD(a)}
						fill="none"
						stroke={stroke}
						strokeWidth={strokeWidth}
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeDasharray={dashes}
					/>
				))}
			</svg>
		</HTMLContainer>
	)
}
