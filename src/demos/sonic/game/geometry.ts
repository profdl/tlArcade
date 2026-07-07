import { computed, getPointsFromDrawSegment, type Computed, type Editor, type TLShape, type TLDrawShape, type Vec } from 'tldraw'
import type { LineKind, Segment, Vec2 } from './physics'
import { makeCheckpoint, type Checkpoint } from './checkpoints'
import { GOAL_TYPE } from './goal'

// The "kind" of a track line is derived from a native shape's color. This keeps
// us fully on tldraw's native stack — users draw with the native pencil/geo
// tools and pick a color; we interpret the color as gameplay behavior.
// `LineKind` is defined in physics.ts (the consumer); we map colors onto it.

// Map native tldraw colors -> gameplay line kinds. Each entry carries a
// `strength` (0..1) so a "light-" color can reuse its base kind at a weaker
// magnitude (per PLANNING.md's "same kind, tuned constant" decision). Strength
// is a no-op for kinds that don't read it (solid/oneway/scenery).
interface KindSpec {
	kind: LineKind
	strength: number
	/** For 'oneway': block from the opposite side. See Segment.flip. */
	flip?: boolean
}

const COLOR_TO_KIND: Record<string, KindSpec> = {
	black: { kind: 'solid', strength: 1 },
	// grey is ice: white reads as 'ice' in PLANNING but is invisible in tldraw's
	// light mode, so grey is the usable frictionless surface. black stays solid.
	grey: { kind: 'ice', strength: 1 },
	red: { kind: 'accelerate', strength: 1 },
	'light-red': { kind: 'accelerate', strength: 0.5 },
	orange: { kind: 'brake', strength: 1 },
	yellow: { kind: 'bounce', strength: 1 },
	blue: { kind: 'oneway', strength: 1 },
	// light-blue is a one-way facing the opposite way from blue, so the two
	// shades give you both collide-from-above and collide-from-below gates.
	'light-blue': { kind: 'oneway', strength: 1, flip: true },
	violet: { kind: 'sticky', strength: 1 },
	'light-violet': { kind: 'sticky', strength: 0.5 },
	white: { kind: 'ice', strength: 1 },
	green: { kind: 'scenery', strength: 1 },
	'light-green': { kind: 'scenery', strength: 1 },
}

const DEFAULT_SPEC: KindSpec = { kind: 'solid', strength: 1 }

// Player-facing legend for the control panel, grouped by behavior. Co-located
// with COLOR_TO_KIND (the gameplay source of truth) so the mapping and its
// human-readable explanation live in one file. Swatch hexes are approximate
// tldraw v5 palette values — they only need to read as "that color" next to the
// label; the binding that actually matters (color name -> behavior) is
// COLOR_TO_KIND above. One-way is split into two rows because its two shades gate
// opposite sides (blue/light-blue), and ice shows only grey (white is invisible
// in light mode).
export interface LegendRow {
	label: string
	desc: string
	swatches: string[]
}

export const LEGEND: LegendRow[] = [
	{ label: 'Solid', desc: 'Basic track', swatches: ['#1d1d1d'] },
	{ label: 'Accelerate', desc: 'Speeds you up', swatches: ['#e03131', '#ff8787'] },
	{ label: 'Brake', desc: 'Slows you down', swatches: ['#f76707'] },
	{ label: 'Bounce', desc: 'Springy', swatches: ['#ffc034'] },
	{ label: 'Sticky', desc: 'High grip', swatches: ['#ae3ec9', '#e599f7'] },
	{ label: 'Ice', desc: 'Frictionless', swatches: ['#9fa8b2'] },
	{ label: 'One-way', desc: 'Blocks from above', swatches: ['#4263eb'] },
	{ label: 'One-way ↑', desc: 'Blocks from below', swatches: ['#74c0fc'] },
	{ label: 'Scenery', desc: 'Non-collidable', swatches: ['#2f9e44', '#8ce99a'] },
]

// Only these native shape types become collision track. Everything else (text,
// image, video, frame, embed, bookmark, note, highlight, …) is treated as
// scenery — it would otherwise act as an invisible solid wall, since those
// shapes carry no track-meaningful color. An allowlist (not a denylist) means a
// future tldraw shape type is non-collidable by default rather than a surprise
// wall. These four are the shapes whose geometry reads as a ridable line/path.
const COLLIDABLE_TYPES = new Set(['draw', 'line', 'geo', 'arrow'])

// Rings (collectibles) are small native geo ELLIPSES in the reserved ring color.
// A geo ellipse looks exactly like a Sonic ring and is small, unlike a sticky
// note. But geo shapes are normally collision track (COLLIDABLE_TYPES) — so a ring
// must be BOTH excluded from collision (it's not a wall) AND collected as a ring.
// The disambiguator is shape-type + geo-kind + color together: a `geo` `ellipse`
// in RING_COLOR is a ring; any other geo (including a yellow ellipse that isn't...
// well, yellow ellipses ARE reserved) is solid track. Yellow reads as gold and is
// only otherwise used for `bounce` on LINES — the ellipse geo type keeps the two
// apart (a yellow line is a spring; a yellow ellipse is a ring).
export const RING_COLOR = 'yellow'

/** True when a shape is a ring: a geo ellipse in the reserved ring color. Rings are
 * excluded from collision (not walls) and collected as scoring rings instead. */
export function isRingShape(shape: TLShape): boolean {
	if (shape.type !== 'geo') return false
	const props = shape.props as { geo?: string; color?: string }
	return props.geo === 'ellipse' && props.color === RING_COLOR
}

/** A page-space collision segment with a definite gameplay kind. */
export interface TrackSegment extends Segment {
	kind: LineKind
}

function specOf(shape: TLShape): KindSpec {
	// Most drawable shapes carry a `color` prop; default to solid otherwise.
	const color = (shape.props as { color?: string }).color
	if (color && color in COLOR_TO_KIND) return COLOR_TO_KIND[color]
	return DEFAULT_SPEC
}

/**
 * A reactive view of the track segments, bound to one editor. Reading `.get()`
 * recomputes only when the page's shapes change (tldraw memoizes the computed by
 * its reactive dependencies), so the rAF loop can read it every frame without
 * re-walking the whole page each time. Used by the live debug overlay (which
 * needs the track to reflect edits while stopped) and as the gameplay snapshot
 * source at run start (read `.get()` once to freeze the track for the run).
 * Create one per editor and reuse it.
 */
export function makeSegmentsComputed(editor: Editor): Computed<TrackSegment[]> {
	return computed('sonic-track-segments', () => collectSegmentsNow(editor))
}

/** Reactive view of the checkpoint boxes, bound to one editor. See makeSegmentsComputed. */
export function makeCheckpointsComputed(editor: Editor): Computed<Checkpoint[]> {
	return computed('sonic-checkpoints', () => collectCheckpointsNow(editor))
}

/**
 * Reactive view of the goal box (the single `frame` shape, if any), bound to one
 * editor. Returns null when there is no goal on the page. Same freshness
 * discipline as the segments/checkpoints views — read `.get()` per frame (live
 * while stopped) / once at run start (frozen for the run). See collectGoalNow.
 */
export function makeGoalComputed(editor: Editor): Computed<Checkpoint | null> {
	return computed('sonic-goal', () => collectGoalNow(editor))
}

/**
 * Convert collidable shapes on the current page into page-space collision
 * segments.
 *
 * For each shape we ask tldraw for its geometry (LOCAL coords), read the
 * outline `vertices`, and transform them to page space with the shape's page
 * transform. Consecutive vertices become segments. This works uniformly for
 * native draw strokes, geo shapes, lines, arrows, etc. — no custom shape type.
 *
 * Skipped: non-track shape types (see COLLIDABLE_TYPES) and scenery-colored
 * shapes — both decorative / non-collidable.
 *
 * NOTE on freshness: tldraw's geometry/transform caches (getShapeGeometry /
 * getShapePageTransform) are reactive computeds that invalidate automatically
 * when a shape's props change (epoch-based). The freshness bug this used to hit
 * was caused by passing the enumerated *snapshot* object to those calls instead
 * of the shape *id*; passing shape.id (below) is what makes the cache resolve
 * against the live record. (We deliberately do NOT wrap these reads in an
 * editor.run transaction — a transaction does not force a recompute, and reads
 * inside a `computed` are tracked as dependencies on their own.)
 */
function collectSegmentsNow(editor: Editor): TrackSegment[] {
	const segments: TrackSegment[] = []

	for (const shape of editor.getCurrentPageShapes()) {
		// Skip non-track shape types (text/image/frame/…) so they don't act as
		// invisible walls, independent of color.
		if (!COLLIDABLE_TYPES.has(shape.type)) continue

		// Rings (geo ellipses in the ring color) are collectibles, not track — skip
		// them here so the character passes THROUGH a ring instead of bonking it.
		if (isRingShape(shape)) continue

		const spec = specOf(shape)
		if (spec.kind === 'scenery') continue

		// Use the shape id so the transform/geometry caches resolve against the
		// live record, not the enumerated snapshot object.
		const transform = editor.getShapePageTransform(shape.id)
		if (!transform) continue

		// Draw (pencil) shapes can contain multiple strokes separated by
		// pen-lifts. Their flattened geometry would bridge the gaps with a
		// phantom line, so decode each stroke separately and never connect
		// across strokes.
		if (shape.type === 'draw') {
			const draw = shape as TLDrawShape
			const scale = draw.props.scale
			const strokes = draw.props.segments
			let firstPt: Vec | undefined
			let lastPt: Vec | undefined
			let totalPts = 0
			for (const stroke of strokes) {
				const localPts = getPointsFromDrawSegment(stroke, scale, scale)
				const pts = transform.applyToPoints(localPts)
				if (pts.length === 0) continue
				// Push each stroke on its own so we never bridge a pen-lift gap
				// with a phantom line between strokes.
				pushPolyline(segments, pts, spec, false, shape.type)
				if (!firstPt) firstPt = pts[0]
				lastPt = pts[pts.length - 1]
				totalPts += pts.length
			}
			// A closed freehand loop connects the overall last point back to the
			// overall first point. Guard on the total point count (not the final
			// stroke's) so a closed loop ending in a degenerate tap still closes.
			if (draw.props.isClosed && firstPt && lastPt && totalPts > 2) {
				segments.push(makeSeg(lastPt, firstPt, spec, shape.type))
			}
			continue
		}

		// Everything else: use tldraw's geometry outline (local) -> page space.
		// Pass the shape id (like the transform/bounds reads above) so the geometry
		// cache resolves against the live record, per the CLAUDE.md gotcha.
		const geometry = editor.getShapeGeometry(shape.id)
		const localVerts = geometry.vertices
		if (!localVerts || localVerts.length < 2) continue
		const verts = transform.applyToPoints(localVerts)
		pushPolyline(segments, verts, spec, geometry.isClosed, shape.type)
	}

	return segments
}

/** Emit segments between consecutive points; optionally close the loop. */
function pushPolyline(out: TrackSegment[], pts: Vec[], spec: KindSpec, closed: boolean, shapeType: string) {
	for (let i = 0; i < pts.length - 1; i++) {
		out.push(makeSeg(pts[i], pts[i + 1], spec, shapeType))
	}
	if (closed && pts.length > 2) {
		out.push(makeSeg(pts[pts.length - 1], pts[0], spec, shapeType))
	}
}

function makeSeg(a: Vec2, b: Vec2, spec: KindSpec, shapeType: string): TrackSegment {
	const seg: TrackSegment = {
		a: { x: a.x, y: a.y },
		b: { x: b.x, y: b.y },
		kind: spec.kind,
		strength: spec.strength,
		// Carry the source shape type so the audio layer can vary a sound by shape
		// (draw/line/geo/arrow) as well as by kind. Physics ignores it.
		shape: shapeType,
	}
	if (spec.flip) seg.flip = true
	return seg
}

// Rings (the scoring collectible) are geo ELLIPSES in RING_COLOR — see
// isRingShape. A small gold circle reads as a Sonic ring (a sticky note is far too
// big) and is a native shape, no custom record. Rings are the ONE geo shape
// excluded from collision (collectSegmentsNow skips them), so the character passes
// through and collects them rather than bonking. The oriented-box construction
// below decomposes the page transform into a rotation + axis scales — exact for an
// ellipse geo's translate+rotate+scale transform (never skewed), so decompose()
// recovers its true footprint. The pure box math is covered by checkpoints.test.ts.

/**
 * Collect the page-space boxes of every ring (geo ellipse in the ring color) on
 * the current page. Backs makeCheckpointsComputed; see the freshness note on
 * collectSegmentsNow about passing shape.id to the reactive caches.
 */
function collectCheckpointsNow(editor: Editor): Checkpoint[] {
	const checkpoints: Checkpoint[] = []
	for (const shape of editor.getCurrentPageShapes()) {
		if (!isRingShape(shape)) continue
		const box = orientedBox(editor, shape)
		if (box) checkpoints.push(box)
	}
	return checkpoints
}

/**
 * Collect the goal box: the single `frame` shape on the page (the first one, if
 * the user drops more than one), as an oriented box the win test enters. Null when
 * there is no goal. Backs makeGoalComputed; same freshness discipline (shape.id
 * into the reactive caches) as the checkpoint/segment collectors.
 */
function collectGoalNow(editor: Editor): Checkpoint | null {
	for (const shape of editor.getCurrentPageShapes()) {
		if (shape.type !== GOAL_TYPE) continue
		const box = orientedBox(editor, shape)
		if (box) return box
	}
	return null
}

/**
 * Build a shape's page-space oriented box (center + half-extents + rotation),
 * shared by the checkpoint (note) and goal (frame) collectors. From the shape's
 * LOCAL geometry bounds + page transform, so a rotated shape's catch region
 * matches its actual footprint rather than its inflated axis-aligned page bounds
 * (a 45°-rotated box's AABB is ~2x its area). Returns null if the transform is
 * unavailable. The box math itself lives in the pure makeCheckpoint.
 */
function orientedBox(editor: Editor, shape: TLShape): Checkpoint | null {
	const geometry = editor.getShapeGeometry(shape.id)
	const transform = editor.getShapePageTransform(shape.id)
	if (!transform) return null
	const lb = geometry.bounds
	// Local center -> page space gives the box center under any rotation.
	const center = transform.applyToPoint({ x: lb.x + lb.w / 2, y: lb.y + lb.h / 2 })
	// Decompose so the half-extents pick up any page-space scale (a shape's
	// `scale` prop) alongside the rotation — local bounds alone would be wrong for
	// a scaled shape.
	const { scaleX, scaleY, rotation } = transform.decompose()
	return makeCheckpoint(shape.id, center, lb, scaleX, scaleY, rotation)
}
