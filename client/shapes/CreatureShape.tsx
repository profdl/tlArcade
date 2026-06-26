/**
 * CREATURE SHAPE  (an in-place animated swimmer)
 * ==============================================
 * A minimal, hypnotic line-art creature in the spirit of #つぶやきProcessing:
 * one tiny trig formula flows a wave down a body so the thing looks like it's
 * swimming. It stays where you drop it and undulates in place.
 *
 * THE ARCHITECTURE (read this — it's the whole point):
 *   • Only `seed`, `speed`, `color`, and box size are SYNCED (in `shape.props`).
 *     The body is a DETERMINISTIC function of `seed`, so every client draws the
 *     identical creature.
 *   • The animation is computed LOCALLY each frame from a shared reactive clock
 *     (client/creature/clock.ts). Nothing about the motion is written to the
 *     store — no per-frame sync writes (CLAUDE.md gotchas #5 and #7).
 *   • The render is one SVG `<path>` recomputed per tick — same SVG-in-an-
 *     HTMLContainer approach as TokenShape / GridShape.
 *
 * Roaming (the creature physically swimming across the canvas) is a planned
 * follow-up: drive x/y deterministically from `seed` + the same clock so it
 * stays sync-free. Not in this file yet.
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
	TLDefaultFillStyle,
	TLDefaultSizeStyle,
	TLResizeInfo,
	getColorValue,
	getStrokePoints,
	getSvgPathFromStrokePoints,
	resizeBox,
	useEditor,
	useValue,
} from 'tldraw'
import { useEffect, useMemo, useRef } from 'react'
import { creatureShapeValidators } from '../../shared/shape-schemas'
import { creatureClock, subscribeCreatureClock, tailBeat } from '../creature/clock'

// ── 1. THE SHAPE TYPE ────────────────────────────────────────────────────────
// Everything here is PUBLIC and synced. There are no secrets and no referee —
// the motion is cosmetic and computed on each client (see the clock module).
//
// `color`/`size`/`dash`/`fill` are tldraw's NATIVE style types (the same ones
// the built-in shapes use). Because they're registered as StyleProps (in
// shared/shape-schemas.ts) the creature appears in the style panel and shares
// the global palette automatically — change it exactly like any other shape.

export type CreatureShapeProps = {
	w: number
	h: number
	/** Picks WHICH creature. Body math is deterministic in `seed`. */
	seed: number
	/** Undulation rate; higher = faster swim. */
	speed: number
	color: TLDefaultColorStyle
	size: TLDefaultSizeStyle
	dash: TLDefaultDashStyle
	fill: TLDefaultFillStyle
}

export type CreatureShape = TLBaseShape<'creature', CreatureShapeProps>

// ── REGISTER THE TYPE WITH TLDRAW (REQUIRED) ─────────────────────────────────
// `TLShape` is a closed union in v5; a custom shape only type-checks once you
// augment this map. (CLAUDE.md gotcha #1.)
declare module 'tldraw' {
	interface TLGlobalShapePropsMap {
		creature: CreatureShapeProps
	}
}

// ── 2. VALIDATORS ────────────────────────────────────────────────────────────
// Shared with the sync server (shared/shape-schemas.ts) so synced creatures
// validate identically on every client. The style props there ARE the native
// StyleProp objects, which is what wires up the style panel.
const creatureShapeProps = creatureShapeValidators as RecordProps<CreatureShape>

// ── 3. THE SHAPE UTIL ────────────────────────────────────────────────────────

export class CreatureShapeUtil extends ShapeUtil<CreatureShape> {
	static override type = 'creature' as const
	static override props = creatureShapeProps

	getDefaultProps(): CreatureShape['props'] {
		// A pseudo-random-but-stable seed from the time of creation. Synced, so all
		// clients keep this exact value once the shape exists. The style defaults
		// match the built-in shapes' look ('draw' dash = hand-drawn).
		return {
			// Fish-shaped box (wider than tall) so the selection bounds hug the
			// body — the silhouette fills it with little padding.
			w: 120,
			h: 64,
			seed: (Date.now() % 1000) / 1000,
			speed: 1,
			color: 'black',
			size: 'm',
			dash: 'draw',
			fill: 'none',
		}
	}

	getGeometry(shape: CreatureShape): Geometry2d {
		return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
	}

	override canResize() {
		return true
	}
	override onResize(shape: CreatureShape, info: TLResizeInfo<CreatureShape>) {
		return resizeBox(shape, info)
	}

	// The component is its own function so it can use hooks (useValue/useEffect).
	component(shape: CreatureShape) {
		return <CreatureBody shape={shape} />
	}

	getIndicatorPath(shape: CreatureShape) {
		const path = new Path2D()
		path.roundRect(0, 0, shape.props.w, shape.props.h, 8)
		return path
	}
}

// ── 4. THE ANIMATED BODY ─────────────────────────────────────────────────────
// A React component so it can subscribe to the shared clock and re-render each
// tick. It resolves color/stroke from tldraw's NATIVE theme exactly like the
// built-in shapes do (editor.getCurrentTheme() + getColorValue + STROKE_SIZES),
// so the creature follows the global palette, dark mode, and the style panel.

function CreatureBody({ shape }: { shape: CreatureShape }) {
	const { w, h, seed, speed, color, size, dash, fill } = shape.props
	const editor = useEditor()

	// Start/stop the shared tick listener with this creature's lifetime.
	useEffect(() => subscribeCreatureClock(editor), [editor])

	// Reactive { clock, bank }, computed inside ONE useValue so the accumulators
	// below are mutated in tldraw's reactive scheduler (once per committed value) —
	// NOT during React render, which would double-run under Strict Mode.
	//
	//  • clock — QUANTIZED to ~30 steps/sec so sub-frame ticks reuse the same value
	//    and the path memo doesn't recompute every frame. While culled (off-screen)
	//    we return the LAST value unchanged, so useValue stops re-rendering it and it
	//    resumes mid-stride when scrolled back (no snap to t=0). We quantize the RAW
	//    clock (not clock*speed) because tailBeat() applies its own speed-scaling.
	//  • bank — lean into turns. Measured as angular velocity over CLOCK time (rad÷s),
	//    not per-render: `rotation` (synced) only changes on ticks the creature
	//    turned, so a per-render delta would flicker for one frame. The lean EASES
	//    toward its target, giving a smooth lean-in/out. Synced rotation → all
	//    clients bank alike.
	const acc = useRef({ tick: 0, prevRot: shape.rotation, prevClock: 0, bank: 0 })
	const { clock, bank } = useValue(
		'creatureMotion',
		() => {
			if (editor.getCulledShapes().has(shape.id)) {
				return { clock: acc.current.tick / 30, bank: acc.current.bank }
			}
			const a = acc.current
			a.tick = Math.round(creatureClock.get() * 30)
			const clock = a.tick / 30
			const rotation = shape.rotation
			const dt = clock - a.prevClock
			const target = dt > 0 ? Math.max(-1, Math.min(1, ((rotation - a.prevRot) / dt) * 0.4)) : 0
			a.bank += (target - a.bank) * Math.min(1, 6 * Math.max(0, dt))
			a.prevRot = rotation
			a.prevClock = clock
			return { clock, bank: a.bank }
		},
		[editor, shape.id]
	)

	// Resolve theme-dependent display values reactively — re-renders on palette /
	// dark-mode change. Mirrors DrawShapeUtil.getDefaultDisplayValues(): colours via
	// getColorValue, and stroke width as `theme.strokeWidth * STROKE_SIZES[size]` so
	// the creature tracks the theme exactly like the built-in shapes.
	const { stroke, fillColor, strokeWidth } = useValue(
		'creatureDisplay',
		() => {
			const theme = editor.getCurrentTheme()
			const colors = theme.colors[editor.getColorMode()]
			return {
				stroke: getColorValue(colors, color, 'solid'),
				fillColor: FILL_VARIANT[fill] === null ? 'none' : getColorValue(colors, color, FILL_VARIANT[fill]!),
				strokeWidth: theme.strokeWidth * STROKE_SIZES[size],
			}
		},
		[editor, color, fill, size]
	)

	// The tail-beat phase — SHARED with the movement loop so the body's flick and
	// the forward thrust are in lockstep (the propulsion illusion). See clock.ts.
	const beat = tailBeat(clock, seed, speed).phase

	// The outline points; recomputed only when the quantized beat or bank changes.
	const outline = useMemo(
		() => creatureOutline(w, h, seed, beat, bank),
		[w, h, seed, beat, bank]
	)

	// 'draw' → run the outline through perfect-freehand for the hand-drawn wobble
	// (the same pipeline DrawShapeUtil uses). Other dash values render a clean
	// path with the matching strokeDasharray. fill applies in both cases.
	const isDraw = dash === 'draw'
	const d = useMemo(() => {
		if (isDraw) {
			const pts = getStrokePoints(outline, { size: strokeWidth, streamline: 0.4, last: true })
			return getSvgPathFromStrokePoints(pts, true)
		}
		return polygonPath(outline)
	}, [outline, isDraw, strokeWidth])

	return (
		<HTMLContainer style={{ width: w, height: h, pointerEvents: 'all' }}>
			<svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: 'visible' }}>
				<path
					d={d}
					fill={fillColor}
					stroke={stroke}
					strokeWidth={strokeWidth}
					strokeDasharray={dashArray(dash, strokeWidth)}
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			</svg>
		</HTMLContainer>
	)
}

// size style → stroke-width MULTIPLIER. tldraw's built-ins compute the px width as
// `theme.strokeWidth * STROKE_SIZES[size]`; STROKE_SIZES isn't a public export, so
// we mirror its exact values here and apply the theme factor at the call site.
const STROKE_SIZES: Record<TLDefaultSizeStyle, number> = { s: 1, m: 1.75, l: 2.5, xl: 5 }

// fill style → which theme color variant to fill with (null = no fill).
// 'pattern'/'lined-fill' are approximated by their semi tint (no hatch SVG).
const FILL_VARIANT: Record<TLDefaultFillStyle, 'solid' | 'semi' | null> = {
	none: null,
	semi: 'semi',
	solid: 'solid',
	fill: 'solid',
	pattern: 'semi',
	'lined-fill': 'semi',
}

/** strokeDasharray for the non-'draw' dash styles (in stroke-width units). */
function dashArray(dash: TLDefaultDashStyle, sw: number): string | undefined {
	switch (dash) {
		case 'dashed':
			return `${sw * 2} ${sw * 2}`
		case 'dotted':
			return `0 ${sw * 2}`
		default:
			return undefined // 'draw' | 'solid' | 'none'
	}
}

// ── 5. THE FORMULA (the #つぶやきProcessing bit) ──────────────────────────────
// A fish outline is just the spine ± a tapered radius. We walk the TOP edge
// head→tail, then the BOTTOM edge back tail→head, returning one CLOSED ring of
// points — which we then either join into a plain path or feed to perfect-
// freehand. No string-building here; the consumer decides the rendering.
//
//   sway   = travelling sine wave (the swim; flows head→tail, grows toward tail)
//   radius = sin(π·u) teardrop  (0 at head & tail, fattest in the middle)
//   beat   = tail-beat PHASE from tailBeat() — shared with the movement loop so
//            the visible flick drives the forward thrust (the propulsion look)
//   bank   = -1..1 turn lean; curves the whole spine toward the turn direction

const SEGMENTS = 24

function creatureOutline(w: number, h: number, seed: number, beat: number, bank: number): { x: number; y: number }[] {
	// The body fills the box edge-to-edge (tiny inset so the stroke isn't clipped),
	// so the selection bounds hug the silhouette with almost no padding. The
	// vertical amplitudes are tuned so the worst case (full sway + radius + a hard
	// banked turn) stays inside the box rather than poking out of the now-tight
	// bounds.
	const x0 = w * 0.04
	const len = w * 0.92
	const cy = h * 0.5
	const freq = 2.2 + seed * 1.5

	// spine point + body half-height at parameter u (0 = head, 1 = tail). The
	// travelling sine is driven by the SHARED beat phase; `bank` adds a steady
	// sideways curve (∝ u²) so the body leans into turns, head leading.
	//   sway 0.10 + bank 0.18 + radius 0.20  →  ≤ 0.48·h from centre (fits in box)
	const spine = (u: number) =>
		cy + h * 0.1 * u * Math.sin(freq * u - beat) + bank * h * 0.18 * u * u
	const radius = (u: number) => h * 0.2 * Math.sin(Math.PI * u)

	const top: { x: number; y: number }[] = []
	const bottom: { x: number; y: number }[] = []
	for (let i = 0; i <= SEGMENTS; i++) {
		const u = i / SEGMENTS
		const x = x0 + u * len
		top.push({ x, y: spine(u) - radius(u) })
		bottom.unshift({ x, y: spine(u) + radius(u) }) // return edge, reversed
	}
	return [...top, ...bottom]
}

/** Join a ring of points into a closed straight-segment SVG path (2-dp coords). */
function polygonPath(pts: { x: number; y: number }[]): string {
	const r2 = (n: number) => Math.round(n * 100) / 100
	return 'M ' + pts.map((p) => `${r2(p.x)},${r2(p.y)}`).join(' L ') + ' Z'
}
