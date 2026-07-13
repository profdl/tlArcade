import { atom, type Box, type Editor } from 'tldraw'

/**
 * The Mixamo-style joint-placement model for rigging a hand-drawn figure.
 *
 * The user drops a marker on each joint of their drawing; the rig is then BUILT
 * from those positions (buildFigureFromJoints), so bone lengths, angles, and the
 * shoulder/hip widths all come from where the user placed the markers. A drawing
 * with short legs yields short leg bones automatically — no proportion inference,
 * no distortion of the art.
 *
 * A joint has a stable `key`, a human label, a `parent` joint (the two ends of a
 * bone are a joint and its parent), and a default page-offset from the pelvis used
 * only to seed the initial standing layout the user then drags onto their drawing.
 */
export interface JointSpec {
	key: JointKey
	label: string
	/** The joint one bone up the chain; the bone spans parent→this. Root has none. */
	parent?: JointKey
	/** Seed offset (px) from the pelvis for the initial standing layout. */
	dx: number
	dy: number
}

export type JointKey =
	| 'pelvis'
	| 'chest' // spine top / base of neck
	| 'neck' // neck top / base of head
	| 'head' // top of head (chin-to-crown tip)
	| 'shoulder-l'
	| 'elbow-l'
	| 'wrist-l'
	| 'shoulder-r'
	| 'elbow-r'
	| 'wrist-r'
	| 'hip-l'
	| 'knee-l'
	| 'ankle-l'
	| 'hip-r'
	| 'knee-r'
	| 'ankle-r'

// The joint tree — the SEED layout for rig mode only (the user drags these markers
// onto their drawing before a rig is built). Offsets are hand-authored to mirror the
// default rig's proportions in buildFigure.ts's GEOMETRY table (spine 100, clavicle 46,
// upper-arm 66 + forearm 60, hip 30, thigh 88 + shin 82), so the initial layout reads
// as a familiar standing skeleton. They're a 2D-offset restatement of those 1D lengths,
// not derived from them: if you retune the default rig proportions, nudge these to match.
// (y grows downward.)
export const JOINTS: JointSpec[] = [
	{ key: 'pelvis', label: 'Pelvis', dx: 0, dy: 0 },
	{ key: 'chest', label: 'Chest', parent: 'pelvis', dx: 0, dy: -100 },
	{ key: 'neck', label: 'Neck', parent: 'chest', dx: 0, dy: -122 },
	{ key: 'head', label: 'Head', parent: 'neck', dx: 0, dy: -168 },

	{ key: 'shoulder-l', label: 'L shoulder', parent: 'chest', dx: -46, dy: -100 },
	{ key: 'elbow-l', label: 'L elbow', parent: 'shoulder-l', dx: -58, dy: -35 },
	{ key: 'wrist-l', label: 'L wrist', parent: 'elbow-l', dx: -63, dy: 25 },
	{ key: 'shoulder-r', label: 'R shoulder', parent: 'chest', dx: 46, dy: -100 },
	{ key: 'elbow-r', label: 'R elbow', parent: 'shoulder-r', dx: 58, dy: -35 },
	{ key: 'wrist-r', label: 'R wrist', parent: 'elbow-r', dx: 63, dy: 25 },

	{ key: 'hip-l', label: 'L hip', parent: 'pelvis', dx: -30, dy: 0 },
	{ key: 'knee-l', label: 'L knee', parent: 'hip-l', dx: -33, dy: 88 },
	{ key: 'ankle-l', label: 'L ankle', parent: 'knee-l', dx: -33, dy: 170 },
	{ key: 'hip-r', label: 'R hip', parent: 'pelvis', dx: 30, dy: 0 },
	{ key: 'knee-r', label: 'R knee', parent: 'hip-r', dx: 33, dy: 88 },
	{ key: 'ankle-r', label: 'R ankle', parent: 'knee-r', dx: 33, dy: 170 },
]

export type JointPositions = Record<JointKey, { x: number; y: number }>

/** Build the default standing layout centered on `origin` (page coords). */
export function defaultLayout(origin: { x: number; y: number }): JointPositions {
	const out = {} as JointPositions
	for (const j of JOINTS) out[j.key] = { x: origin.x + j.dx, y: origin.y + j.dy }
	return out
}

/**
 * Rig-mode state: null when off; otherwise the live joint positions the user is
 * editing. Reactive so the overlay + controls re-render as markers move. When the
 * user hits "Build rig", buildFigureFromJoints consumes these and rig mode exits.
 */
export const rigModeJoints = atom<JointPositions | null>('rigModeJoints', null)

/**
 * Enter rig mode with the joint markers AUTO-ALIGNED to the drawing: if there are
 * any free (non-bone, non-attached) shapes on the page, fit the default standing
 * skeleton into their combined bounding box so the markers start roughly on the
 * figure; otherwise fall back to a default layout at `fallbackOrigin`. The user then
 * nudges markers by hand (and can hit "Snap to drawing" to refine — see below).
 */
export function enterRigMode(editor: Editor, fallbackOrigin: { x: number; y: number }) {
	const bounds = drawingBounds(editor)
	rigModeJoints.set(bounds ? fitLayoutToBounds(bounds) : defaultLayout(fallbackOrigin))
}

export function exitRigMode() {
	rigModeJoints.set(null)
}

/** Combined page bounds of all free (non-bone) shapes, or null if there are none. */
function drawingBounds(editor: Editor): Box | null {
	let box: Box | null = null
	for (const shape of editor.getCurrentPageShapes()) {
		if (shape.type === 'poser-bone') continue
		const b = editor.getShapePageBounds(shape.id)
		if (!b) continue
		box = box ? box.union(b) : b.clone()
	}
	return box
}

// The default skeleton's own extent, from the JOINTS offsets: dy runs from the head
// (-168) to the ankles (+170), dx spans the wrists (±63). Used to map the template
// into a target box while preserving its proportions where possible.
const LAYOUT_TOP = -168
const LAYOUT_BOTTOM = 170
const LAYOUT_HALF_WIDTH = 63

/**
 * Fit the default standing skeleton into `bounds` (the drawing's box): scale it so
 * head↔ankle fills the box height and the arm span fills a sensible fraction of the
 * width, centered horizontally. A rough but reliable start — no body-part guessing.
 */
function fitLayoutToBounds(bounds: Box): JointPositions {
	const sy = bounds.height / (LAYOUT_BOTTOM - LAYOUT_TOP)
	// Don't over-stretch width to the full box (drawings are usually taller than the
	// arm span); cap horizontal scale near the vertical one so limbs stay natural.
	const sx = Math.min(sy, bounds.width / (LAYOUT_HALF_WIDTH * 2))
	const cx = bounds.x + bounds.width / 2
	// Place the head marker at the box top; everything else follows from the offsets.
	const topY = bounds.y - LAYOUT_TOP * sy

	const out = {} as JointPositions
	for (const j of JOINTS) {
		out[j.key] = { x: cx + j.dx * sx, y: topY + j.dy * sy }
	}
	return out
}

/** Move one joint (called from the marker drag). */
export function setJoint(key: JointKey, x: number, y: number) {
	const cur = rigModeJoints.get()
	if (!cur) return
	rigModeJoints.set({ ...cur, [key]: { x, y } })
}

/**
 * Refine the current joint layout toward the drawing's geometry ("Snap to drawing").
 *
 * Two nudges, both conservative so a bad guess can't scramble the layout:
 * 1. **Extremity anchoring** — pull the four extremity joints (head, wrists, ankles)
 *    toward the drawing's bounding extremes on the side they're already on (head→top,
 *    left wrist→left edge, ankles→bottom, etc.). This lines the skeleton's reach up
 *    with how far the drawing actually extends.
 * 2. **Snap-to-ink** — pull every joint toward the nearest point of the drawn shapes,
 *    but only within a limited radius, so a joint lands ON the ink of its own limb
 *    without being able to jump across the figure to a different one.
 *
 * No body-part classification (that's the fragile part); this just biases the
 * already-fitted markers toward where the ink is. The user still has final say.
 */
export function snapJointsToDrawing(editor: Editor) {
	const cur = rigModeJoints.get()
	if (!cur) return
	const bounds = drawingBounds(editor)
	if (!bounds) return

	const samples = sampleDrawingPoints(editor)
	const next = { ...cur } as JointPositions

	// 1. Extremity anchoring toward the box edges (blend, don't teleport).
	const A = 0.5 // how far toward the extreme to move
	next.head = blend(next.head, { x: next.head.x, y: bounds.y }, A)
	next['ankle-l'] = blend(next['ankle-l'], { x: next['ankle-l'].x, y: bounds.maxY }, A)
	next['ankle-r'] = blend(next['ankle-r'], { x: next['ankle-r'].x, y: bounds.maxY }, A)
	next['wrist-l'] = blend(next['wrist-l'], { x: bounds.x, y: next['wrist-l'].y }, A * 0.6)
	next['wrist-r'] = blend(next['wrist-r'], { x: bounds.maxX, y: next['wrist-r'].y }, A * 0.6)

	// 2. Snap each joint toward the nearest sampled ink point, within a radius scaled
	// to the drawing size so it can't cross to another limb.
	if (samples.length > 0) {
		const radius = Math.max(bounds.width, bounds.height) * 0.18
		for (const j of JOINTS) {
			const p = next[j.key]
			const near = nearestPoint(p, samples)
			if (near && dist(p, near) <= radius) {
				next[j.key] = blend(p, near, 0.4)
			}
		}
	}

	rigModeJoints.set(next)
}

function blend(a: { x: number; y: number }, b: { x: number; y: number }, t: number) {
	return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
	return Math.hypot(a.x - b.x, a.y - b.y)
}

function nearestPoint(p: { x: number; y: number }, pts: { x: number; y: number }[]) {
	let best: { x: number; y: number } | null = null
	let bestD = Infinity
	for (const q of pts) {
		const d = dist(p, q)
		if (d < bestD) {
			bestD = d
			best = q
		}
	}
	return best
}

/**
 * A coarse point-cloud of the drawing in page space: each free shape's bounds
 * corners + center. Cheap and shape-type-agnostic (works for strokes, geo, images),
 * enough to snap markers toward where ink actually is without decoding every stroke.
 */
function sampleDrawingPoints(editor: Editor): { x: number; y: number }[] {
	const out: { x: number; y: number }[] = []
	for (const shape of editor.getCurrentPageShapes()) {
		if (shape.type === 'poser-bone') continue
		const b = editor.getShapePageBounds(shape.id)
		if (!b) continue
		out.push(
			{ x: b.midX, y: b.midY },
			{ x: b.x, y: b.y },
			{ x: b.maxX, y: b.y },
			{ x: b.x, y: b.maxY },
			{ x: b.maxX, y: b.maxY },
			{ x: b.midX, y: b.y },
			{ x: b.midX, y: b.maxY }
		)
	}
	return out
}
