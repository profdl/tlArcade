/**
 * SPIDER SHAPE  (a scuttling top-view spider — ONE <path>, ant-style gait)
 * ========================================================================
 * A spider drawn as a SINGLE animated <path>, the cheapest design the native tldraw
 * stack allows (the lesson of bloom→hydra→frond→plume→ribbon; see [[hydra-svg-perf-ceiling]]).
 * It animates like the existing ant/bug creature — an alternating-set walking gait where
 * the legs step fore↔aft and bend at the knee — but the WHOLE creature is one polyline `d`
 * we rewrite once per frame.
 *
 * EVERY EFFICIENCY, APPLIED (the same as RibbonShape, plus PlumeShape's merge trick):
 *   • ONE <path>. SVG `d` allows disconnected sub-paths — every `M` lifts the pen — so the
 *     body and all eight legs become ONE multi-subpath `d` written with ONE setAttribute.
 *     (Animated-DOM-write count is the real ceiling; this is the floor: 1.)
 *   • POLYLINE `d` (M..L..) only, never Bézier — no per-frame curve tessellation (the cliff).
 *   • NO `willChange`; freezes when culled.
 *   • Native STYLES only (color/size/dash). Thin open strokes → paint stays low BY DESIGN.
 *
 * WHY IT READS AS A SPIDER, NOT AN ABSTRACT FIGURE:
 *   • A small BODY blob at centre (cephalothorax + a slightly larger abdomen behind it),
 *     each drawn as a tight closed loop sub-path — a filled-looking dot made of stroke.
 *   • EIGHT LEGS, four per side, each a 2-bone (femur→tibia) bent line hinged on the body.
 *
 * THE GAIT (ant-style, see client/creature/variants/ant.ts):
 *   The legs split into two alternating sets of four (a spider's diagonal sequence). One set
 *   swings FORWARD while the other pushes BACK, the knee bending as each foot plants — the
 *   same fore/aft-step + knee-bend that reads as "walking" on the ant, here driven by a pure
 *   sin() of the shared clock per leg. The body bobs a hair on the beat. Pure function of
 *   synced `seed`/`speed`/size + the clock → identical on every client, nothing in the store,
 *   no referee (CLAUDE.md gotchas #5 & #7).
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
import { spiderShapeValidators } from '../../shared/shape-schemas'
import { creatureClock, subscribeCreatureClock } from '../creature/clock'

// ── 1. THE SHAPE TYPE ────────────────────────────────────────────────────────
export type SpiderShapeProps = {
	w: number
	h: number
	// Deterministic seed: per-leg jitter + step desync. Same on every client = identical
	// spider. The animation itself is computed locally each frame from the shared clock.
	seed: number
	// Scuttle rate. Higher = faster step cadence. The local clock multiplies it.
	speed: number
	// NATIVE tldraw style props only (CLAUDE.md gotcha #8): color/size/dash.
	color: TLDefaultColorStyle
	size: TLDefaultSizeStyle
	dash: TLDefaultDashStyle
}

export type SpiderShape = TLBaseShape<'spider', SpiderShapeProps>

// REGISTER THE TYPE (required — TLShape is a closed union in v5; gotcha #1).
declare module 'tldraw' {
	interface TLGlobalShapePropsMap {
		spider: SpiderShapeProps
	}
}

// ── 2. TUNING ────────────────────────────────────────────────────────────────
const STROKE_SIZES: Record<TLDefaultSizeStyle, number> = { s: 1.25, m: 2, l: 3, xl: 6 }

const LEGS_PER_SIDE = 4 // four legs each side → eight total, like a real spider
const BODY_LOOP_STEPS = 18 // resolution of each body-blob loop (built once, sampled cheap)

/**
 * Append a coordinate PAIR to the per-frame `d`, as a command + two INTEGER-ish numbers.
 * PERF: the old path built an intermediate {x,y}[] array each frame, then a second pass
 * stringified it through `${r1(x)} ${r1(y)}` (template interpolation forces float→string
 * with full precision, then we sliced precision back off — wasteful twice over). Here we
 * skip the array entirely and round to WHOLE pixels with `(x + 0.5) | 0` (a single add +
 * bitwise truncate — no divide, no decimal tail like 12.300000001). At creature scale a
 * spider is ~100px, so whole-pixel coords are visually identical to the old 0.1px ones but
 * produce a much shorter string and zero GC churn. `cmd` is 'M' to start a sub-path, 'L' to
 * continue. Returns the grown string (callers chain it).
 */
function appendPt(d: string, cmd: string, x: number, y: number): string {
	return d + cmd + ((x + 0.5) | 0) + ' ' + ((y + 0.5) | 0)
}

/** strokeDasharray for the chosen native line style (in stroke-width units). */
function dashArray(dash: TLDefaultDashStyle, sw: number): string | undefined {
	switch (dash) {
		case 'dotted':
			return `0 ${sw * 2.2}`
		case 'dashed':
			return `${sw * 2.5} ${sw * 2}`
		default:
			return undefined // 'solid' | 'draw' → continuous line
	}
}

/**
 * Hand-drawn ('draw' dash) ONE sub-path from a point list, via tldraw's NATIVE pipeline
 * (getStrokePoints → getSvgPathFromStrokePoints, STROKED not filled). Only used on the
 * 'draw' branch — the common polyline branch builds its `d` directly with appendPt and
 * never allocates a point array. `closed` joins the last point back to the first.
 */
function drawPathD(pts: { x: number; y: number }[], sw: number, closed: boolean): string {
	const sp = getStrokePoints(pts, { size: sw, streamline: 0.5, last: true })
	return getSvgPathFromStrokePoints(sp, closed)
}

// ── 3. THE UTIL ──────────────────────────────────────────────────────────────
export class SpiderShapeUtil extends ShapeUtil<SpiderShape> {
	static override type = 'spider' as const
	static override props = spiderShapeValidators as RecordProps<SpiderShape>

	getDefaultProps(): SpiderShape['props'] {
		return {
			w: 200,
			h: 200,
			seed: Math.round(Math.random() * 1e6),
			speed: 1,
			color: 'black',
			size: 'm',
			dash: 'solid',
		}
	}

	getGeometry(shape: SpiderShape): Geometry2d {
		return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
	}

	override canResize() {
		return true
	}
	override onResize(shape: SpiderShape, info: TLResizeInfo<SpiderShape>) {
		return resizeBox(shape, info)
	}

	component(shape: SpiderShape) {
		return <SpiderBody shape={shape} />
	}

	getIndicatorPath(shape: SpiderShape) {
		const path = new Path2D()
		path.roundRect(0, 0, shape.props.w, shape.props.h, 8)
		return path
	}
}

// ── 4. THE RENDER + IMPERATIVE ANIMATION ─────────────────────────────────────
function SpiderBody({ shape }: { shape: SpiderShape }) {
	const { w, h, seed, speed, color, size, dash } = shape.props
	const editor = useEditor()

	useEffect(() => subscribeCreatureClock(editor), [editor])

	// THE one and only animated node: a single <path>. Body + all eight legs are
	// concatenated sub-paths (each starts with `M`) in its `d`, rewritten once/frame.
	const pathRef = useRef<SVGPathElement | null>(null)

	// PERF: two SCALAR useValues instead of one returning a fresh {stroke,strokeWidth}
	// object. useValue compares results by reference, so an object literal recomputed each
	// run never equals the last and can do extra work; primitives compare cleanly and only
	// re-fire on a genuine palette/dark-mode/size change.
	const stroke = useValue(
		'spiderStroke',
		() => getColorValue(editor.getCurrentTheme().colors[editor.getColorMode()], color, 'solid'),
		[editor, color]
	)
	const strokeWidth = useValue(
		'spiderStrokeWidth',
		() => editor.getCurrentTheme().strokeWidth * STROKE_SIZES[size],
		[editor, size]
	)
	const dashes = dashArray(dash, strokeWidth)
	const isDraw = dash === 'draw'

	const cx = w / 2
	const cy = h / 2

	// DNA — the spider's fixed anatomy plus seed-only desync. Forward is −x (head-left),
	// matching the creature variants. LEGS hinge on the cephalothorax and fan out to four
	// fore/aft stations per side. Each leg gets a tiny seeded jitter so the gait isn't
	// mechanically perfect. The two alternating sets (diagonal gait) are by leg index.
	const dna = useMemo(() => {
		const rand = (i: number) => {
			const v = Math.sin((seed * 100 + i) * 127.1 + 311.7) * 43758.5453
			return v - Math.floor(v)
		}

		// Body blobs: cephalothorax (front, smaller) + abdomen (rear, larger). Drawn as
		// closed loops so they read as solid dots made of stroke.
		const ctR = h * 0.1 // cephalothorax radius
		const abR = h * 0.15 // abdomen radius (bigger, behind)
		const ctCx = cx - h * 0.02 // cephalothorax just forward of centre (−x = forward)
		const abCx = cx + h * 0.16 // abdomen behind it

		// LEG STATIONS — four per side, fanned fore→aft. Each leg's foot rest sits OUT (±y)
		// and at its fore/aft offset, so the rest pose splays like a spider. `set` (0/1)
		// splits the eight legs into the two alternating diagonal groups.
		type Leg = {
			hip: { x: number; y: number }
			side: 1 | -1 // +1 = screen-down side, −1 = up
			foreAft: number // foot fore(−)/aft(+) of hip, fraction of w
			reach: number // foot out distance, fraction of h
			set: 0 | 1 // which alternating group steps together
			jitter: number
			// Per-frame-invariant terms, precomputed (see the perf note where they're set).
			phaseOffset: number // set phase (0/π) + seeded jitter, baked once
			footBaseX: number // hip.x + foreAft·w  (add bob + swing per frame)
			footBaseY: number // hip.y + side·reach·h (add bob per frame)
			swingAmp: number // fore/aft stride amplitude
			kneeOutBase: number // knee outward kick, constant part
			kneeOutLift: number // knee outward kick, ·lift part
		}
		const legs: Leg[] = []
		// fore/aft fractions for the four stations (front reaches ahead, rear behind).
		const stations = [-0.2, -0.07, 0.07, 0.2]
		for (let s = 0; s < LEGS_PER_SIDE; s++) {
			const foreAft = stations[s]
			const reach = 0.34
			// hips sit on the cephalothorax edge, fanned slightly along the body.
			const hipX = ctCx + foreAft * w * 0.35
			for (const side of [-1, 1] as const) {
				// Diagonal gait: opposite corners step together. A leg's group flips with both
				// its side and its station parity, so adjacent legs on a side alternate sets
				// and the planted feet stay spread (a stable, spidery sequence).
				const set = (((s + (side > 0 ? 1 : 0)) % 2) as 0 | 1)
				const jitter = (rand(legs.length) - 0.5) * 0.5
				const hipY = cy + side * ctR * 0.7
				legs.push({
					hip: { x: hipX, y: hipY },
					side,
					foreAft,
					reach,
					set,
					jitter,
					// PERF: hoist each leg's per-frame-INVARIANT terms out of the hot loop. The
					// foot's fore/aft base (foreAft·w) and outward reach (side·reach·h) never change
					// frame-to-frame; only the small `swing`/`lift` deltas do. Precompute the
					// constants (incl. the baked set-phase + jitter) once here so the reactor does
					// adds, not multiplies. phaseOffset == the original `(set?0:π) + jitter`.
					phaseOffset: (set === 0 ? 0 : Math.PI) + jitter,
					footBaseX: hipX + foreAft * w, // hip.x + foreAft·w (before swing + bob)
					footBaseY: hipY + side * reach * h, // hip.y + side·reach·h
					swingAmp: w * 0.05,
					kneeOutBase: side * h * 0.07,
					kneeOutLift: side * h * 0.05,
				})
			}
		}

		// PERF: precompute the body-loop UNIT CIRCLE once (cos/sin per step). The reactor scaled
		// these by the radius + offset each frame; the angles never change, so the trig is pure
		// waste per tick. Now the per-frame loop is just multiply-adds over this table.
		const unit: { c: number; s: number }[] = []
		for (let i = 0; i < BODY_LOOP_STEPS; i++) {
			const a = (i / BODY_LOOP_STEPS) * Math.PI * 2
			unit.push({ c: Math.cos(a), s: Math.sin(a) })
		}

		return { ctR, abR, ctCx, abCx, legs, unit }
	}, [cx, cy, w, h, seed])

	// IMPERATIVE ANIMATION. Build the body loops + every leg as polyline sub-paths and write
	// the concatenation in ONE setAttribute. Each leg STEPS: its foot swings fore↔aft on the
	// beat (a pure sin() of the clock + the leg's set phase) and the knee bends as the foot
	// plants — the ant's walking gait, expressed as a 2-bone bent polyline per leg.
	useReactor(
		'spiderScuttle',
		() => {
			if (editor.getCulledShapes().has(shape.id)) return
			const path = pathRef.current
			if (!path) return

			const t = creatureClock.get() * (0.5 + Math.max(0, speed))
			// The walking beat. Insect cadence: a touch brisk (matches the ant's beatScale feel).
			const beat = t * 2.2
			// The body bobs a hair forward/back on the beat (the ant translates; here it's
			// anchored, so a tiny sway sells the effort without drifting off its box).
			const bobX = Math.sin(beat * 2) * (w * 0.006)
			const bobY = Math.cos(beat * 2) * (h * 0.006)
			const oy = cy + bobY // body-loop centre Y this frame (shared by both blobs)
			const unit = dna.unit
			const legs = dna.legs

			// ── DRAW ('draw' dash) BRANCH — rare, allocates point arrays for the freehand
			// pipeline. Kept faithful to the original; perf focus is the common polyline path. ──
			if (isDraw) {
				const loop = (bx: number, r: number) => {
					const pts: { x: number; y: number }[] = []
					for (let i = 0; i < BODY_LOOP_STEPS; i++) pts.push({ x: bx + bobX + unit[i].c * r, y: oy + unit[i].s * r })
					return pts
				}
				let dd = drawPathD(loop(dna.abCx, dna.abR), strokeWidth, true)
				dd += drawPathD(loop(dna.ctCx, dna.ctR), strokeWidth, true)
				for (let i = 0; i < legs.length; i++) {
					const leg = legs[i]
					const ph = beat + leg.phaseOffset
					const swing = Math.sin(ph)
					const cph = Math.cos(ph)
					const lift = cph > 0 ? cph : 0
					const hx = leg.hip.x + bobX
					const hy = leg.hip.y + bobY
					const footX = leg.footBaseX + bobX + swing * leg.swingAmp
					const footY = leg.footBaseY + bobY
					const kx = (hx + footX) / 2
					const ky = (hy + footY) / 2 + leg.kneeOutBase + leg.kneeOutLift * lift
					dd += drawPathD([{ x: hx, y: hy }, { x: kx, y: ky }, { x: footX, y: footY }], strokeWidth, false)
				}
				path.setAttribute('d', dd)
				return
			}

			// ── POLYLINE BRANCH (common) — build `d` DIRECTLY, no intermediate point arrays. ──
			let d = ''
			// BODY: abdomen first (rear), then cephalothorax — both CLOSED loops (append 'Z').
			// Inline the loop so each vertex is one appendPt with no object allocated.
			const abX = dna.abCx + bobX
			const abR = dna.abR
			for (let i = 0; i < BODY_LOOP_STEPS; i++) d = appendPt(d, i === 0 ? 'M' : 'L', abX + unit[i].c * abR, oy + unit[i].s * abR)
			d += 'Z'
			const ctX = dna.ctCx + bobX
			const ctR = dna.ctR
			for (let i = 0; i < BODY_LOOP_STEPS; i++) d = appendPt(d, i === 0 ? 'M' : 'L', ctX + unit[i].c * ctR, oy + unit[i].s * ctR)
			d += 'Z'

			// LEGS: each a 2-bone bent line (hip → knee → foot), stepping on the beat.
			for (let i = 0; i < legs.length; i++) {
				const leg = legs[i]
				// Step phase: the two sets are π apart so they alternate. `swing` is the fore/aft
				// foot motion; `lift` (≥0 half of cos) bends the knee as the foot recovers.
				const ph = beat + leg.phaseOffset
				const swing = Math.sin(ph)
				const cph = Math.cos(ph)
				const lift = cph > 0 ? cph : 0

				const hx = leg.hip.x + bobX
				const hy = leg.hip.y + bobY
				const footX = leg.footBaseX + bobX + swing * leg.swingAmp
				const footY = leg.footBaseY + bobY
				const kx = (hx + footX) / 2
				const ky = (hy + footY) / 2 + leg.kneeOutBase + leg.kneeOutLift * lift

				d = appendPt(d, 'M', hx, hy)
				d = appendPt(d, 'L', kx, ky)
				d = appendPt(d, 'L', footX, footY)
			}

			path.setAttribute('d', d)
		},
		[editor, shape.id, dna, cx, cy, w, h, speed, isDraw, strokeWidth]
	)

	// THE TREE. Literally ONE <path>. `d` is a placeholder at mount; the reactor rewrites it
	// each frame with the body + all eight legs as one multi-subpath polyline. Native stroke
	// styling only; stroked (never filled) so 'draw' works and the body loops read as blobs.
	return (
		<HTMLContainer style={{ width: w, height: h, pointerEvents: 'all' }}>
			<svg width={w} height={h} style={{ overflow: 'visible', display: 'block' }}>
				<path
					ref={pathRef}
					fill="none"
					stroke={stroke}
					strokeWidth={strokeWidth}
					strokeLinecap="round"
					strokeLinejoin="round"
					strokeDasharray={dashes}
				/>
			</svg>
		</HTMLContainer>
	)
}
