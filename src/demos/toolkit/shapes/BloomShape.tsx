/**
 * BLOOM SHAPE  (a stateless radial interference field)
 * ====================================================
 * A hypnotic, breathing flower of light — our answer to the famous
 * #つぶやきProcessing "cosmic bird" tweet, which plots 10,000 dots per frame from
 * one trig formula:
 *
 *     a=(x,y,d=mag(4cos(x/21), y/8-20))=> circle( ... cos(d-t) ... , k*k>15?2:1)
 *
 * That sketch redraws every point every frame on a <canvas>. We CAN'T do that in
 * tldraw with 10k live DOM nodes — that's the React/SVG reconciliation cliff
 * (see the creature-overlay-threshold note). So we keep the SAME aesthetic (a
 * radial wave `cos(d - t)` travelling out from the centre) but make it
 * tldraw-native using the EXACT trick CreatureShape uses:
 *
 *   • Build the geometry ONCE.  N "petal" <g> groups are created at mount, each a
 *     simple shape (a line + a dot) pointing outward at a fixed angle. They never
 *     change — so the <path>/<circle> elements never reconcile.
 *   • Animate by MUTATING TRANSFORMS imperatively each tick. The wave becomes each
 *     petal's CSS transform: how far out it sits (translate), how big it is
 *     (scale), how much it leans (rotate). We call setAttribute('transform', …)
 *     on refs — NO setState, NO re-render. React does nothing per frame.
 *   • Drive it from the SHARED creatureClock via useReactor — the same one-loop,
 *     fan-out-to-many-shapes reactive tick the creatures use. Freezing (off-screen)
 *     just skips the writes.
 *
 * The whole thing is a PURE function of synced inputs — `seed`, `speed`, box size,
 * and the shared clock — so every client renders the identical bloom with NOTHING
 * extra in the store and NO referee (CLAUDE.md gotchas #5 & #7). ~120 transform
 * writes/tick is cheap; tldraw keeps full vector selection, SVG export, palette
 * and dark-mode for free (none of which a <canvas> shape would give you).
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
import { bloomShapeValidators } from 'shared/shape-schemas'
import { creatureClock, subscribeCreatureClock } from '../creature/clock'

// ── 1. THE SHAPE TYPE ────────────────────────────────────────────────────────
// All PUBLIC and synced. No secrets, no referee — the motion is cosmetic and
// recomputed on each client from the shared clock.
export type BloomShapeProps = {
	w: number
	h: number
	// Deterministic shape seed: picks the arm count, twist, and phase offsets, so
	// every client draws the identical bloom. The ONLY bespoke synced state.
	seed: number
	// Wave speed. Higher = faster breathing. The local clock multiplies it.
	speed: number
	// NATIVE tldraw style props (CLAUDE.md gotcha #8): share the global palette and
	// appear in the style panel automatically. createTLSchema auto-collects these.
	//   color → petal hue        size → stroke weight (s/m/l/xl)
	//   dash  → arm line style
	color: TLDefaultColorStyle
	size: TLDefaultSizeStyle
	dash: TLDefaultDashStyle
}

export type BloomShape = TLBaseShape<'bloom', BloomShapeProps>

// REGISTER THE TYPE (required — TLShape is a closed union in v5; gotcha #1).
declare module 'tldraw' {
	interface TLGlobalShapePropsMap {
		bloom: BloomShapeProps
	}
}

// ── 2. TUNING ────────────────────────────────────────────────────────────────
// perfect-freehand's STROKE_SIZES aren't exported in this version (gotcha #8), so
// mirror them locally — same numbers CreatureShape uses.
const STROKE_SIZES: Record<TLDefaultSizeStyle, number> = { s: 2, m: 3.5, l: 5, xl: 10 }

/** strokeDasharray for the arm lines (in stroke-width units); same as CreatureShape. */
function dashArray(dash: TLDefaultDashStyle, sw: number): string | undefined {
	switch (dash) {
		case 'dashed':
			return `${sw * 2} ${sw * 2}`
		case 'dotted':
			return `0 ${sw * 2}`
		default:
			return undefined // 'draw' | 'solid' | 'none' render as a continuous line
	}
}

const PETALS = 120 // how many arms in the bloom. ~the node budget per shape.
const RINGS = 3 // wave repeats across the radius (each petal also pulses per-ring).

// ── 3. THE UTIL ──────────────────────────────────────────────────────────────
export class BloomShapeUtil extends ShapeUtil<BloomShape> {
	static override type = 'bloom' as const
	static override props = bloomShapeValidators as RecordProps<BloomShape>

	getDefaultProps(): BloomShape['props'] {
		return {
			w: 220,
			h: 220,
			// A stable-but-varied seed. Math.random is fine here: it's a one-time
			// CREATION value that then gets synced, not per-frame motion.
			seed: Math.round(Math.random() * 1e6),
			speed: 1,
			color: 'violet',
			size: 'm',
			dash: 'solid',
		}
	}

	getGeometry(shape: BloomShape): Geometry2d {
		return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
	}

	override canResize() {
		return true
	}
	override onResize(shape: BloomShape, info: TLResizeInfo<BloomShape>) {
		return resizeBox(shape, info)
	}

	component(shape: BloomShape) {
		return <BloomBody shape={shape} />
	}

	// v5: selection outline is a Path2D, not JSX (gotcha #3).
	getIndicatorPath(shape: BloomShape) {
		const path = new Path2D()
		path.roundRect(0, 0, shape.props.w, shape.props.h, 8)
		return path
	}
}

// ── 4. THE RENDER + IMPERATIVE ANIMATION ─────────────────────────────────────
function BloomBody({ shape }: { shape: BloomShape }) {
	const { w, h, seed, speed, color, size, dash } = shape.props
	const editor = useEditor()

	// Share the clock lifetime with this shape (same one the creatures tick on).
	useEffect(() => subscribeCreatureClock(editor), [editor])

	// Refs to every petal <g> (we mutate its `transform` each tick) AND to the arm
	// <path> inside it (we rewrite its `d` to BEND the line). Both imperative — the
	// elements exist once; only their attributes change per frame, never React.
	const petalRefs = useRef<Array<SVGGElement | null>>([])
	const armRefs = useRef<Array<SVGPathElement | null>>([])

	// Theme-dependent colour/weight, resolved reactively (re-renders only on
	// palette / dark-mode change — rare). Mirrors CreatureShape's display values.
	const { stroke, strokeWidth } = useValue(
		'bloomDisplay',
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

	// PER-PETAL CONSTANTS, computed ONCE from the seed. Each petal owns a base
	// angle, a deterministic phase offset (so arms don't pulse in lockstep), and a
	// faint length jitter. This is the bloom's "DNA" — pure function of seed.
	const petals = useMemo(() => {
		// Cheap deterministic hash, つぶやき-style: fract(sin(seed·k)) (gotcha-free,
		// no RNG table). Gives a stable pseudo-random stream from one integer.
		const rand = (i: number) => {
			const v = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453
			return v - Math.floor(v)
		}
		// Arm count and twist vary by seed so different blooms look distinct.
		const twist = (rand(0) - 0.5) * 2 // -1..1, how much the arms spiral
		// INTERFERENCE SIGNATURE — per-BLOOM, not per-arm. Two extra wave frequencies
		// (irrational-ish ratios so they never re-phase) summed into every arm's pulse
		// and bend. This is the つぶやき move: layered sines → organic, non-repeating
		// motion from pure math, no extra elements. Each seed interferes differently.
		const freqB = 2.3 + rand(4) * 1.4 // ~2.3..3.7 × the base wave
		const freqC = 4.1 + rand(5) * 2.0 // ~4.1..6.1 × the base wave
		return Array.from({ length: PETALS }, (_, i) => {
			const a = (i / PETALS) * Math.PI * 2 // base angle around the ring
			return {
				angle: a,
				phase: rand(i + 1) * Math.PI * 2, // desync the per-petal pulse
				bendPhase: rand(i + 200) * Math.PI * 2, // desync the per-petal flex
				bendPhase2: rand(i + 250) * Math.PI * 2, // 2nd control point (S-curve)
				bendSign: rand(i + 300) < 0.5 ? -1 : 1, // which way the arm curls
				jitter: 0.85 + rand(i + 100) * 0.3, // 0.85..1.15 length scale
				twist,
				freqB,
				freqC,
			}
		})
	}, [seed])

	// Layout: a square field centred in the box. The petals point OUT from centre;
	// the travelling wave pushes them in/out and scales them per tick (below).
	const cx = w / 2
	const cy = h / 2
	const maxR = Math.min(w, h) * 0.46 // outer radius; leaves a small margin
	const petalLen = maxR / RINGS // a petal's intrinsic length (pre-scale)
	// The arm runs along +x from its inner end to its outer end (the group transform
	// aims/positions it). We bend it with a CUBIC Bézier whose two control points (at
	// 1/3 and 2/3 along the arm) sweep off-axis in OPPOSITE directions — an S-curve,
	// serpentine rather than a single bow. `MAX_BEND` caps the curl per control point.
	const armInner = -petalLen * 0.5
	const armOuter = petalLen * 0.5
	const armC1 = armInner + (armOuter - armInner) / 3 // first control point x
	const armC2 = armInner + (2 * (armOuter - armInner)) / 3 // second control point x
	const MAX_BEND = petalLen * 0.45

	// IMPERATIVE ANIMATION. One useReactor subscribes to the shared clock and runs
	// at refresh rate (batched). Each tick we set every petal group's transform —
	// React is NOT involved, so no per-frame reconciliation. The radial wave
	// `cos(d - t)` from the original sketch becomes each petal's scale + reach.
	useReactor(
		'bloomPulse',
		() => {
			// Freeze (hold last frame) when culled off-screen — costs nothing.
			if (editor.getCulledShapes().has(shape.id)) return

			const t = creatureClock.get() * (0.5 + Math.max(0, speed))
			const refs = petalRefs.current
			const arms = armRefs.current

			for (let i = 0; i < petals.length; i++) {
				const g = refs[i]
				if (!g) continue
				const p = petals[i]

				// The travelling radial wave: position each petal along its arm by a
				// "ring" index that drifts with time, and read the wave value there.
				// `d` is the normalised radius; the wave `cos(d·RINGS·2π − t)` ripples
				// outward exactly like the original `cos(d - t)`.
				const ringPhase = t * 0.6 + p.phase
				// INTERFERENCE: sum three cosines at the bloom's seeded frequency ratios.
				// The base carries the breath; the two harmonics add organic, never-quite-
				// repeating texture. Normalised by total amplitude to stay in -1..1.
				const wave =
					(Math.cos(ringPhase) +
						0.45 * Math.cos(ringPhase * p.freqB + p.phase) +
						0.25 * Math.cos(ringPhase * p.freqC)) /
					1.7 // -1..1, the (now layered) breath
				// Reach: how far out the petal sits (0..maxR), pushed by the wave.
				const reach = maxR * (0.45 + 0.4 * (wave * 0.5 + 0.5)) * p.jitter
				// Scale: petals swell at the crest of the wave, shrink in the trough.
				const scale = 0.5 + 0.9 * (wave * 0.5 + 0.5)
				// Spiral lean: arms twist a touch as they breathe (the "warp").
				const lean = p.twist * wave * 18 // degrees
				const deg = (p.angle * 180) / Math.PI + lean

				// Place at centre, rotate to the arm angle, push out along +x, scale.
				// One composited transform per group — the GPU does the rest.
				g.setAttribute(
					'transform',
					`translate(${cx.toFixed(1)} ${cy.toFixed(1)}) rotate(${deg.toFixed(
						2
					)}) translate(${reach.toFixed(1)} 0) scale(${scale.toFixed(3)})`
				)
				// Opacity tracks the wave too, for a shimmer (cheap attribute write).
				g.setAttribute('opacity', (0.25 + 0.75 * (wave * 0.5 + 0.5)).toFixed(2))

				// BEND THE ARM into an S-curve. A cubic Bézier has TWO control points; we
				// sweep each off-axis in y on its OWN bend wave, with opposite base signs,
				// so the arm flexes serpentine (curls one way near the root, the other near
				// the tip) and writhes as the two waves drift in and out of phase. Both
				// rides differ from the pulse phase, so flex ≠ breath. Still one <path>,
				// one `d` rewrite per tick — no extra elements.
				const arm = arms[i]
				if (arm) {
					const s = MAX_BEND * p.bendSign
					const b1 = Math.sin(t * 0.8 + p.bendPhase) * s
					const b2 = Math.sin(t * 0.65 + p.bendPhase2) * -s // counter-sweep → S
					arm.setAttribute(
						'd',
						`M${armInner} 0 C${armC1.toFixed(1)} ${b1.toFixed(1)} ${armC2.toFixed(
							1
						)} ${b2.toFixed(1)} ${armOuter} 0`
					)
				}
			}
		},
		[editor, shape.id, petals, cx, cy, maxR, speed]
	)

	// REST-POSE geometry, built ONCE. Each petal is a tiny line + dot pointing along
	// +x (the arm direction); the transform above aims and animates it. Because
	// these elements never change, they never reconcile — all the life is transform.
	return (
		<HTMLContainer style={{ width: w, height: h, pointerEvents: 'all' }}>
			<svg width={w} height={h} style={{ overflow: 'visible', display: 'block' }}>
				{petals.map((_, i) => (
					<g
						key={i}
						ref={(el) => {
							petalRefs.current[i] = el
						}}
						// NO `willChange` here: on a per-petal element it promotes EVERY petal
						// to its own compositor layer. At ~120 petals × N blooms that's
						// thousands of layers — it exhausts GPU memory and tanks the frame
						// rate (the bloom stress test measured the cliff). Animate without it.
					>
						{/* The arm: a quadratic curve from inner→outer. Built straight at rest;
						    the reactor rewrites its `d` each tick to BEND it. `dash` styles it. */}
						<path
							ref={(el) => {
								armRefs.current[i] = el
							}}
							d={`M${armInner} 0 C${armC1} 0 ${armC2} 0 ${armOuter} 0`}
							fill="none"
							stroke={stroke}
							strokeWidth={strokeWidth}
							strokeLinecap="round"
							strokeDasharray={dashes}
						/>
					</g>
				))}
			</svg>
		</HTMLContainer>
	)
}
