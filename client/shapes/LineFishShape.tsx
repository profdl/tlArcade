/**
 * LINE FISH SHAPE  (the creature fish, reduced to its centreline)
 * ===============================================================
 * An abstract swimmer drawn as a single LINE down its spine: each body SEGMENT is one short
 * CENTRELINE polyline (not a body outline), so the whole fish reads as a hand-drawn / dashed
 * / dotted line that swims, rather than a filled silhouette.
 *
 * It follows CreatureShape's render model exactly, and for the same reason (read that file's
 * header): a SWUM animated shape must bake its geometry ONCE and undulate it with `transform`
 * on nested <g>s (a kinematic chain), NOT rewrite its `d` per frame. The swim loop writes
 * x/y/rotation each tick and the render reactor reads getShapePageBounds, so a `d`-rewrite
 * would re-rasterise twice per frame; transforms only re-COMPOSITE a cached path, which keeps
 * it cheap under the swim loop.
 *
 * The fish is sliced into a few rigid segments nested head→tail and undulated by rotating
 * those segment <g>s — the IDENTICAL mechanism as CreatureShape.animateCreature. Motion is a
 * PURE function of synced seed/speed + the shared clock (nothing per-frame in the store;
 * gotchas #5/#7). Roaming comes from registerSwimming when over a tank; on its own it
 * undulates in place (frozen when culled / tankless).
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
	getStroke,
	getSvgPathFromPoints,
	resizeBox,
	useEditor,
	useReactor,
	useValue,
} from 'tldraw'
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { lineFishValidators } from '../../shared/shape-schemas'
import { creatureClock, subscribeCreatureClock, tailBeat } from '../creature/clock'
import { tankUnderCached, type TankCache } from '../creature/registerSwimming'

// ── 1. THE SHAPE TYPE ────────────────────────────────────────────────────────
export type LineFishShapeProps = {
	w: number
	h: number
	seed: number
	speed: number
	color: TLDefaultColorStyle
	size: TLDefaultSizeStyle
	dash: TLDefaultDashStyle
}

export type LineFishShape = TLBaseShape<'lineFish', LineFishShapeProps>

// REGISTER THE TYPE (required — TLShape is a closed union in v5; gotcha #1).
declare module 'tldraw' {
	interface TLGlobalShapePropsMap {
		lineFish: LineFishShapeProps
	}
}

interface Pt {
	x: number
	y: number
}

// ── 2. TUNING ────────────────────────────────────────────────────────────────
// Stroke width per native size (the fish is one open line, so this is its whole weight).
const STROKE_SIZES: Record<TLDefaultSizeStyle, number> = { s: 1.5, m: 2.5, l: 3.5, xl: 6 }

// How many rigid body segments the spine is sliced into. More = smoother bend, more
// per-frame transform writes (still cheap — they re-COMPOSITE, not re-rasterise).
const SEGMENTS = 4
// Per-segment swing amplitude (degrees, before the ×(i+1) ramp toward the tail).
const SEG_AMP = 5
// Each segment trails the one ahead by this phase, so a wave flows head→tail.
const SEG_LAG = 0.7
// Points sampling each segment's centreline. The spine carries a faint resting sway
// (so it isn't a dead-straight ruler), so a few points per segment let the bend read.
const SEG_STEPS = 4

/** Cheap fixed-precision rounder for transform / path strings. */
const r1 = (x: number) => Math.round(x * 10) / 10

/**
 * strokeDasharray for the non-continuous dash styles (in stroke-width units), so the
 * native style panel restyles the centreline. Mirrors CreatureShape.dashArray:
 *   'dashed' → short dashes; 'dotted' → zero-length dashes (round caps make them dots);
 *   'draw' | 'solid' | 'none' → undefined (a continuous line).
 */
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

/**
 * The CENTRELINE POINTS of one body SEGMENT over the spine slice [uStart, uEnd]. Unlike a
 * body-outline shape (which walks a back edge + belly edge into a closed ring), this walks
 * ONLY the centre, so the body renders as a single line. A faint sinusoidal sway gives the
 * line some life at rest (the same `freq` wiggle the creature fish uses). Returns POINTS,
 * not a `d`, so the caller can render them either as a plain polyline (solid/dashed/dotted)
 * or through perfect-freehand (the 'draw' hand-inked look).
 */
function segmentPoints(noseX: number, lineLen: number, midY: number, h: number, freq: number, uStart: number, uEnd: number): Pt[] {
	const pts: Pt[] = []
	for (let i = 0; i <= SEG_STEPS; i++) {
		const u = uStart + (uEnd - uStart) * (i / SEG_STEPS)
		const cx = noseX + u * lineLen
		// Resting sway: a gentle sine that grows toward the tail (× u) so the head is calm.
		const cy = midY + h * 0.04 * u * Math.sin(freq * u)
		pts.push({ x: cx, y: cy })
	}
	return pts
}

/**
 * Turn a centreline's points into an SVG `d`, ONCE (never per frame — gotcha #9). The two
 * dash families produce DIFFERENT geometry, and must be PAINTED differently (see strokeProps
 * / drawProps below):
 *   • 'draw' → tldraw's full Draw-shape pipeline: getStroke builds a VARIABLE-WIDTH, tapered
 *     OUTLINE polygon (the hand-INKED look), and getSvgPathFromPoints(…, true) closes it. This
 *     `d` is a FILLED blob, not a stroked line — it's filled with the ink colour. (Note: the
 *     constant-width getStrokePoints→getSvgPathFromStrokePoints route gives a centreline that
 *     looks identical to 'solid' — that's the trap; getStroke is what actually inks the line.)
 *   • everything else → a plain open polyline (`M … L …`), STROKED; 'dashed'/'dotted' restyle
 *     it with strokeDasharray at paint time, so they share this same clean polyline `d`.
 */
function pointsToD(pts: Pt[], isDraw: boolean, strokeWidth: number): string {
	if (isDraw) {
		// thinning/streamline tuned for a thin, lively line (not a fat marker); `last: true`
		// tapers the tail end so the line reads as a hand-drawn stroke, not a pipe.
		const outline = getStroke(pts, { size: strokeWidth, thinning: 0.6, streamline: 0.5, last: true })
		return getSvgPathFromPoints(outline, true) // closed outline polygon → fill it
	}
	return 'M ' + pts.map((p) => `${r1(p.x)} ${r1(p.y)}`).join(' L ')
}

// ── 3. THE UTIL ──────────────────────────────────────────────────────────────
export class LineFishShapeUtil extends ShapeUtil<LineFishShape> {
	static override type = 'lineFish' as const
	static override props = lineFishValidators as RecordProps<LineFishShape>

	getDefaultProps(): LineFishShape['props'] {
		return {
			// Match the creature fish footprint (120×64) and style for a fair comparison.
			w: 120,
			h: 64,
			seed: Math.round(Math.random() * 1e6),
			speed: 1,
			color: 'blue',
			size: 'm',
			dash: 'draw',
		}
	}

	getGeometry(shape: LineFishShape): Geometry2d {
		return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
	}

	override canResize() {
		return true
	}
	override onResize(shape: LineFishShape, info: TLResizeInfo<LineFishShape>) {
		return resizeBox(shape, info)
	}

	component(shape: LineFishShape) {
		return <LineFishBody shape={shape} />
	}

	getIndicatorPath(shape: LineFishShape) {
		const path = new Path2D()
		path.roundRect(0, 0, shape.props.w, shape.props.h, 8)
		return path
	}
}

// ── 4. THE RENDER: BAKE OPEN-STROKE CENTRELINE SEGMENTS ONCE, ROTATE PER FRAME ─
function LineFishBody({ shape }: { shape: LineFishShape }) {
	const { w, h, seed, speed, color, size, dash } = shape.props
	const editor = useEditor()

	useEffect(() => subscribeCreatureClock(editor), [editor])

	// Refs to each animated segment <g>, keyed by index. We mutate their `transform`
	// imperatively each tick — motion never goes through React, and a transform change
	// re-COMPOSITES the cached path (cheap) rather than re-rasterising it.
	const segRefs = useRef<Map<number, SVGGElement | null>>(new Map())
	const tankCache = useRef<TankCache>(null)

	const { stroke, strokeWidth } = useValue(
		'lineFishDisplay',
		() => {
			const theme = editor.getCurrentTheme()
			const colors = theme.colors[editor.getColorMode()]
			return { stroke: getColorValue(colors, color, 'solid'), strokeWidth: STROKE_SIZES[size] }
		},
		[editor, color, size]
	)

	// 'draw' takes the hand-inked perfect-freehand route; every other dash is a clean
	// polyline ('dashed'/'dotted' add a strokeDasharray at paint time). Folded into the
	// memo deps so toggling the style rebakes the paths — but only on a STYLE change, never
	// per frame (gotcha #9).
	const isDraw = dash === 'draw'

	// GEOMETRY EXTENT. Drawn HEAD-LEFT (nose at low-x, forward = −x) to match the swim
	// loop's convention (rotation = heading + π). Spine runs u = 0 NOSE → u = 1 tail-JOIN;
	// the tail centreline continues to the right of the join. Pure function of w/h/seed (+ the
	// draw/strokeWidth styling) — so it is STABLE across position-only writes (never rebuilt
	// on a move, only on a resize or style change).
	const baked = useMemo(() => {
		const noseX = w * 0.06
		const joinX = w * 0.72
		const midY = h * 0.5
		const tailX = w * 0.96
		const lineLen = joinX - noseX
		// Resting wiggle frequency, seed-varied so fish differ (every client matches; gotcha #5).
		const freq = 2.2 + (seed % 1000) / 1000 * 1.5
		// Per-fish wiggle phase, deterministic in seed.
		const v = Math.sin(seed * 12.9898) * 43758.5453
		const phase = (v - Math.floor(v)) * Math.PI * 2

		// One open centreline `d` per body segment + the joint it hinges about.
		const segDs: string[] = []
		const joints: Pt[] = []
		const overlap = 0.04 // segments overlap slightly so seams hide on the bend
		for (let i = 0; i < SEGMENTS; i++) {
			const uStart = i / SEGMENTS
			const uEnd = Math.min(1, (i + 1) / SEGMENTS + overlap)
			const pts = segmentPoints(noseX, lineLen, midY, h, freq, uStart, uEnd)
			segDs.push(pointsToD(pts, isDraw, strokeWidth))
			joints.push({ x: noseX + uStart * lineLen, y: midY }) // hinge at the segment start
		}
		// Tail centreline: a single straight line from the join out to the tail tip, baked
		// into the LAST segment so it swings with the tail-most rotation (the line just
		// continues to the tail tip — no forked-fluke outline).
		const joinY = midY + h * 0.04 * Math.sin(freq) // join sits at the spine's u=1 sway
		const finD = pointsToD([{ x: joinX, y: joinY }, { x: tailX, y: midY }], isDraw, strokeWidth)
		// Eye: a static dot near the nose, above the centreline (drawn as a <circle>, no path).
		const eye = { x: noseX + lineLen * 0.16, y: midY - h * 0.12, r: Math.max(1.5, h * 0.04) }
		return { segDs, joints, finD, eye, phase }
	}, [w, h, seed, isDraw, strokeWidth])

	// ── PER-FRAME: ROTATE THE SEGMENT <g>s (no rebuild, no re-raster) ─────────
	// Identical mechanism to CreatureShape.animateCreature: a phase-lagged sine per segment,
	// ramped toward the tail (×(i+1)), applied as a rotate() about the joint. Because this
	// only mutates `transform` on static paths, a swim-loop position write re-firing this
	// reactor costs a cheap re-composite — the whole point of the rewrite.
	useReactor(
		'lineFishSwim',
		() => {
			// Freeze (skip writes, hold last transform) when off-screen OR not in a tank —
			// the same gate CreatureShape uses, so a tankless line fish costs ~nothing.
			if (editor.getCulledShapes().has(shape.id) || !tankUnderCached(editor, shape.id, tankCache)) return

			const beat = tailBeat(creatureClock.get(), seed, speed).phase + baked.phase
			const refs = segRefs.current
			const joints = baked.joints
			for (let i = 0; i < SEGMENTS; i++) {
				const g = refs.get(i)
				if (!g) continue
				// Segment 0 (head) barely moves; amplitude grows toward the tail (i+1).
				const deg = Math.sin(beat - i * SEG_LAG) * SEG_AMP * (i + 1)
				const j = joints[i]
				g.setAttribute('transform', `rotate(${deg.toFixed(2)} ${r1(j.x)} ${r1(j.y)})`)
			}
		},
		[editor, shape.id, seed, speed, baked]
	)

	// ── THE TREE: nested segment <g>s (head→tail), fin + eye in the last/head ──
	// Built inside-out so each segment <g> wraps the one behind it (a kinematic chain): the
	// head's rotation composes onto every following segment, so the body bends as one. The
	// <g>/path/cx never change after mount, so React never reconciles them (memo-stable).
	// The line fish IS a line, and 'draw' vs the rest produce DIFFERENT `d` geometry that
	// must be PAINTED differently:
	//   • 'draw'  → `d` is a FILLED variable-width ink outline (from getStroke); we FILL it
	//               with the ink colour and don't stroke it (no dash on an inked blob).
	//   • else    → `d` is a plain centreline we STROKE; 'dashed'/'dotted' add a
	//               strokeDasharray (round caps make 'dotted' read as round dots).
	const drawProps = { fill: stroke, stroke: 'none' as const }
	const strokeProps = {
		fill: 'none' as const,
		stroke,
		strokeWidth,
		strokeDasharray: dashArray(dash, strokeWidth),
		strokeLinecap: 'round' as const,
		strokeLinejoin: 'round' as const,
	}
	const pathProps = isDraw ? drawProps : strokeProps
	let inner: ReactNode = null
	for (let i = SEGMENTS - 1; i >= 0; i--) {
		const isHead = i === 0
		const isLast = i === SEGMENTS - 1
		const wrapped = inner
		inner = (
			<g key={i} ref={(el) => { segRefs.current.set(i, el) }}>
				<path d={baked.segDs[i]} {...pathProps} />
				{isLast && <path d={baked.finD} {...pathProps} />}
				{isHead && <circle cx={r1(baked.eye.x)} cy={r1(baked.eye.y)} r={r1(baked.eye.r)} fill={stroke} />}
				{wrapped}
			</g>
		)
	}

	return (
		<HTMLContainer style={{ width: w, height: h, pointerEvents: 'all' }}>
			<svg width={w} height={h} style={{ overflow: 'visible', display: 'block' }}>
				{inner}
			</svg>
		</HTMLContainer>
	)
}
