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
import {
	animationStepsPerSec,
	creatureClock,
	creatureCount,
	subscribeCreatureClock,
	tailBeat,
} from '../creature/clock'
import { tankUnder } from '../creature/registerSwimming'

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
	//  • clock — QUANTIZED to N steps/sec so sub-frame ticks reuse the same value
	//    and the path memo doesn't recompute every frame. N is ADAPTIVE: it drops
	//    from 30 to as low as 8 as more creatures mount (animationStepsPerSec),
	//    so a big fleet rebuilds its perfect-freehand paths far fewer times/sec —
	//    the dominant render cost. We HOLD the last value unchanged (so useValue
	//    stops re-rendering, the body freezes mid-stride and resumes there) in two
	//    cases: while culled (off-screen), and while the creature is NOT inside a
	//    geo "tank" — a creature alone on the canvas sits still until dropped into
	//    a shape. We quantize the RAW clock (not clock*speed) because tailBeat()
	//    applies its own speed-scaling.
	//  • bank — lean into turns. Measured as angular velocity over CLOCK time (rad÷s),
	//    not per-render: `rotation` (synced) only changes on ticks the creature
	//    turned, so a per-render delta would flicker for one frame. The lean EASES
	//    toward its target, giving a smooth lean-in/out. Synced rotation → all
	//    clients bank alike.
	const acc = useRef({ clock: 0, prevRot: shape.rotation, prevClock: 0, bank: 0 })
	const { clock, bank } = useValue(
		'creatureMotion',
		() => {
			// Frozen when off-screen OR not in a tank → hold the last clock value so the
			// body stops animating (and resumes mid-stride when it moves back / is dropped
			// into a shape). tankUnder() re-runs reactively as the creature's x/y change.
			if (editor.getCulledShapes().has(shape.id) || !tankUnder(editor, shape.id)) {
				return { clock: acc.current.clock, bank: acc.current.bank }
			}
			const a = acc.current
			// Adaptive quantization: coarser steps the more creatures are live, so a
			// big fleet recomputes paths fewer times/sec. Reading creatureCount here
			// makes the cadence reactive to the fleet size.
			const steps = animationStepsPerSec(creatureCount.get())
			a.clock = Math.round(creatureClock.get() * steps) / steps
			const clock = a.clock
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

	// The two fish parts, recomputed only when the quantized beat or bank changes:
	// the body silhouette (head → tapered peduncle) and the forked caudal (tail)
	// fin that flicks with the beat. The eye is a fixed point near the head.
	const fish = useMemo(
		() => creatureFish(w, h, seed, beat, bank),
		[w, h, seed, beat, bank]
	)

	// 'draw' → run each outline through perfect-freehand for the hand-drawn wobble
	// (the same pipeline DrawShapeUtil uses). Other dash values render clean paths
	// with the matching strokeDasharray. fill applies to the closed shapes.
	const isDraw = dash === 'draw'
	const closedPath = (pts: { x: number; y: number }[]) => {
		if (isDraw) {
			const sp = getStrokePoints(pts, { size: strokeWidth, streamline: 0.4, last: true })
			return getSvgPathFromStrokePoints(sp, true)
		}
		return polygonPath(pts)
	}
	const bodyD = useMemo(() => closedPath(fish.body), [fish.body, isDraw, strokeWidth])
	const tailD = useMemo(() => closedPath(fish.tail), [fish.tail, isDraw, strokeWidth])

	return (
		<HTMLContainer style={{ width: w, height: h, pointerEvents: 'all' }}>
			<svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: 'visible' }}>
				{/* tail sits behind the body so its base tucks under it */}
				<path
					d={tailD}
					fill={fillColor}
					stroke={stroke}
					strokeWidth={strokeWidth}
					strokeDasharray={dashArray(dash, strokeWidth)}
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
				<path
					d={bodyD}
					fill={fillColor}
					stroke={stroke}
					strokeWidth={strokeWidth}
					strokeDasharray={dashArray(dash, strokeWidth)}
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
				{/* eye */}
				<circle cx={fish.eye.x} cy={fish.eye.y} r={Math.max(1.2, strokeWidth * 0.9)} fill={stroke} />
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
// A minimal fish: its spine ± a tapered body radius, a rounded head pinching to
// a narrow caudal peduncle, a FORKED tail fin that flicks with the beat, and one
// eye. We build the body and tail as their own rings of points so the consumer
// can render (and freehand-wobble) them independently.
//
//   sway   = travelling sine wave (the swim; flows head→tail, grows toward tail)
//   radius = head-heavy teardrop  (round at the head, pinched at the tail-base)
//   beat   = tail-beat PHASE from tailBeat() — shared with the movement loop so
//            the visible flick drives the forward thrust (the propulsion look)
//   bank   = -1..1 turn lean; curves the whole spine toward the turn direction

// Points along each body edge. Fewer = cheaper polygon + cheaper perfect-freehand
// pass (the per-render hotspot), at a slight cost to silhouette smoothness. 20 is
// still visually smooth for a fish this size; was 28.
const SEGMENTS = 20

type Pt = { x: number; y: number }
type Fish = {
	body: Pt[]
	tail: Pt[]
	eye: Pt
}

function creatureFish(w: number, h: number, seed: number, beat: number, bank: number): Fish {
	// The body spans head (x0) → tail-base (peduncle). We leave room on the right
	// for the caudal fin, and a tiny inset elsewhere so strokes/fins aren't clipped.
	const x0 = w * 0.06
	const xPed = w * 0.78 // where the body pinches to the tail-base (caudal peduncle)
	const len = xPed - x0
	const cy = h * 0.5
	const freq = 2.2 + seed * 1.5

	// spine point at u∈[0,1] along the body. Travelling sine = swim; bank ∝ u² so
	// the body leans into turns with the head leading. Amplitude kept small so the
	// silhouette stays inside the now head-heavy box.
	const spine = (u: number) => cy + h * 0.08 * u * Math.sin(freq * u - beat) + bank * h * 0.16 * u * u

	// HEAD-HEAVY teardrop: fat and round near the head (u≈0.18), pinching to a thin
	// peduncle at the tail-base (u=1). This is what separates a fish from a leaf.
	const radius = (u: number) => {
		const fat = Math.pow(Math.sin(Math.PI * Math.min(1, u * 0.62 + 0.06)), 0.8)
		return h * 0.34 * fat * (1 - 0.78 * u)
	}

	const top: Pt[] = []
	const bottom: Pt[] = []
	for (let i = 0; i <= SEGMENTS; i++) {
		const u = i / SEGMENTS
		const x = x0 + u * len
		top.push({ x, y: spine(u) - radius(u) })
		bottom.unshift({ x, y: spine(u) + radius(u) }) // return edge, reversed
	}
	const body = [...top, ...bottom]

	// CAUDAL (tail) fin: a forked triangle hinged at the peduncle. It swings with
	// the beat (and reaches further at the fork tips) for the swish.
	const pedY = spine(1)
	const pedR = radius(1)
	const swing = h * 0.16 * Math.sin(beat)
	const finX = w * 0.97
	const tail: Pt[] = [
		{ x: xPed, y: pedY - pedR }, // top of peduncle
		{ x: finX, y: pedY - h * 0.3 + swing }, // upper fork tip
		{ x: w * 0.86, y: pedY + swing * 0.5 }, // inner notch (the fork)
		{ x: finX, y: pedY + h * 0.3 + swing }, // lower fork tip
		{ x: xPed, y: pedY + pedR }, // bottom of peduncle
	]

	// EYE, near the head.
	const eye = { x: x0 + 0.1 * len, y: spine(0.1) - radius(0.1) * 0.25 }

	return { body, tail, eye }
}

/** Join a ring of points into a closed straight-segment SVG path (2-dp coords). */
function polygonPath(pts: { x: number; y: number }[]): string {
	const r2 = (n: number) => Math.round(n * 100) / 100
	return 'M ' + pts.map((p) => `${r2(p.x)},${r2(p.y)}`).join(' L ') + ' Z'
}
