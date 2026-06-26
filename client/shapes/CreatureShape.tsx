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
	creatureClock,
	subscribeCreatureClock,
	tailBeat,
} from '../creature/clock'
import { useReactor } from 'tldraw'
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
// PERF ARCHITECTURE (read this — it's why this scales):
//
// The naive version recomputed the whole fish silhouette (perfect-freehand path)
// every tick and let React reconcile new <path> `d` strings — so each creature
// re-rendered every frame. tldraw's own perf docs call this out: "Animating shape
// properties causes continuous re-renders." With one component per creature, N
// creatures = N React re-renders per tick, which is the 100-fish cliff we profiled.
//
// THE FIX (tldraw's own per-shape pattern — see Shape.js useQuickReactor): render
// the geometry ONCE and animate via TRANSFORMS mutated IMPERATIVELY, off the React
// path. So during animation React does NOTHING:
//   • The body + tail outlines are built once (useMemo on w/h/seed/strokeWidth) at
//     REST POSE — perfect-freehand still runs, but once per creature, not per tick.
//   • The swim life comes from two SVG <g> groups whose `transform` we set every
//     tick inside a useReactor (tldraw's batched reactive effect): the BODY group
//     gentle-sways (yaw about the head), the TAIL group flicks (rotate about the
//     peduncle hinge), and a turn LEAN rotates the whole creature. We write
//     setAttribute('transform', …) on refs — NO setState, NO re-render.
//   • useReactor subscribes ONCE to the shared clock and runs at animation-frame
//     rate; freezing (culled / not in a tank) just skips the writes. Because the
//     path props never change after mount, the <path> elements never reconcile.
//
// This drops per-tick React work to ~zero. The remaining per-creature cost is the
// DOM node + its composited transform — cheap, and the basis for the planned
// single-overlay renderer (see the creature-overlay-threshold note) when we want
// to go past what per-shape DOM can do.
//
// Theme/colour resolution is unchanged: editor.getCurrentTheme() + getColorValue +
// STROKE_SIZES via useValue, so the creature still follows the palette/dark-mode.

function CreatureBody({ shape }: { shape: CreatureShape }) {
	const { w, h, seed, speed, color, size, dash, fill } = shape.props
	const editor = useEditor()

	// Start/stop the shared tick listener with this creature's lifetime.
	useEffect(() => subscribeCreatureClock(editor), [editor])

	// Refs to the two animated SVG groups. We mutate their `transform` imperatively
	// each tick (below) — this is the whole point: motion never goes through React.
	const bodyGroup = useRef<SVGGElement>(null)
	const tailGroup = useRef<SVGGElement>(null)

	// Resolve theme-dependent display values reactively — re-renders on palette /
	// dark-mode change (rare). Mirrors DrawShapeUtil.getDefaultDisplayValues().
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

	// REST-POSE geometry, built ONCE per (w/h/seed/strokeWidth/dash). No `beat`/`bank`
	// here — the silhouette is static; the swim is added by transforms below.
	const isDraw = dash === 'draw'
	const fish = useMemo(() => creatureFish(w, h, seed), [w, h, seed])
	const closedPath = (pts: Pt[]) => {
		if (isDraw) {
			const sp = getStrokePoints(pts, { size: strokeWidth, streamline: 0.4, last: true })
			return getSvgPathFromStrokePoints(sp, true)
		}
		return polygonPath(pts)
	}
	const bodyD = useMemo(() => closedPath(fish.body), [fish.body, isDraw, strokeWidth])
	const tailD = useMemo(() => closedPath(fish.tail), [fish.tail, isDraw, strokeWidth])

	// IMPERATIVE ANIMATION. useReactor subscribes to the shared clock once and runs
	// at animation-frame rate (it batches, unlike useQuickReactor). It sets the two
	// groups' transforms directly — React is not involved, so no re-render per tick.
	//
	// We keep a tiny accumulator for the eased turn-lean (same idea as before: lean
	// is angular velocity of the synced rotation over clock time, smoothed).
	const acc = useRef({ prevRot: shape.rotation, prevClock: 0, bank: 0 })
	useReactor(
		'creatureSwim',
		() => {
			const body = bodyGroup.current
			const tail = tailGroup.current
			if (!body || !tail) return
			// Freeze (skip writes, hold last transform) when off-screen OR not in a
			// tank — a creature alone on the canvas sits still. tankUnder/getCulledShapes
			// are reactive, so this effect re-evaluates when those change.
			if (editor.getCulledShapes().has(shape.id) || !tankUnder(editor, shape.id)) return

			const clock = creatureClock.get()
			const a = acc.current
			const dt = clock - a.prevClock
			const rotation = shape.rotation
			const targetBank = dt > 0 ? Math.max(-1, Math.min(1, ((rotation - a.prevRot) / dt) * 0.4)) : a.bank
			a.bank += (targetBank - a.bank) * Math.min(1, 6 * Math.max(0, dt))
			a.prevRot = rotation
			a.prevClock = clock

			// Shared tail-beat phase — in lockstep with the movement loop's thrust.
			const beat = tailBeat(clock, seed, speed).phase

			// BODY: gentle yaw sway about the head + the turn lean, around the head
			// point so the nose stays put and the body fans behind it.
			const sway = Math.sin(beat) * 4 + a.bank * 10 // degrees
			const hx = fish.headPivot.x
			const hy = fish.headPivot.y
			body.setAttribute('transform', `rotate(${sway.toFixed(2)} ${hx.toFixed(1)} ${hy.toFixed(1)})`)

			// TAIL: flick about the JOIN hinge. This composes ON TOP of the body sway
			// (the tail group is nested in the body group), so it's the tail's motion
			// RELATIVE to the body — a bigger sweep that reads as the tail driving.
			const flick = Math.sin(beat) * 18 // degrees
			const px = fish.tailPivot.x
			const py = fish.tailPivot.y
			tail.setAttribute('transform', `rotate(${flick.toFixed(2)} ${px.toFixed(1)} ${py.toFixed(1)})`)
		},
		[editor, shape.id, seed, speed, fish]
	)

	return (
		<HTMLContainer style={{ width: w, height: h, pointerEvents: 'all' }}>
			<svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: 'visible' }}>
				{/* The body group carries the whole-creature sway; the <g> refs are the
				    transform targets, mutated imperatively each tick. Their `d`/`cx`
				    never change, so React never reconciles them after mount. */}
				<g ref={bodyGroup}>
					{/* tail NESTED inside the body group: it inherits the body sway so the
					    join never drifts, then composes its own flick. Drawn first so it
					    sits behind the body path; its tucked-in base hides under the body. */}
					<g ref={tailGroup}>
						<path
							d={tailD}
							fill={fillColor}
							stroke={stroke}
							strokeWidth={strokeWidth}
							strokeDasharray={dashArray(dash, strokeWidth)}
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</g>
					<path
						d={bodyD}
						fill={fillColor}
						stroke={stroke}
						strokeWidth={strokeWidth}
						strokeDasharray={dashArray(dash, strokeWidth)}
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
					{/* eye rides with the body group so it stays anchored to the head */}
					<circle cx={fish.eye.x} cy={fish.eye.y} r={Math.max(1.2, strokeWidth * 0.9)} fill={stroke} />
				</g>
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
// A minimal fish at REST POSE: its spine ± a tapered body radius, a rounded head
// pinching to a narrow caudal peduncle, a FORKED tail fin, and one eye. The swim
// is NOT baked into this geometry anymore — the body is static and the consumer
// animates it via transforms (see CreatureBody). So this is a pure function of
// shape only; it returns the two outlines, the eye, and the two HINGE POINTS the
// animation rotates about (the head, and the tail's peduncle base).
//
//   radius = head-heavy teardrop (round at the head, pinched at the tail-base)
//
// A small fixed sway is left in the spine so the resting silhouette isn't a dead
// straight fish; the lively motion is the transform-driven body yaw + tail flick.

// Points along each body edge. Fewer = cheaper polygon + cheaper perfect-freehand
// pass, at a slight cost to silhouette smoothness. 20 is still smooth for a fish
// this size. NOTE: paths are now built ONCE per creature (not per tick), so this
// no longer affects per-frame cost — only mount cost.
const SEGMENTS = 20

type Pt = { x: number; y: number }
type Fish = {
	body: Pt[]
	tail: Pt[]
	eye: Pt
	/** Hinge the body group yaws about (the nose). */
	headPivot: Pt
	/** Hinge the tail group flicks about (the caudal peduncle). */
	tailPivot: Pt
}

function creatureFish(w: number, h: number, seed: number): Fish {
	// The body spans head (x0) → tail-base (peduncle). We leave room on the right
	// for the caudal fin, and a tiny inset elsewhere so strokes/fins aren't clipped.
	const x0 = w * 0.06
	const xPed = w * 0.78 // where the body pinches to the tail-base (caudal peduncle)
	const len = xPed - x0
	const cy = h * 0.5
	const freq = 2.2 + seed * 1.5

	// Rest-pose spine at u∈[0,1]: a small fixed sine ripple (seeded so creatures
	// differ) gives the silhouette a touch of curve; the SWIM motion is applied as
	// a transform by the consumer, not baked here.
	const spine = (u: number) => cy + h * 0.04 * u * Math.sin(freq * u)

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

	// CAUDAL (tail) fin: a forked triangle hinged at the peduncle, drawn at REST
	// (no swing). The consumer rotates the whole tail group about tailPivot to flick
	// it — so the fork tips sweep, exactly like the old beat-driven `swing` did, but
	// as a transform instead of re-generated points.
	//
	// THE JOIN: attach the fin's base right at the body's rear tip (peduncle), with
	// only a SMALL overlap into the body so the seam is hidden but the fork doesn't
	// sit buried inside the silhouette. uJoin near 1 = at the tail end; the base is
	// narrow (the body is thin there) and the fork opens out to the right in open
	// space. We pivot the flick about this join so the tail stays anchored as it
	// swings.
	const pedY = spine(1)
	const uJoin = 0.97 // attach just inside the body's rear tip (was 0.86 — too buried)
	const xJoin = x0 + uJoin * len
	const joinR = radius(uJoin) // body half-thickness there → the fin's base height
	const joinY = spine(uJoin)
	const finX = w * 0.99 // fork tips reach a touch further to keep the fin's length
	const innerX = xPed + (finX - xPed) * 0.45 // fork notch, between join and tips
	const tail: Pt[] = [
		{ x: xJoin, y: joinY - joinR }, // top of base (at the body's rear tip)
		{ x: finX, y: pedY - h * 0.3 }, // upper fork tip
		{ x: innerX, y: pedY }, // inner notch (the fork)
		{ x: finX, y: pedY + h * 0.3 }, // lower fork tip
		{ x: xJoin, y: joinY + joinR }, // bottom of base (at the body's rear tip)
	]

	// EYE, near the head.
	const eye = { x: x0 + 0.1 * len, y: spine(0.1) - radius(0.1) * 0.25 }

	// HINGES for the transform animation: the body yaws about the nose; the tail
	// flicks about the JOIN point (where its base meets the body), so the base stays
	// put and only the fin sweeps — no gap opening up between tail and body.
	const headPivot = { x: x0, y: spine(0) }
	const tailPivot = { x: xJoin, y: joinY }

	return { body, tail, eye, headPivot, tailPivot }
}

/** Join a ring of points into a closed straight-segment SVG path (2-dp coords). */
function polygonPath(pts: { x: number; y: number }[]): string {
	const r2 = (n: number) => Math.round(n * 100) / 100
	return 'M ' + pts.map((p) => `${r2(p.x)},${r2(p.y)}`).join(' L ') + ' Z'
}
