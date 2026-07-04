/**
 * PLUME SHAPE  (a dotted feather: curved spine + many barbs with glowing tips)
 * ===========================================================================
 * A port of the #つぶやきProcessing "dotted plume/feather" sketch (a curved central
 * spine with dozens of dotted filaments branching off, each ending in a bright tip)
 * — built as the MOST EFFICIENT design the native tldraw stack allows, using every
 * lesson from the bloom→hydra→frond investigation (see [[hydra-svg-perf-ceiling]]).
 *
 * THE KEY INSIGHT (why this is efficient where a literal port is NOT):
 *   The original draws ~10,000 independent dots/frame. On SVG that would be ~10,000
 *   ANIMATED NODES — unusable (animated-node count IS the ceiling). BUT the dots are
 *   not a free cloud: they're organised into STRANDS. So each barb is ONE dotted
 *   `<path>`, and the dots are PAINT (`stroke-dasharray="0 gap"` + round caps =
 *   a string of dots along the path), NOT elements. ~70 barbs → ~70 `d` writes/frame,
 *   not 10,000 nodes. This is the Frond's FK-polyline pattern, applied to a spine.
 *
 * STRUCTURE:
 *   • SPINE: one curved polyline (the rachis), FK-walked from a seeded base curve.
 *   • BARBS: ~BARBS short dotted polylines hung along the spine, alternating sides,
 *     each FK-curled per frame by a travelling interference wave (the writhe).
 *   • TIPS: one small bright `<circle>` per barb, moved to the barb's end each frame
 *     (the glowing tip — the signature of the reference image).
 *
 * PER-FRAME COST: 1 spine `d` + one `d` per barb ≈ 1 + (40..72) writes. (No tip
 * elements — each barb's own end hooks/curls.)
 * No Bézier (polylines only), no `willChange`, freezes when culled. Pure function of
 * synced `seed`/`speed`/size + the shared clock → identical on every client, nothing
 * extra in the store, no referee (CLAUDE.md gotchas #5 & #7).
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
import { plumeShapeValidators } from '../../shared/shape-schemas'
import { creatureClock, subscribeCreatureClock } from '../creature/clock'

// ── 1. THE SHAPE TYPE ────────────────────────────────────────────────────────
export type PlumeShapeProps = {
	w: number
	h: number
	// Deterministic seed: spine curve, barb count/length/phase. Same on every client.
	seed: number
	// Writhe rate. Higher = faster shimmer. The local clock multiplies it.
	speed: number
	// NATIVE tldraw style props. color → hue; size → stroke/dot weight; dash → the
	// LINE STYLE (dotted is the signature look, but solid/dashed/draw are selectable
	// from the style panel like any other shape).
	color: TLDefaultColorStyle
	size: TLDefaultSizeStyle
	dash: TLDefaultDashStyle
}

export type PlumeShape = TLBaseShape<'plume', PlumeShapeProps>

// REGISTER THE TYPE (required — TLShape is a closed union in v5; gotcha #1).
declare module 'tldraw' {
	interface TLGlobalShapePropsMap {
		plume: PlumeShapeProps
	}
}

// ── 2. TUNING ────────────────────────────────────────────────────────────────
const STROKE_SIZES: Record<TLDefaultSizeStyle, number> = { s: 1, m: 1.6, l: 2.4, xl: 4.5 }

// FIXED, EFFICIENCY-TUNED defaults (no per-instance randomization). The dominant
// per-frame cost is the number of animated barb <path>s, so we keep the count modest
// while still reading as a dense feather. ~BARBS + 1 `d` writes/shape.
const BARBS = 32 // filaments along the spine (both sides)
const SPINE_JOINTS = 12 // resolution of the central spine polyline
const BARB_JOINTS = 6 // resolution along each barb (curl smoothness vs. point count)

/** Cheap fixed-precision rounder for the per-frame `d` strings (toFixed is slow). */
const r1 = (x: number) => ((x * 10) | 0) / 10

/** Linearly resample a sparse polyline to `n` evenly-spaced points. perfect-freehand
 *  expects DENSE pen-stroke input; our barbs are a ~7-point skeleton, so feeding them
 *  raw makes freehand balloon between far-apart points. Densifying fixes that. */
function densify(pts: { x: number; y: number }[], n: number): { x: number; y: number }[] {
	if (pts.length < 2) return pts
	// Cumulative arc length so we can sample at even spacing.
	const seg: number[] = [0]
	let total = 0
	for (let i = 1; i < pts.length; i++) {
		total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y)
		seg.push(total)
	}
	if (total === 0) return pts
	const out: { x: number; y: number }[] = []
	let j = 1
	for (let k = 0; k < n; k++) {
		const target = (total * k) / (n - 1)
		while (j < pts.length - 1 && seg[j] < target) j++
		const t = (target - seg[j - 1]) / (seg[j] - seg[j - 1] || 1)
		out.push({ x: pts[j - 1].x + (pts[j].x - pts[j - 1].x) * t, y: pts[j - 1].y + (pts[j].y - pts[j - 1].y) * t })
	}
	return out
}

/**
 * Turn a list of points into a path `d`. Two modes:
 *   • draw=false → a cheap POLYLINE (`M..L..`).
 *   • draw=true  → tldraw's NATIVE hand-drawn path — EXACTLY how DrawShapeUtil makes
 *     its stroke: getStrokePoints → getSvgPathFromStrokePoints. This returns a smoothed
 *     CENTERLINE path (quadratic curves), meant to be STROKED (NOT filled — filling a
 *     centerline balloons into a blob, which was the earlier bug). We densify first so
 *     freehand has pen-stroke-like input. The visible WEIGHT comes from the render's
 *     strokeWidth, so the `size` style controls it naturally.
 */
function pointsToD(pts: { x: number; y: number }[], draw: boolean, sw: number): string {
	if (draw) {
		const dense = densify(pts, 24)
		const sp = getStrokePoints(dense, { size: sw, streamline: 0.5, last: true })
		return getSvgPathFromStrokePoints(sp, false) // open centerline (barb has a free tip)
	}
	let d = ''
	for (let i = 0; i < pts.length; i++) d += (i === 0 ? 'M' : 'L') + `${r1(pts[i].x)} ${r1(pts[i].y)}`
	return d
}

/**
 * strokeDasharray for the chosen LINE STYLE (in stroke-width units). `dotted` is the
 * plume's signature (zero-length dashes + round caps = round dots); the others let the
 * style panel switch the barbs to a continuous/dashed/hand-drawn line. Returns
 * undefined for a solid continuous line. (Same scheme as CreatureShape/HydraShape.)
 */
function dashArray(dash: TLDefaultDashStyle, sw: number): string | undefined {
	switch (dash) {
		case 'dotted':
			return `0 ${sw * 2.2}` // native-looking dot spacing (kept for the correct look)
		case 'dashed':
			return `${sw * 2.5} ${sw * 2}`
		default:
			return undefined // 'solid' | 'draw' → continuous line
	}
}

// ── 3. THE UTIL ──────────────────────────────────────────────────────────────
export class PlumeShapeUtil extends ShapeUtil<PlumeShape> {
	static override type = 'plume' as const
	static override props = plumeShapeValidators as RecordProps<PlumeShape>

	getDefaultProps(): PlumeShape['props'] {
		return {
			w: 240,
			h: 320,
			// Seed only desyncs the per-barb wave phases (so barbs don't move in lockstep)
			// — it no longer changes the silhouette. Cheap, and keeps the motion organic.
			seed: Math.round(Math.random() * 1e6),
			speed: 1,
			color: 'white',
			size: 'm',
			dash: 'dotted', // the signature look (changeable in the style panel)
		}
	}

	getGeometry(shape: PlumeShape): Geometry2d {
		return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
	}

	override canResize() {
		return true
	}
	override onResize(shape: PlumeShape, info: TLResizeInfo<PlumeShape>) {
		return resizeBox(shape, info)
	}

	component(shape: PlumeShape) {
		return <PlumeBody shape={shape} />
	}

	getIndicatorPath(shape: PlumeShape) {
		const path = new Path2D()
		path.roundRect(0, 0, shape.props.w, shape.props.h, 8)
		return path
	}
}

// ── 4. THE RENDER + IMPERATIVE ANIMATION ─────────────────────────────────────
function PlumeBody({ shape }: { shape: PlumeShape }) {
	const { w, h, seed, speed, color, size, dash } = shape.props
	const editor = useEditor()

	useEffect(() => subscribeCreatureClock(editor), [editor])

	// ALL barbs share ONE <path>. SVG `d` allows many disconnected sub-paths (each `M`
	// lifts the pen), so we concatenate every barb's sub-path into a single `d` and do
	// ONE setAttribute per frame instead of one-per-barb. That drops the Plume from
	// ~BARBS+1 animated DOM writes to just 2 (barbs + spine) — the biggest perf lever,
	// since DOM-write count is the real ceiling. The barbs already share paint (stroke/
	// width/dash), so a merged path loses nothing. The spine stays its own <path> (it's
	// slightly heavier-weighted). Each barb's sub-path starts with `M`, so the dotted
	// dash resets cleanly per barb (no dot bleeding across the gaps between them).
	const barbsRef = useRef<SVGPathElement | null>(null)
	const spineRef = useRef<SVGPathElement | null>(null)

	const { stroke, dotW } = useValue(
		'plumeDisplay',
		() => {
			const theme = editor.getCurrentTheme()
			const colors = theme.colors[editor.getColorMode()]
			return {
				stroke: getColorValue(colors, color, 'solid'),
				dotW: theme.strokeWidth * STROKE_SIZES[size],
			}
		},
		[editor, color, size]
	)
	// (Dot/dash spacing is computed per-instance below as `instanceDashes`, since it
	// depends on the seeded barb thickness.)
	// 'draw' = tldraw's NATIVE hand-drawn look: instead of stroking the polyline, run
	// the barb's points through perfect-freehand (the Draw-shape pipeline, gotcha #8)
	// to get a tapered, organic FILLED outline. This is a genuinely different render
	// path (filled, not stroked, no dash) AND costs more per frame (freehand runs per
	// barb per tick, since the barbs move) — so it's gated behind this one flag.
	const isDraw = dash === 'draw'
	// Draw-mode STROKE weight. Derived from the dot weight (so the `size` style controls
	// it) but a bit heavier — a hand-drawn line reads better with some body than a 1px
	// dot. This is a plain strokeWidth (the path is stroked, not filled), so size steps
	// are directly visible.
	const drawW = dotW * 1.8

	const cx = w / 2
	const cy = h / 2

	// DNA — FIXED structure (no per-instance randomization). The seed ONLY desyncs each
	// barb's wave phase, so barbs writhe independently (organic) while every plume shares
	// the same efficient silhouette. Everything else is a constant.
	const dna = useMemo(() => {
		const rand = (i: number) => {
			const v = Math.sin((seed * 100 + i) * 127.1 + 311.7) * 43758.5453
			return v - Math.floor(v)
		}
		const spineLen = h * 0.82
		// Barbs: evenly spread along the spine (skip the very base), alternating sides.
		// Length follows a fixed leaf profile (longest mid-spine). Sign alternates so
		// neighbours curl opposite ways. ONLY the wave phases come from the seed.
		const barbs = Array.from({ length: BARBS }, (_, i) => {
			const u = 0.08 + 0.9 * (i / (BARBS - 1)) // position along spine [~0..1]
			return {
				u,
				side: i % 2 === 0 ? 1 : -1, // alternate left/right
				phase: rand(i + 10) * Math.PI * 2, // seed-desynced writhe
				phase2: rand(i + 10) * Math.PI * 2 * 1.3,
				lenScale: 0.5 + 0.9 * Math.sin(u * Math.PI), // leaf profile (longest mid-spine)
				curlSign: i % 3 === 0 ? -1 : 1, // mostly one way, some counter-curl
			}
		})
		return { spineLen, spineBend: 0.5, spineWobble: 0.6, freqB: 2.1, barbs }
	}, [seed, h])

	const barbLen = h * 0.18 // base barb length (fixed; per-barb leaf profile scales it)
	const barbW = dotW
	const barbDrawW = drawW
	const instanceDashes = dashArray(dash, barbW)

	// Helper: point on the spine at parameter u∈[0,1], in shape-local coords. Also
	// returns the local tangent angle so barbs can branch PERPENDICULAR to the spine.
	// (Pure function of u + the seeded spine params + a slow time sway.)
	const spinePoint = (u: number, t: number): { x: number; y: number; ang: number } => {
		// Vertical rachis from top→bottom, curved sideways by an S-wave + slow sway.
		const y = cy - dna.spineLen / 2 + u * dna.spineLen
		const sway = Math.sin(u * Math.PI * dna.spineWobble * 3 + t * 0.5) * (w * 0.16)
		const x = cx + dna.spineBend * (u - 0.5) * w * 0.5 + sway
		// Tangent angle via a small finite difference in u.
		const e = 0.01
		const y2 = cy - dna.spineLen / 2 + Math.min(1, u + e) * dna.spineLen
		const sway2 = Math.sin(Math.min(1, u + e) * Math.PI * dna.spineWobble * 3 + t * 0.5) * (w * 0.16)
		const x2 = cx + dna.spineBend * (Math.min(1, u + e) - 0.5) * w * 0.5 + sway2
		return { x, y, ang: Math.atan2(y2 - y, x2 - x) }
	}

	// IMPERATIVE ANIMATION. Rewrite the spine polyline, then each barb polyline (FK-
	// curled), then move each glowing tip. All polylines (M..L..) — no Bézier, no
	// transforms, no willChange. One `d`/spine + one `d`/barb + one cx/cy/tip.
	useReactor(
		'plumeWrithe',
		() => {
			if (editor.getCulledShapes().has(shape.id)) return

			const t = creatureClock.get() * (0.5 + Math.max(0, speed))

			// SPINE — sample the curve into points, then emit polyline or freehand `d`.
			const spine = spineRef.current
			if (spine) {
				const pts: { x: number; y: number }[] = []
				for (let s = 0; s <= SPINE_JOINTS; s++) pts.push(spinePoint(s / SPINE_JOINTS, t))
				spine.setAttribute('d', pointsToD(pts, isDraw, (isDraw ? barbDrawW : barbW) * 1.3))
			}

			// Wave time-args (fixed tuning — same for every plume; only the per-barb phase
			// from the seed differs, which is what keeps the motion organic).
			const w1 = t * 1.5
			const w2 = t * 1.5 * dna.freqB
			const lagStep = 0.7 // how fast the wave's phase advances per joint along a barb
			const barbsPath = barbsRef.current
			if (!barbsPath) return
			const barbs = dna.barbs
			const step = barbLen / BARB_JOINTS
			const bw = isDraw ? barbDrawW : barbW

			// Build EVERY barb's sub-path and concatenate into ONE `d` (each starts with
			// `M`, so they're disconnected) → a single setAttribute for all 32 barbs.
			let allD = ''
			for (let i = 0; i < barbs.length; i++) {
				const b = barbs[i]

				// Anchor on the spine; branch PERPENDICULAR to the local spine tangent,
				// on this barb's side.
				const anchor = spinePoint(b.u, t)
				let dir = anchor.ang + (Math.PI / 2) * b.side // perpendicular, chosen side
				let px = anchor.x
				let py = anchor.y
				const len = step * (b.lenScale * 1.4)

				// FK-walk the barb outward, curling each joint by the travelling wave. The
				// curl RAMPS UP sharply toward the END so the barb HOOKS/CURLS at its tip
				// (the reference's signature) — no separate tip element needed, the line's
				// own end does it. Collect the points; pointsToD emits polyline or freehand.
				const pts: { x: number; y: number }[] = [{ x: px, y: py }]
				for (let s = 0; s < BARB_JOINTS; s++) {
					const f = s / (BARB_JOINTS - 1) // 0 at root → 1 at tip
					const endRamp = 0.3 + 1.5 * f * f // quadratic ramp: gentle base, tight tip
					const lag = s * lagStep
					const wave = Math.sin(w1 + b.phase + lag) + 0.5 * Math.sin(w2 + b.phase2 + lag)
					// Resting hook + writhe, both amplified at the tip (fixed tuning).
					dir += (0.18 * b.curlSign + wave * 0.15 * b.curlSign) * endRamp
					px += Math.cos(dir) * len
					py += Math.sin(dir) * len
					pts.push({ x: px, y: py })
				}
				allD += pointsToD(pts, isDraw, bw)
			}
			barbsPath.setAttribute('d', allD)
		},
		[editor, shape.id, dna, cx, cy, w, h, barbLen, speed, isDraw, barbW, barbDrawW]
	)

	// THE TREE. A spine <path> + one dotted barb <path> + one bright tip <circle> per
	// barb. All `d`/cx/cy are placeholders at mount; the reactor rewrites them. Nothing
	// nested, nothing reconciled after mount — motion is the imperative writes above.
	// Paint props. ALL styles (including 'draw') are STROKED — `getSvgPathFromStrokePoints`
	// returns a centerline meant to be stroked, NOT filled (filling it blobs). 'draw' just
	// drops the dash (a continuous smoothed hand-drawn line); the others keep their dash.
	// Weight is always `strokeWidth`, so the `size` style controls it in every mode.
	const linePaint = {
		fill: 'none' as const,
		stroke,
		strokeLinecap: 'round' as const,
		strokeLinejoin: 'round' as const,
		strokeDasharray: isDraw ? undefined : instanceDashes,
	}

	return (
		<HTMLContainer style={{ width: w, height: h, pointerEvents: 'all' }}>
			<svg width={w} height={h} style={{ overflow: 'visible', display: 'block' }}>
				{/* Central spine — same line style as the barbs, slightly heavier. */}
				<path ref={spineRef} {...linePaint} strokeWidth={(isDraw ? barbDrawW : barbW) * 1.3} />
				{/* ALL barbs in ONE <path> (multi-subpath `d`, rewritten once/frame). */}
				<path ref={barbsRef} {...linePaint} strokeWidth={isDraw ? barbDrawW : barbW} />
			</svg>
		</HTMLContainer>
	)
}
