/**
 * RIBBON SHAPE  (a single-path Lissajous creature — maximally dynamic, minimally costly)
 * =====================================================================================
 * The synthesis of everything the bloom→hydra→frond→plume investigation proved
 * (see [[hydra-svg-perf-ceiling]]). One continuous line that traces an evolving
 * Lissajous / harmonograph curve and flows endlessly through curve families — so it
 * reads as a restless, living ribbon — while costing the bare minimum the native
 * tldraw stack allows.
 *
 * EVERY EFFICIENCY, APPLIED:
 *   • ONE <path>. The whole creature is a single polyline; we rewrite its `d` once
 *     per frame → ONE setAttribute. (Animated-DOM-write count is a real cost; this is
 *     the floor: 1.)
 *   • POLYLINE `d` (M..L..), never Bézier — no per-frame curve tessellation (the cliff).
 *   • PURE PARAMETRIC, not even FK — each sample is a direct sin() of its arc position
 *     + the drifting clock, so there's no accumulation; cheapest possible per-point.
 *   • NO `willChange` (per-element layers were the bloom's GPU cliff). Freezes when culled.
 *   • Native STYLES only (color/size/dash). We do NOT cut paint by degrading a style —
 *     the shape is inherently light (one open stroke), so paint stays low BY DESIGN.
 *
 * "EXTREMELY DYNAMIC" comes free here: because it's one `d` we rebuild every frame, the
 * whole SHAPE can morph (not just oscillate). The Lissajous frequencies and phases SLOWLY
 * DRIFT with the clock (interference of slow waves), so the curve continuously reshapes
 * through families — it never looks periodic or static.
 *
 * Pure function of synced `seed`/`speed`/size + the shared clock → identical on every
 * client, nothing in the store, no referee (CLAUDE.md gotchas #5 & #7).
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
import { ribbonShapeValidators } from 'shared/shape-schemas'
import { creatureClock, subscribeCreatureClock } from '../creature/clock'

// ── 1. THE SHAPE TYPE ────────────────────────────────────────────────────────
export type RibbonShapeProps = {
	w: number
	h: number
	// Deterministic seed: the Lissajous frequency ratios + phase offsets. Same on every
	// client = identical ribbon. The animation is computed locally each frame.
	seed: number
	// Flow rate. Higher = faster morphing. The local clock multiplies it.
	speed: number
	// NATIVE tldraw style props only (CLAUDE.md gotcha #8): color/size/dash.
	color: TLDefaultColorStyle
	size: TLDefaultSizeStyle
	dash: TLDefaultDashStyle
}

export type RibbonShape = TLBaseShape<'ribbon', RibbonShapeProps>

// REGISTER THE TYPE (required — TLShape is a closed union in v5; gotcha #1).
declare module 'tldraw' {
	interface TLGlobalShapePropsMap {
		ribbon: RibbonShapeProps
	}
}

// ── 2. TUNING ────────────────────────────────────────────────────────────────
const STROKE_SIZES: Record<TLDefaultSizeStyle, number> = { s: 1.25, m: 2, l: 3, xl: 6 }

// SAMPLES along the curve. More = smoother ribbon AND more polyline points, but it's
// still ONE path / ONE write — points are paint+JS cost, not DOM-write cost. ~220 reads
// as a continuous flowing line.
const SAMPLES = 220

/** Cheap fixed-precision rounder for the per-frame `d` string (toFixed is slow). */
const r1 = (x: number) => ((x * 10) | 0) / 10

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
 * Points → path `d`. Polyline (M..L..) by default; tldraw's NATIVE hand-drawn pipeline
 * (getStrokePoints → getSvgPathFromStrokePoints, STROKED not filled) for 'draw'. Same
 * proven helper as PlumeShape.
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
export class RibbonShapeUtil extends ShapeUtil<RibbonShape> {
	static override type = 'ribbon' as const
	static override props = ribbonShapeValidators as RecordProps<RibbonShape>

	getDefaultProps(): RibbonShape['props'] {
		return {
			w: 240,
			h: 240,
			seed: Math.round(Math.random() * 1e6),
			speed: 1,
			color: 'light-blue',
			size: 'm',
			dash: 'solid',
		}
	}

	getGeometry(shape: RibbonShape): Geometry2d {
		return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
	}

	override canResize() {
		return true
	}
	override onResize(shape: RibbonShape, info: TLResizeInfo<RibbonShape>) {
		return resizeBox(shape, info)
	}

	component(shape: RibbonShape) {
		return <RibbonBody shape={shape} />
	}

	getIndicatorPath(shape: RibbonShape) {
		const path = new Path2D()
		path.roundRect(0, 0, shape.props.w, shape.props.h, 8)
		return path
	}
}

// ── 4. THE RENDER + IMPERATIVE ANIMATION ─────────────────────────────────────
function RibbonBody({ shape }: { shape: RibbonShape }) {
	const { w, h, seed, speed, color, size, dash } = shape.props
	const editor = useEditor()

	useEffect(() => subscribeCreatureClock(editor), [editor])

	// THE one and only animated node: a single <path>. We rewrite its `d` each frame.
	const ribbonRef = useRef<SVGPathElement | null>(null)

	const { stroke, strokeWidth } = useValue(
		'ribbonDisplay',
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
	const isDraw = dash === 'draw'

	const cx = w / 2
	const cy = h / 2
	const ax = w * 0.42 // x amplitude (fills most of the box)
	const ay = h * 0.42 // y amplitude

	// DNA — the Lissajous "identity" from the seed: integer-ish base frequency ratios
	// (so the figure is a recognisable Lissajous), phase offsets, and the slow drift
	// rates that morph it. Pure function of seed → same ribbon on every client.
	const dna = useMemo(() => {
		const rand = (i: number) => {
			const v = Math.sin((seed * 100 + i) * 127.1 + 311.7) * 43758.5453
			return v - Math.floor(v)
		}
		return {
			fx: 2 + Math.floor(rand(0) * 3), // x base frequency 2..4
			fy: 3 + Math.floor(rand(1) * 3), // y base frequency 3..5
			phx: rand(2) * Math.PI * 2, // x phase
			phy: rand(3) * Math.PI * 2, // y phase
			// Slow drift rates (different + irrational-ish) so the curve never re-phases.
			dfx: 0.05 + rand(4) * 0.06, // how fast fx wobbles
			dfy: 0.04 + rand(5) * 0.06,
			dphx: 0.21 + rand(6) * 0.13, // how fast the phases sweep
			dphy: 0.17 + rand(7) * 0.13,
			// A 2nd harmonic mixed in, for richer (non-pure-Lissajous) wandering.
			harm: 0.12 + rand(8) * 0.16,
		}
	}, [seed])

	// IMPERATIVE ANIMATION. Sample the evolving Lissajous curve into ONE polyline and
	// write it. Each sample is a direct sin() of its arc position s∈[0,1] + the drifting
	// clock — no FK accumulation, the cheapest per-point. The frequencies/phases DRIFT
	// with t, so the whole figure morphs continuously (never periodic).
	useReactor(
		'ribbonFlow',
		() => {
			if (editor.getCulledShapes().has(shape.id)) return
			const path = ribbonRef.current
			if (!path) return

			const t = creatureClock.get() * (0.5 + Math.max(0, speed))

			// Drift the frequencies and phases slowly → the curve flows through families.
			const fx = dna.fx + Math.sin(t * dna.dfx) * 1.2
			const fy = dna.fy + Math.cos(t * dna.dfy) * 1.2
			const phx = dna.phx + t * dna.dphx
			const phy = dna.phy + t * dna.dphy

			const pts: { x: number; y: number }[] = new Array(SAMPLES + 1)
			for (let i = 0; i <= SAMPLES; i++) {
				const s = (i / SAMPLES) * Math.PI * 2 // parameter around the curve
				// Base Lissajous + a smaller 2nd-harmonic wobble on each axis → organic.
				const x = cx + ax * (Math.sin(fx * s + phx) + dna.harm * Math.sin(fx * 2 * s - phy))
				const y = cy + ay * (Math.sin(fy * s + phy) + dna.harm * Math.sin(fy * 2 * s + phx))
				pts[i] = { x, y }
			}
			path.setAttribute('d', pointsToD(pts, isDraw, strokeWidth))
		},
		[editor, shape.id, dna, cx, cy, ax, ay, speed, isDraw, strokeWidth]
	)

	// THE TREE. Literally ONE <path>. `d` is a placeholder at mount; the reactor rewrites
	// it each frame. Native stroke styling only; stroked (never filled) so 'draw' works.
	return (
		<HTMLContainer style={{ width: w, height: h, pointerEvents: 'all' }}>
			<svg width={w} height={h} style={{ overflow: 'visible', display: 'block' }}>
				<path
					ref={ribbonRef}
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
