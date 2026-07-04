/**
 * HYDRA SHAPE  (a radial array of writhing tapered tentacles)
 * ==========================================================
 * A central body with ARMS solid, tapered, curling limbs. The Hydra's identity vs.
 * its sibling FrondShape is that its arms are CLOSED, fillable RIBBONS (solid limbs
 * that taper to a point), where the Frond's are open single strokes.
 *
 * RENDER STRATEGY — FK-POLYLINE RIBBON (the fast pattern, proven by the stress test):
 *   Each arm is ONE `<path>` whose `d` we recompute every frame by forward-kinematics
 *   in JS: walk the spine joint-by-joint (accumulating a small curl angle per joint —
 *   the travelling interference wave), and at each joint emit the TWO outline points
 *   (±half-width, perpendicular to the local heading). The `d` runs down one edge,
 *   around the tip, back up the other edge, and closes (`Z`) → a filled tapered limb.
 *   It is all `M`/`L` (a POLYLINE outline — NO Bézier), so the browser just re-parses
 *   a short point list each frame; no curve tessellation.
 *
 * WHY THIS (and not the old nested-`<g>` version): the bloom/hydra/frond stress tests
 * showed the dominant cost is the NUMBER of animated DOM writes per frame, not the
 * geometry or the JS. The old Hydra animated ARMS×SEGS (~50) `<g>` transforms/shape
 * and went smooth to ~100. Collapsing each arm to ONE `d` write (~9/shape) ~2.5×'d the
 * ceiling (see FrondShape + the [[hydra-svg-perf-ceiling]] memory). Same look, far
 * fewer writes. See the memory for the full law and the two real cliffs to avoid
 * (per-element `willChange`; per-frame BÉZIER `d`). NEITHER is used here.
 *
 * Everything is a PURE function of synced `seed`/`speed`/size + the shared clock, so
 * every client draws the identical hydra with nothing extra in the store and no
 * referee (CLAUDE.md gotchas #5 & #7). NO `willChange`. Freezes when culled.
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
	resizeBox,
	useEditor,
	useReactor,
	useValue,
} from 'tldraw'
import { useEffect, useMemo, useRef } from 'react'
import { hydraShapeValidators } from 'shared/shape-schemas'
import { creatureClock, subscribeCreatureClock } from '../creature/clock'

// ── 1. THE SHAPE TYPE ────────────────────────────────────────────────────────
export type HydraShapeProps = {
	w: number
	h: number
	// Deterministic seed: arm count + per-arm phase/curl/length. Same on every client
	// = identical hydra. The animation is computed locally each frame (NOT synced).
	seed: number
	// Writhe rate. Higher = faster tentacles. The local clock multiplies it.
	speed: number
	// NATIVE tldraw style props (CLAUDE.md gotcha #8): color/size/dash. NO `fill` — the
	// limbs use `fill=stroke` for a solid look but we don't expose the fill StyleProp
	// (an unused style prop clutters the panel + risks a migration error).
	color: TLDefaultColorStyle
	size: TLDefaultSizeStyle
	dash: TLDefaultDashStyle
}

export type HydraShape = TLBaseShape<'hydra', HydraShapeProps>

// REGISTER THE TYPE (required — TLShape is a closed union in v5; gotcha #1).
declare module 'tldraw' {
	interface TLGlobalShapePropsMap {
		hydra: HydraShapeProps
	}
}

// ── 2. TUNING ────────────────────────────────────────────────────────────────
// perfect-freehand's STROKE_SIZES aren't exported here (gotcha #8); mirror locally.
const STROKE_SIZES: Record<TLDefaultSizeStyle, number> = { s: 1.25, m: 2, l: 3, xl: 6 }

const ARMS_MIN = 7
const ARMS_MAX = 11
// Joints per arm spine. Higher = smoother curl AND more points in the ribbon outline,
// but NO extra DOM nodes (it's all one path per arm) — so we can afford a high count.
// The per-frame cost is JS-only (a few sin/cos per joint).
const JOINTS = 10

/** Cheap fixed-precision rounder for the per-frame `d` string (toFixed is slow). */
const r1 = (x: number) => ((x * 10) | 0) / 10

/** strokeDasharray for the arm OUTLINE (in stroke-width units); same as CreatureShape. */
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
export class HydraShapeUtil extends ShapeUtil<HydraShape> {
	static override type = 'hydra' as const
	static override props = hydraShapeValidators as RecordProps<HydraShape>

	getDefaultProps(): HydraShape['props'] {
		return {
			w: 220,
			h: 220,
			seed: Math.round(Math.random() * 1e6),
			speed: 1,
			color: 'light-green',
			size: 'm',
			dash: 'solid',
		}
	}

	getGeometry(shape: HydraShape): Geometry2d {
		return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
	}

	override canResize() {
		return true
	}
	override onResize(shape: HydraShape, info: TLResizeInfo<HydraShape>) {
		return resizeBox(shape, info)
	}

	component(shape: HydraShape) {
		return <HydraBody shape={shape} />
	}

	// v5: selection outline is a Path2D, not JSX (gotcha #3).
	getIndicatorPath(shape: HydraShape) {
		const path = new Path2D()
		path.roundRect(0, 0, shape.props.w, shape.props.h, 8)
		return path
	}
}

// ── 4. THE RENDER + IMPERATIVE ANIMATION ─────────────────────────────────────
function HydraBody({ shape }: { shape: HydraShape }) {
	const { w, h, seed, speed, color, size, dash } = shape.props
	const editor = useEditor()

	// Share the clock lifetime with this shape (same tick the creatures run on).
	useEffect(() => subscribeCreatureClock(editor), [editor])

	// One ref PER ARM — each is a single closed-ribbon <path> whose `d` we rewrite each
	// tick. ARMS animated nodes, NOT ARMS×JOINTS: that's the whole perf win.
	const armRefs = useRef<Array<SVGPathElement | null>>([])
	// Ref to the body <g> for a slow whole-hydra breathe/swirl (one transform write).
	const bodyRef = useRef<SVGGElement | null>(null)

	const { stroke, strokeWidth } = useValue(
		'hydraDisplay',
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
	const bodyR = Math.min(w, h) * 0.12 // central body radius
	const segLen = (Math.min(w, h) * 0.5 - bodyR) / JOINTS // length of one spine step
	const baseHalf = strokeWidth * 2.6 // limb half-width at the root (tapers to ~0)

	// HYDRA DNA — per-arm constants from the seed.
	const dna = useMemo(() => {
		const rand = (i: number) => {
			const v = Math.sin((seed * 100 + i) * 127.1 + 311.7) * 43758.5453
			return v - Math.floor(v)
		}
		const arms = ARMS_MIN + Math.floor(rand(0) * (ARMS_MAX - ARMS_MIN + 1))
		const freqB = 1.7 + rand(1) * 1.0 // 2nd interference frequency
		const swirl = (rand(2) - 0.5) * 0.5 // whole-hydra slow rotation rate
		return {
			arms,
			freqB,
			swirl,
			perArm: Array.from({ length: arms }, (_, a) => {
				const phase = rand(a + 10) * Math.PI * 2
				const curlSign = rand(a + 30) < 0.5 ? -1 : 1
				return {
					angle: (a / arms) * Math.PI * 2, // evenly spaced around the body
					phase, // base wave phase
					phase2: phase * 1.3, // 2nd-frequency phase (precomputed)
					lenJitter: 0.8 + rand(a + 50) * 0.4, // 0.8..1.2 arm length
					baseCurl: (rand(a + 70) - 0.5) * 0.22, // resting curl, RADIANS/joint
					curlSign,
				}
			}),
		}
	}, [seed])

	// IMPERATIVE ANIMATION. For each arm: FORWARD-KINEMATIC walk the spine, and at each
	// joint emit the two outline edge points (±half-width perpendicular to the local
	// heading). Build ONE closed polygon `d` (down one edge, around the tip, up the
	// other, `Z`) and write it. ONE `d` write per arm — no per-joint DOM, no transforms,
	// no Bézier. The body is a separate slow breathe/swirl on its own <g> (1 write).
	useReactor(
		'hydraWrithe',
		() => {
			if (editor.getCulledShapes().has(shape.id)) return

			const t = creatureClock.get() * (0.5 + Math.max(0, speed))
			const refs = armRefs.current

			// Body group: slow breathe (scale) + gentle whole-hydra swirl (rotate).
			const body = bodyRef.current
			if (body) {
				const breathe = 1 + 0.06 * Math.sin(t * 0.9)
				const spin = (t * dna.swirl * 180) / Math.PI
				body.setAttribute('transform', `translate(${r1(cx)} ${r1(cy)}) rotate(${r1(spin)}) scale(${breathe.toFixed(3)})`)
			}

			const w1 = t * 1.4
			const w2 = t * 1.4 * dna.freqB
			const perArm = dna.perArm

			for (let a = 0; a < perArm.length; a++) {
				const path = refs[a]
				if (!path) continue
				const arm = perArm[a]

				// Walk the spine in the BODY group's local space (origin at body centre).
				let dir = arm.angle // running heading (radians)
				let px = Math.cos(dir) * bodyR // start on the body rim
				let py = Math.sin(dir) * bodyR
				const step = segLen * arm.lenJitter

				// Collect the two outline edges as we go; we join them into one closed
				// loop at the end (left edge forward, right edge reversed).
				const left: string[] = []
				const right: string[] = []
				for (let s = 0; s <= JOINTS; s++) {
					// Half-width tapers linearly from baseHalf at the root to ~0 at the tip.
					const half = baseHalf * (1 - s / JOINTS)
					// Perpendicular to the current heading (unit normal): (-sin, cos).
					const nx = -Math.sin(dir) * half
					const ny = Math.cos(dir) * half
					left.push(`${r1(px + nx)} ${r1(py + ny)}`)
					right.push(`${r1(px - nx)} ${r1(py - ny)}`)
					if (s < JOINTS) {
						// Advance heading by the curl wave, then step forward `step`.
						const lag = s * 0.6
						const wave = Math.sin(w1 + arm.phase + lag) + 0.5 * Math.sin(w2 + arm.phase2 + lag)
						dir += (arm.baseCurl + wave * 0.12) * arm.curlSign
						px += Math.cos(dir) * step
						py += Math.sin(dir) * step
					}
				}
				// Close the ribbon: down the left edge, back up the right edge, Z.
				const d = `M${left.join('L')}L${right.reverse().join('L')}Z`
				path.setAttribute('d', d)
			}
		},
		[editor, shape.id, dna, cx, cy, bodyR, segLen, baseHalf, speed]
	)

	// REST-POSE `d` for one arm — a straight tapered spoke (the reactor rewrites it).
	const restD = (a: number) => {
		const arm = dna.perArm[a]
		const len = segLen * JOINTS * arm.lenJitter
		const ux = Math.cos(arm.angle)
		const uy = Math.sin(arm.angle)
		const nx = -Math.sin(arm.angle) * baseHalf
		const ny = Math.cos(arm.angle) * baseHalf
		const x0 = ux * bodyR
		const y0 = uy * bodyR
		const xt = ux * (bodyR + len)
		const yt = uy * (bodyR + len)
		return `M${r1(x0 + nx)} ${r1(y0 + ny)}L${r1(xt)} ${r1(yt)}L${r1(x0 - nx)} ${r1(y0 - ny)}Z`
	}

	// THE TREE. A body <g> (animated as a whole: breathe + swirl) containing a static
	// body circle + ONE closed-ribbon <path> per arm. The arms are FILLED (fill=stroke)
	// for the solid-limb look — the Hydra's identity vs. the open-stroke Frond. Nothing
	// here is nested per-joint; React mounts ARMS paths and never reconciles them again.
	return (
		<HTMLContainer style={{ width: w, height: h, pointerEvents: 'all' }}>
			<svg width={w} height={h} style={{ overflow: 'visible', display: 'block' }}>
				<g ref={bodyRef}>
					{/* Central body: same native-style values as the arms. */}
					<circle cx={0} cy={0} r={bodyR} fill={stroke} stroke={stroke} strokeWidth={strokeWidth} />
					{Array.from({ length: dna.arms }, (_, a) => (
						<path
							key={a}
							ref={(el) => {
								armRefs.current[a] = el
							}}
							d={restD(a)}
							fill={stroke}
							stroke={stroke}
							strokeWidth={strokeWidth * 0.5}
							strokeLinejoin="round"
							strokeDasharray={dashes}
						/>
					))}
				</g>
			</svg>
		</HTMLContainer>
	)
}
