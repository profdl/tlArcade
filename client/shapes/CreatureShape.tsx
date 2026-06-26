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
import { creatureClock, subscribeCreatureClock } from '../creature/clock'

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
			w: 120,
			h: 120,
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

	// Reactive phase, QUANTIZED to ~30 steps/sec: sub-frame ticks reuse the same
	// value (and a still creature — speed 0 — holds one value forever), so the
	// path memo below doesn't recompute. While this creature is scrolled
	// off-screen we return its LAST phase unchanged — a culled shape yields a
	// constant, so useValue stops re-rendering it, and it resumes mid-stride when
	// it scrolls back in (no snap to t=0).
	const lastPhase = useRef(0)
	const phase = useValue(
		'creaturePhase',
		() => {
			if (!editor.getCulledShapes().has(shape.id)) {
				lastPhase.current = Math.round(creatureClock.get() * speed * 30)
			}
			return lastPhase.current
		},
		[editor, shape.id, speed]
	)

	// Resolve theme colors reactively — re-renders on palette/dark-mode change.
	// This mirrors DrawShapeUtil.getDefaultDisplayValues().
	const { stroke, fillColor } = useValue(
		'creatureColors',
		() => {
			const colors = editor.getCurrentTheme().colors[editor.getColorMode()]
			return {
				stroke: getColorValue(colors, color, 'solid'),
				fillColor: FILL_VARIANT[fill] === null ? 'none' : getColorValue(colors, color, FILL_VARIANT[fill]!),
			}
		},
		[editor, color, fill]
	)

	const strokeWidth = STROKE_SIZES[size]

	// The outline points; recomputed only when the quantized phase changes.
	const outline = useMemo(() => creatureOutline(w, h, seed, phase / 30), [w, h, seed, phase])

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

// size style → stroke width in px. These are tldraw's own STROKE_SIZES values
// (s/m/l/xl); the constant isn't part of the public API, so we mirror it here.
const STROKE_SIZES: Record<TLDefaultSizeStyle, number> = { s: 2, m: 3.5, l: 5, xl: 10 }

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
//   seed   = per-creature frequency/phase offset

const SEGMENTS = 24

function creatureOutline(w: number, h: number, seed: number, t: number): { x: number; y: number }[] {
	const x0 = w * 0.1
	const len = w * 0.8
	const cy = h * 0.5
	const freq = 2.2 + seed * 1.5
	const phase = seed * Math.PI * 2

	// spine point + body half-height at parameter u (0 = head, 1 = tail)
	const spine = (u: number) => cy + h * 0.12 * u * Math.sin(freq * u - t * 2 + phase)
	const radius = (u: number) => h * 0.18 * Math.sin(Math.PI * u)

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
