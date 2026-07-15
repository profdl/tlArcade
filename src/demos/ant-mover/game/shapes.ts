// Native shapes → planck bodies: the READ LAYER (plan step 3a).
//
// Mirrors the Sonic model (sonic/game/geometry.ts): the maze and the movable
// object are REAL tldraw shapes on the canvas, not hardcoded constants. At
// play-start we read each collidable shape's TRUE geometry
// (editor.getShapeGeometry) + page transform → a page-space outline (polygon of
// verts). The DESIGNATED object outline drives a dynamic planck body; every
// other collidable shape drives a static maze body. sim.ts turns these outlines
// into fixtures (convex-decomposed for the dynamic body; Chain for static
// walls) — this file is tldraw-side only and stays out of planck.
//
// "Which shape is the object" is stored in the shape's `meta.amRole` so it syncs
// to every player through the normal tldraw store (plan: it must be shared
// state). Author mode designates it; play mode reads it.

import {
	getPointsFromDrawSegment,
	type Editor,
	type TLShape,
	type TLShapeId,
	type TLDrawShape,
} from 'tldraw'
import type { Vec2 } from './geometry'

/** Only these native shape types become physics bodies. Everything else (text,
 * image, frame, note, …) is ignored so it can't act as an invisible wall — an
 * allowlist, like Sonic's COLLIDABLE_TYPES, so a future shape type is
 * non-collidable by default rather than a surprise obstacle. */
const COLLIDABLE_TYPES = new Set(['draw', 'line', 'geo', 'arrow'])

/** The meta key/marker that tags the one shape the sim treats as the movable
 * object (the load). Stored in shape.meta so it syncs to all players. */
export const OBJECT_ROLE = 'object'
/** Tags the goal FLAG in the last room. It's a real tldraw shape (so it draws +
 * syncs), but it's NOT a physics body — decorative/scoring only, so readWorldSpec
 * skips it (see below). Reaching it wins the run. */
export const FLAG_ROLE = 'flag'
/** Tags a purely-DECORATIVE annotation (e.g. the "Drag" hint arrow) — a real shape
 * that draws + syncs but is neither a wall nor a scoring zone, so readWorldSpec
 * skips it and win detection ignores it. */
export const DECOR_ROLE = 'decor'
interface AmMeta {
	amRole?: string
}

/** One shape read into page-space outline(s). A shape can yield multiple
 * outlines (a draw shape with several pen-lift strokes). Each outline is a list
 * of page-px points; `closed` says whether the last point joins the first. */
export interface ShapeOutlines {
	id: TLShapeId
	outlines: { points: Vec2[]; closed: boolean }[]
}

/** Everything sim.ts needs to build a world, in page px. `object` is null when
 * no shape is designated (author hasn't picked one) — the caller shouldn't start
 * a run without one. */
export interface WorldSpec {
	/** The designated movable object's outlines (dynamic body). */
	object: ShapeOutlines | null
	/** Every other collidable shape's outlines (static maze bodies). */
	walls: ShapeOutlines[]
}

/** True if this shape is the designated movable object. */
export function isObjectShape(shape: TLShape): boolean {
	return (shape.meta as AmMeta)?.amRole === OBJECT_ROLE
}

/** True if this shape is the goal flag (decorative/scoring, never a physics body). */
export function isFlagShape(shape: TLShape): boolean {
	return (shape.meta as AmMeta)?.amRole === FLAG_ROLE
}

/** True if this collidable-typed shape should NOT become a physics body — the goal
 * flag or a decorative annotation. Keeps these real shapes out of the maze. */
function isNonCollidable(shape: TLShape): boolean {
	const role = (shape.meta as AmMeta)?.amRole
	return role === FLAG_ROLE || role === DECOR_ROLE
}

/** Read one shape's page-space outline(s). Uses shape.id (not the snapshot
 * object) so tldraw's reactive geometry/transform caches resolve against the
 * LIVE record — the Sonic freshness gotcha. Returns null if the shape has no
 * usable geometry. */
function readOutlines(editor: Editor, shape: TLShape): ShapeOutlines | null {
	const transform = editor.getShapePageTransform(shape.id)
	if (!transform) return null

	// Draw shapes hold a list of segments. Two authoring styles produce them:
	//  - freehand pen-lifts: each 'free' segment is a SEPARATE stroke; bridging two
	//    with a phantom edge would be wrong (Sonic hits the same issue), so each
	//    becomes its own outline.
	//  - connected straight edges (how the seed authors the T): consecutive
	//    'straight' segments where each segment's end IS the next segment's start
	//    describe ONE continuous polyline. Concatenating them reconstructs the
	//    authored path — exactly what the sim should read (splitting a T into 8
	//    one-edge fragments would leave buildObjectShape only a single edge).
	// So: run consecutive 'straight' segments together into one outline; keep each
	// 'free' stroke separate.
	if (shape.type === 'draw') {
		const draw = shape as TLDrawShape
		const scale = draw.props.scale
		const outlines: { points: Vec2[]; closed: boolean }[] = []
		const closed = !!draw.props.isClosed
		const eps = 1e-3
		let run: Vec2[] = [] // the current straight-segment run being merged

		const flushRun = () => {
			if (run.length >= 2) outlines.push({ points: run, closed })
			run = []
		}

		for (const stroke of draw.props.segments) {
			const localPts = getPointsFromDrawSegment(stroke, scale, scale)
			const pts = transform.applyToPoints(localPts).map((p) => ({ x: p.x, y: p.y }))
			if (pts.length < 2) continue
			if (stroke.type === 'straight') {
				// Append to the run, dropping a duplicated shared endpoint so the corner
				// isn't listed twice (segment N's end == segment N+1's start).
				const first = pts[0]
				const last = run[run.length - 1]
				const joins = last && Math.hypot(first.x - last.x, first.y - last.y) < eps
				run.push(...(joins ? pts.slice(1) : pts))
			} else {
				// A freehand stroke: close off any straight run, then emit it alone.
				flushRun()
				outlines.push({ points: pts, closed })
			}
		}
		flushRun()
		return outlines.length ? { id: shape.id, outlines } : null
	}

	// Everything else: the cached geometry outline (local) → page space.
	const geometry = editor.getShapeGeometry(shape.id)
	const localVerts = geometry.vertices
	if (!localVerts || localVerts.length < 2) return null
	const verts = transform.applyToPoints(localVerts)
	return {
		id: shape.id,
		outlines: [{ points: verts.map((p) => ({ x: p.x, y: p.y })), closed: geometry.isClosed }],
	}
}

/**
 * Read the current page's collidable shapes into a WorldSpec (page px). The one
 * shape tagged `meta.amRole === OBJECT_ROLE` becomes the dynamic object; the
 * rest become static walls. Read ONCE at play-start to freeze the run's
 * geometry (the sim then owns it; editing shapes mid-run doesn't reshape the
 * live bodies — stop→edit→restart, per the plan's play/stop lifecycle).
 */
export function readWorldSpec(editor: Editor): WorldSpec {
	let object: ShapeOutlines | null = null
	const walls: ShapeOutlines[] = []

	for (const shape of editor.getCurrentPageShapes()) {
		if (!COLLIDABLE_TYPES.has(shape.type)) continue
		// The goal flag + decorative annotations are real shapes but NOT walls — skip
		// them so they never become obstacles the object collides with.
		if (isNonCollidable(shape)) continue
		const read = readOutlines(editor, shape)
		if (!read) continue
		if (isObjectShape(shape)) {
			// If somehow two shapes are tagged, the first wins (there's one load).
			if (!object) object = read
		} else {
			walls.push(read)
		}
	}

	return { object, walls }
}

/** The currently-designated object shape id on the page, or null. */
export function getObjectShapeId(editor: Editor): TLShapeId | null {
	for (const shape of editor.getCurrentPageShapes()) {
		if (isObjectShape(shape)) return shape.id
	}
	return null
}

/** The goal flag's page-space bounds (for win detection), or null if no flag is on
 * the page. The flag is authored as a few shapes (banner + pole), all tagged
 * FLAG_ROLE, so we UNION every flag shape's bounds into one goal zone. Read live so
 * a moved/edited flag still scores at its real spot. */
export function getFlagBounds(editor: Editor): { minX: number; minY: number; maxX: number; maxY: number } | null {
	let bounds: { minX: number; minY: number; maxX: number; maxY: number } | null = null
	for (const shape of editor.getCurrentPageShapes()) {
		if (!isFlagShape(shape)) continue
		const b = editor.getShapePageBounds(shape.id)
		if (!b) continue
		bounds = bounds
			? {
					minX: Math.min(bounds.minX, b.minX),
					minY: Math.min(bounds.minY, b.minY),
					maxX: Math.max(bounds.maxX, b.maxX),
					maxY: Math.max(bounds.maxY, b.maxY),
				}
			: { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY }
	}
	return bounds
}
