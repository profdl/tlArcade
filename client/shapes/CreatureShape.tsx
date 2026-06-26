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
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { creatureShapeValidators, type CreatureKind } from '../../shared/shape-schemas'
import {
	creatureClock,
	subscribeCreatureClock,
	tailBeat,
} from '../creature/clock'
import { useReactor } from 'tldraw'
import { tankUnderCached, type TankCache } from '../creature/registerSwimming'
import { getCreatureVariant } from '../creature/variants'
import type { CreatureGeometry, MotionStyle, Pt } from '../creature/variants/types'

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
	/** WHICH creature: fish/snake/jellyfish/crab. A native enum StyleProp, so it
	 *  shows in the style panel and switches the creature in place (like geo's kind). */
	kind: CreatureKind
	/** Picks the individual within a kind. Geometry is deterministic in `seed`. */
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
			kind: 'fish',
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
	const { w, h, kind, seed, speed, color, size, dash, fill } = shape.props
	const editor = useEditor()

	// Start/stop the shared tick listener with this creature's lifetime.
	useEffect(() => subscribeCreatureClock(editor), [editor])

	// The variant: geometry generator + motion params, looked up from `kind`. The
	// renderer below is fully generic over whatever chains/dots/motion it produces.
	const variant = useMemo(() => getCreatureVariant(kind), [kind])

	// Refs to every animated SVG group, keyed `${chainIndex}:${segIndex}`. We mutate
	// their `transform` imperatively each tick — motion never goes through React.
	// Within a chain the segment <g>s are NESTED (a kinematic chain), so each rotation
	// composes on its parent's; separate chains attach at their own anchor.
	const segRefs = useRef<Map<string, SVGGElement | null>>(new Map())

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

	// REST-POSE geometry, built ONCE per (w/h/kind/seed). Pure function of shape; the
	// motion is added by transforms below, so paths never rebuild per frame.
	const geom = useMemo(() => variant.geometry(w, h, seed), [variant, w, h, seed])

	// One freehand (or polygon) path per segment of every chain, built once.
	const isDraw = dash === 'draw'
	const chainDs = useMemo(
		() =>
			geom.chains.map((chain) =>
				chain.segments.map((pts) => {
					if (isDraw) {
						const sp = getStrokePoints(pts, { size: strokeWidth, streamline: 0.4, last: true })
						return getSvgPathFromStrokePoints(sp, true)
					}
					return polygonPath(pts)
				})
			),
		[geom, isDraw, strokeWidth]
	)

	// IMPERATIVE ANIMATION. useReactor subscribes to the shared clock once and runs at
	// animation-frame rate (batched). It sets each segment group's `transform` directly
	// — React is not involved, so no re-render per tick. The motion STYLE (undulate /
	// pulse / scuttle) is the variant's; the per-chain `role`/amp/phase shape the rest.
	const acc = useRef({ prevRot: shape.rotation, prevClock: 0, bank: 0 })
	// Per-creature tank cache for the freeze check, so we don't re-run the expensive
	// getShapeAtPoint hit-test every animation frame (it re-verifies with a cheap AABB).
	const tankCache = useRef<TankCache>(null)
	useReactor(
		'creatureSwim',
		() => {
			const refs = segRefs.current
			// Freeze (skip writes, hold last transform) when off-screen OR not in a tank.
			if (editor.getCulledShapes().has(shape.id) || !tankUnderCached(editor, shape.id, tankCache)) return

			const clock = creatureClock.get()
			const a = acc.current
			const dt = clock - a.prevClock
			const rotation = shape.rotation
			const targetBank = dt > 0 ? Math.max(-1, Math.min(1, ((rotation - a.prevRot) / dt) * 0.4)) : a.bank
			a.bank += (targetBank - a.bank) * Math.min(1, 6 * Math.max(0, dt))
			a.prevRot = rotation
			a.prevClock = clock

			// One shared beat for the whole creature, scaled per variant. tailBeat is the
			// same wave the swim loop reads, so visible motion and propulsion stay in sync.
			const beat = tailBeat(clock, seed, speed).phase * variant.motion.beatScale

			animateCreature(refs, geom, variant.motion.style, beat, a.bank)
		},
		[editor, shape.id, seed, speed, geom, variant]
	)

	const pathProps = {
		fill: fillColor,
		stroke,
		strokeWidth,
		strokeDasharray: dashArray(dash, strokeWidth),
		strokeLinecap: 'round' as const,
		strokeLinejoin: 'round' as const,
	}

	// Map parent chain → its attached child chains, and the set of top-level (un-
	// attached) chains. A chain with `attachToChain` nests inside that parent's last
	// segment (so a fish tail follows the body's rear segment instead of detaching);
	// the rest render at the top level.
	const childrenByParent = new Map<number, number[]>()
	const topLevel: number[] = []
	geom.chains.forEach((chain, ci) => {
		const p = chain.attachToChain
		if (p !== undefined && p >= 0 && p < geom.chains.length && p !== ci) {
			const list = childrenByParent.get(p) ?? []
			list.push(ci)
			childrenByParent.set(p, list)
		} else {
			topLevel.push(ci)
		}
	})
	const ctx = { pathProps, stroke, strokeWidth, segRefs }

	return (
		<HTMLContainer style={{ width: w, height: h, pointerEvents: 'all' }}>
			<svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: 'visible' }}>
				{/* Each chain is a kinematic chain of nested segment <g>s (refs keyed
				    `chain:seg` in segRefs), rotated per tick by animateCreature. The spine
				    (chains[0]) carries the eyes; attached chains (e.g. the tail) nest in
				    their parent's last segment so they follow it. The <g>/path/cx never
				    change, so React never reconciles them after mount. */}
				{topLevel.map((ci) => renderChain(ci, geom, chainDs, childrenByParent, ctx))}
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

// ── 5. THE CHAIN RENDERER + ANIMATOR (generic over every variant) ─────────────
// The geometry of each creature lives in client/creature/variants/*. Here we just
// render and animate whatever chains/dots a variant produced. A chain renders as a
// stack of NESTED <g>s (a kinematic chain: each segment rotates about its joint,
// carrying the segments behind it), so transforms compose into a continuous bend.

/**
 * Render one chain (and, recursively, any chains ATTACHED to it) as nested <g>s.
 * Within a chain the segment <g>s nest head→tail (kinematic chain); each <g>'s ref
 * is stored in segRefs under `${chainIndex}:${segIndex}` for the animator. A chain
 * declaring `attachToChain` is injected into its parent's LAST segment <g>, so it
 * inherits the parent's full accumulated bend and stays joined as the parent moves
 * (this is what keeps a fish's tail welded to the body's rear segment). Dots ride
 * the head (segment 0).
 */
function renderChain(
	ci: number,
	geom: CreatureGeometry,
	chainDs: string[][],
	childrenByParent: Map<number, number[]>,
	ctx: { pathProps: Record<string, unknown>; stroke: string; strokeWidth: number; segRefs: { current: Map<string, SVGGElement | null> } }
): ReactNode {
	const segmentDs = chainDs[ci]
	const dots = geom.dots.filter((d) => d.chain === ci)
	const lastSeg = segmentDs.length - 1
	// Chains attached to THIS chain get nested in its last segment.
	const attached = childrenByParent.get(ci) ?? []

	// Build inside-out: innermost (tail-most) segment first, each wrapped by the one
	// ahead of it. The innermost segment also hosts this chain's attached children.
	let inner: ReactNode = null
	for (let i = lastSeg; i >= 0; i--) {
		const isHead = i === 0
		const isLast = i === lastSeg
		const wrapped = inner
		inner = (
			<g key={i} ref={(el) => { ctx.segRefs.current.set(`${ci}:${i}`, el) }}>
				<path d={segmentDs[i]} {...ctx.pathProps} />
				{isHead &&
					dots.map((d, di) => (
						<circle key={`dot${di}`} cx={d.at.x} cy={d.at.y} r={Math.max(1.2, d.r * ctx.strokeWidth)} fill={ctx.stroke} />
					))}
				{isLast && attached.map((childCi) => renderChain(childCi, geom, chainDs, childrenByParent, ctx))}
				{wrapped}
			</g>
		)
	}
	return <g key={`chain${ci}`}>{inner}</g>
}

/**
 * Animate every chain by mutating its segment groups' transforms. Pure transforms
 * (no path rebuild). The motion STYLE picks how the spine + appendages move:
 *   undulate — wave flows down the spine (phaseLag); trailers sweep behind it.
 *   pulse    — jellyfish JET PROPULSION: an ASYMMETRIC pump — a fast CONTRACTION
 *              (the bell squeezes radially narrower + taller, its rim pulls in,
 *              and the whole animal jets forward) then a slow RELAXATION (the bell
 *              opens wide + rounds out, drifting back). Tentacles trail the bell
 *              with a lag: they STREAM OUT behind on the jet and RECOIL/BUNCH as
 *              the bell re-opens. All driven by the same `pump` envelope.
 *   scuttle  — body bobs gently; limbs twitch out of phase (crab).
 * `bank` is the eased turn-lean; it rides the spine's head segment so the whole
 * creature leans into turns.
 */
function animateCreature(
	refs: Map<string, SVGGElement | null>,
	geom: CreatureGeometry,
	style: MotionStyle,
	beat: number,
	bank: number
): void {
	// PULSE envelope. Real jellyfish locomotion is asymmetric: a quick power
	// CONTRACTION followed by a slow RELAXATION. `pump` ∈ [0,1]: 0 = bell fully
	// relaxed (open, rounded), 1 = bell fully contracted (squeezed, jetting). We
	// shape a sine into a fast-rise/slow-fall by raising it to a >1 power on the
	// rising edge — so the squeeze snaps and the recovery eases.
	const pump = style === 'pulse' ? pumpEnvelope(beat) : 0
	// Bell centre x — tentacles to its left/right curve MIRRORED outward. chains[0]
	// is the bell (its anchor.x is the centre); fall back to 0 if somehow absent.
	const bellCx = geom.chains[0]?.anchor.x ?? 0
	// BODY LIFT — the whole animal's vertical travel, tied to the TENTACLE state (not
	// the bell's own pump) so motion matches what the tentacles are doing: barely any
	// movement while they reach outward, then a fast up-surge that quickly ramps down
	// as they snap straight. Computed once (shared by the bell + every tentacle root so
	// they translate together). `lift` is negative = up.
	const lift = style === 'pulse' ? bodyLift(beat) : 0

	for (let ci = 0; ci < geom.chains.length; ci++) {
		const chain = geom.chains[ci]
		for (let si = 0; si < chain.segments.length; si++) {
			const g = refs.get(`${ci}:${si}`)
			if (!g) continue
			const j = chain.joints[si]

			// ── PULSE (jellyfish): jet-propulsion pump, NOT a free phase wave ────────
			if (style === 'pulse') {
				if (chain.role === 'spine' && si === 0) {
					// BELL: on the CONTRACTION (pump→1) it squeezes radially NARROWER and
					// stretches TALLER (sx<1, sy>1) as the rim jets water down, and the whole
					// animal JETS UP. On RELAXATION (pump→0) it opens back wide + short and
					// SINKS slightly (the refill glide) before the next pump. So the vertical
					// travel swings BOTH ways around neutral: a gentle sink while reaching out,
					// a stronger jet up while straightening. The scale is about the bell anchor
					// so it breathes in place.
					const dy = lift // <0 surge up (tentacles straightening), ~0 while reaching out
					const sx = (1 - pump * BELL_SQUEEZE).toFixed(3) // contraction → narrower
					const sy = (1 + pump * BELL_STRETCH).toFixed(3) // contraction → taller
					g.setAttribute(
						'transform',
						`translate(0 ${dy.toFixed(2)}) ` +
							`translate(${chain.anchor.x.toFixed(1)} ${chain.anchor.y.toFixed(1)}) ` +
							`scale(${sx} ${sy}) ` +
							`translate(${(-chain.anchor.x).toFixed(1)} ${(-chain.anchor.y).toFixed(1)})`
					)
				} else {
					// TENTACLES — the swimming GAIT the bell drives:
					//   • RELAXED (pump→0): the tentacles REACH OUT, curving OUTWARD and
					//     MIRRORED across the bell centre — left ones bow left, right ones
					//     bow right (an opening parasol). The curve grows down the chain
					//     (×(si+1)) so each tentacle is an arc, not a straight splay.
					//   • CONTRACTED (pump→1): they SNAP STRAIGHT (vertical) as the animal
					//     jets up — propelling it forward.
					// So the sweep magnitude rides RELAXATION (1−lagged-pump), and its SIGN
					// is the tentacle's outward side. The lag (PUMP_LAG + per-seg phaseLag)
					// makes the reach/straighten flow a beat behind the bell, down each
					// chain — a whip toward the tips.
					const dy = lift // same vertical travel as the bell → roots stay glued to the rim
					const relax = 1 - pumpEnvelope(beat - PUMP_LAG - si * chain.phaseLag) // 1=reached out, 0=straight
					// Outward sign. A tentacle hangs DOWN; in SVG +deg rotates CLOCKWISE
					// (y is down), which swings a downward tip toward −x. So to bow a
					// RIGHT-of-centre tentacle OUTWARD (tip → +x) we need NEGATIVE deg, and
					// vice-versa — hence the leading minus. Left ones bow left, right bow
					// right: a mirrored, outward-opening parasol.
					const side = Math.sign(chain.anchor.x - bellCx) || 1
					const deg = -side * relax * chain.amp * (si + 1)
					// Only the FIRST segment needs the jet translate; the rest are nested
					// inside it (kinematic chain) and inherit it. Detect via si === 0.
					const t = si === 0 ? `translate(0 ${dy.toFixed(2)}) ` : ''
					g.setAttribute('transform', `${t}rotate(${deg.toFixed(2)} ${j.x.toFixed(1)} ${j.y.toFixed(1)})`)
				}
				continue
			}

			// ── UNDULATE / SCUTTLE: per-segment phase wave ──────────────────────────
			const phase = beat + chain.phaseOffset - si * chain.phaseLag
			let deg = Math.sin(phase) * chain.amp * (si + 1)
			if (chain.role === 'spine' && si === 0) deg += bank * 10 // head carries the lean
			g.setAttribute('transform', `rotate(${deg.toFixed(2)} ${j.x.toFixed(1)} ${j.y.toFixed(1)})`)
		}
	}
}

/**
 * The jellyfish PUMP envelope: a [0,1] signal that snaps UP (fast contraction) and
 * eases DOWN (slow relaxation) — the asymmetry that makes the bell read as JETTING
 * rather than passively wobbling. We take a raised cosine in [0,1], then bias it
 * toward 0 with a >1 exponent so it spends MORE time relaxed and contracts sharply.
 *   0 → bell fully relaxed (open, round) · 1 → bell fully contracted (squeezed)
 */
function pumpEnvelope(beat: number): number {
	const s = (1 - Math.cos(beat)) * 0.5 // raised cosine, [0,1], symmetric
	return Math.pow(s, PUMP_SKEW) // >1 skews toward relaxed: slow recover, fast squeeze
}

/**
 * BODY LIFT — the whole jellyfish's vertical travel for the current beat, in local
 * px (negative = up). Tied to the TENTACLE state, not the bell's own pump, so the
 * body moves in step with what the tentacles are visibly doing:
 *   • While the tentacles REACH OUTWARD (straightness low) the lift is ≈0 — the
 *     animal barely moves (the glide between strokes).
 *   • As the tentacles SNAP STRAIGHT (straightness → 1) it surges UP fast, then
 *     quickly ramps back down — a propulsion IMPULSE, not a smooth sine.
 * `str` is the lagged-pump straightness of the tentacles AS A WHOLE. The reach/
 * straighten flows DOWN each chain (per-segment phaseLag), so the tips straighten a
 * beat after the roots — and it's the long lower segments the eye reads as "straight".
 * So we phase the body surge to the LOWER segments (PUMP_LAG + BODY_TIP_LAG), not the
 * roots, so the animal moves up exactly when the tentacles LOOK straight. Raising str
 * to a high power keeps the lift flat across the reach-out and concentrates it into a
 * sharp pulse at the straightening — fast up, quick ramp-down. A tiny constant sink
 * keeps the rest pose from drifting upward.
 */
function bodyLift(beat: number): number {
	const str = 1 - pumpEnvelope(beat - PUMP_LAG - BODY_TIP_LAG) // 1 = tentacles straight, 0 = reached out
	return BODY_SINK - Math.pow(str, BODY_IMPULSE) * (BODY_RISE + BODY_SINK)
}

/** Extra phase (radians) so the body surge aligns with the tentacle TIPS straightening
 *  (which the eye reads as "straight"), not the roots. Matches the tip's total
 *  per-segment lag: (SEGS_PER_TENTACLE − 1) × phaseLag = 2 × 0.5. */
const BODY_TIP_LAG = 1.0

/** Peak upward surge at full straightening, in local px. Kept LARGER than the
 *  tentacles' horizontal tip excursion so the up/down propulsion is the dominant
 *  motion (otherwise the side-to-side sweep visually swamps it). */
const BODY_RISE = 22
/** Gentle resting sink (px down) while the tentacles are reached out — the glide. */
const BODY_SINK = 3
/** Exponent shaping the up-surge into a sharp impulse (higher = flatter glide, snappier surge). */
const BODY_IMPULSE = 4
/** Radial squeeze of the bell at full contraction (fraction narrower). */
const BELL_SQUEEZE = 0.18
/** Vertical stretch of the bell at full contraction (fraction taller). */
const BELL_STRETCH = 0.16
/** Exponent skewing the pump toward the relaxed state (>1 = fast squeeze, slow recover). */
const PUMP_SKEW = 1.8
/** Phase the tentacles trail the bell by (radians) — they recoil a beat late. */
const PUMP_LAG = 0.9

/** Join a ring of points into a closed straight-segment SVG path (2-dp coords). */
export function polygonPath(pts: Pt[]): string {
	const r2 = (n: number) => Math.round(n * 100) / 100
	return 'M ' + pts.map((p) => `${r2(p.x)},${r2(p.y)}`).join(' L ') + ' Z'
}
