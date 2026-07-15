// The starter-layout seed: draws a maze + object onto a fresh canvas as NATIVE
// tldraw shapes, once. Split out of geometry.ts because it imports tldraw
// (createShape) — geometry.ts must stay tldraw-free so the sim import chain
// ports cleanly into the Durable Object. After seeding, the shapes are ordinary
// editable tldraw shapes (author mode); the seed is just a convenient start, not
// a source of truth the sim reads.

import { compressLegacySegments } from '@tldraw/tlschema'
import { createShapeId, toRichText, type Editor, type TLShapeId, type IndexKey } from 'tldraw'
import { FIELD, EXIT, type Vec2 } from './geometry'
import { OBJECT_ROLE, FLAG_ROLE, DECOR_ROLE } from './shapes'
import { autoStartAtom, playIntentAtom } from './state'

/** Where the object seeds (page-space top-left of its bounding box). Placed in
 * the left chamber, before the corridor, matching the reference drawing. */
const OBJECT_SPAWN: Vec2 = { x: 140, y: 230 }

/** Top-left of the "Drag" hint label — OUTSIDE the field, past the left wall (the
 * left wall's left edge is at FIELD.minX - WALL_T = -60), up and to the left of the
 * object so the arrow curves in toward it (see the reference drawing). */
const DRAG_LABEL: Vec2 = { x: -210, y: 150 }

/** The goal flag: a green rectangular banner reading "GOAL" flown from a pole (a
 * line down its left side), in the LAST room (the right chamber, past the corridor
 * gap), centred on the EXIT scoring zone. Both parts are real tldraw shapes (draw +
 * sync) tagged FLAG_ROLE so the sim treats them as decorative, not walls (see
 * shapes.ts). Reaching it wins the run. */
const FLAG_BANNER_W = 130 // banner (rectangle) width
const FLAG_BANNER_H = 80 // banner height
const FLAG_POLE_H = 200 // pole (line) height — taller than the banner

/** The load: a T with a small perpendicular FOOT at the base of its stem — the
 * exact shape and proportions from the reference drawing (crossbar + centred
 * stem + foot, all one arm thickness). Not a stand-in box or star; these are the
 * drawing's own measurements.
 *
 * CROSSBAR: the wide top bar. STEM: a thin vertical bar centred under the
 * crossbar. FOOT: a short horizontal bar across the bottom of the stem. All
 * three share ARM thickness. The concave notches this creates are what make it a
 * genuinely awkward rigid body (and exercise the sim's convex-decomposition
 * path). */
const T_ARM = 24.7 // arm thickness — crossbar, stem, foot (px, from the drawing)
const T_WIDTH = 197.8 // crossbar span = overall width (px)
const T_HEIGHT = 382.5 // crossbar top → foot bottom = overall height (px)
const T_STEM_W = 24.7 // stem width (px)
const T_FOOT_W = 85.1 // foot span (px)

/** The load's outline as a closed polygon in shape-local px (origin at the
 * bounding box's top-left), traced clockwise from the crossbar's top-left. The
 * crossbar and foot are centred on the stem, so the shape is left/right
 * symmetric. Twelve verts trace crossbar → down one side of the stem → out and
 * around the foot → back up the other side of the stem → under the crossbar. */
const T_OUTLINE: Vec2[] = (() => {
	const stemL = (T_WIDTH - T_STEM_W) / 2 // stem left edge
	const stemR = stemL + T_STEM_W // stem right edge
	const footL = (T_WIDTH - T_FOOT_W) / 2 // foot left edge
	const footR = footL + T_FOOT_W // foot right edge
	const footTop = T_HEIGHT - T_ARM // top edge of the foot bar
	return [
		{ x: 0, y: 0 }, // crossbar top-left
		{ x: T_WIDTH, y: 0 }, // crossbar top-right
		{ x: T_WIDTH, y: T_ARM }, // crossbar bottom-right
		{ x: stemR, y: T_ARM }, // in to stem, right side
		{ x: stemR, y: footTop }, // down stem right to foot
		{ x: footR, y: footTop }, // out to foot right
		{ x: footR, y: T_HEIGHT }, // foot bottom-right
		{ x: footL, y: T_HEIGHT }, // foot bottom-left
		{ x: footL, y: footTop }, // up to foot top-left
		{ x: stemL, y: footTop }, // in to stem left
		{ x: stemL, y: T_ARM }, // up stem left to crossbar
		{ x: 0, y: T_ARM }, // crossbar bottom-left
	]
})()

/** A geo rectangle spec (page space, top-left + size) for seeding walls. */
interface SeedRect {
	x: number
	y: number
	w: number
	h: number
}

const WALL_T = 60 // outer field wall thickness (px)

// The corridor: TWO vertical walls (from the reference drawing), each split into
// a top and a bottom segment so a shared horizontal GAP runs straight through
// both — the object must thread a channel, not just clear one pinch.
const CORRIDOR_W = 24 // corridor wall thickness (px)
const CORRIDOR_L_X = 536 // left corridor wall (left edge, page x)
const CORRIDOR_R_X = 788 // right corridor wall (left edge, page x)
const GAP_TOP = 321 // gap opening top (page y)
const GAP_BOTTOM = 483 // gap opening bottom (page y) → ~162px channel, centred ~y=402

/** One corridor wall = a top segment and a bottom segment leaving the gap. */
function corridorWall(x: number): SeedRect[] {
	return [
		{ x, y: FIELD.minY, w: CORRIDOR_W, h: GAP_TOP - FIELD.minY },
		{ x, y: GAP_BOTTOM, w: CORRIDOR_W, h: FIELD.maxY - GAP_BOTTOM },
	]
}

/** Seed wall rectangles: the boxed field + the two-wall corridor. */
const SEED_WALLS: SeedRect[] = [
	{ x: FIELD.minX, y: FIELD.minY - WALL_T, w: FIELD.maxX - FIELD.minX, h: WALL_T }, // top
	{ x: FIELD.minX, y: FIELD.maxY, w: FIELD.maxX - FIELD.minX, h: WALL_T }, // bottom
	{ x: FIELD.minX - WALL_T, y: FIELD.minY, w: WALL_T, h: FIELD.maxY - FIELD.minY }, // left
	{ x: FIELD.maxX, y: FIELD.minY, w: WALL_T, h: FIELD.maxY - FIELD.minY }, // right
	...corridorWall(CORRIDOR_L_X),
	...corridorWall(CORRIDOR_R_X),
]

/** Create the default puzzle's shapes (maze walls + tagged T object) on the
 * current page, UNCONDITIONALLY. The object is a native closed DRAW shape whose
 * outline is the experiment's real T-load (see T_OUTLINE) — genuinely concave,
 * so it exercises the convex-decomposition path (a bounding box would be wrong)
 * — tagged via meta.amRole so the sim knows which shape is the load. Runs in a
 * single history-ignored transaction. Callers guard whether to run it:
 * seedDefaultLayout (only on an empty page) vs resetToDefaultLayout (clear
 * first). */
function createDefaultLayout(editor: Editor): void {
	editor.run(
		() => {
			// Walls: native geo rectangles.
			for (const w of SEED_WALLS) {
				editor.createShape({
					type: 'geo',
					x: w.x,
					y: w.y,
					props: { geo: 'rectangle', w: w.w, h: w.h, fill: 'solid', color: 'grey' },
				})
			}
			// The object: a native concave T-with-foot (closed draw shape), tagged as
			// the load. A geo shape can't be this outline, so we author it directly as
			// a draw shape — ONE 'straight' segment PER EDGE, so tldraw renders sharp
			// straight sides (a single 'free' segment gets freehand-smoothed into a
			// rounded blob; a single 'straight' segment is just ONE line between its
			// endpoints). Each edge is a 2-point 'straight' segment from one corner to
			// the next, looping back to close. shapes.ts merges a draw shape's
			// consecutive straight segments back into one continuous outline, so the
			// sim reads the exact 12-corner shape.
			const objId: TLShapeId = createShapeId()
			editor.createShape({
				id: objId,
				type: 'draw',
				x: OBJECT_SPAWN.x,
				y: OBJECT_SPAWN.y,
				meta: { amRole: OBJECT_ROLE },
				props: {
					color: 'blue',
					fill: 'solid',
					dash: 'solid',
					isClosed: true,
					isComplete: true,
					segments: compressLegacySegments(
						T_OUTLINE.map((p, i) => {
							const next = T_OUTLINE[(i + 1) % T_OUTLINE.length]
							return {
								type: 'straight',
								points: [
									{ ...p, z: 0.5 },
									{ ...next, z: 0.5 },
								],
							}
						})
					),
				},
			})
			// The goal flag in the last room, centred on EXIT: a pole (vertical line)
			// with a green "GOAL" banner (rectangle) flown from its top. Both tagged
			// FLAG_ROLE so they're decorative (readWorldSpec skips them — not walls).
			// Pole left edge = banner left edge; banner top aligned to the pole top.
			const poleX = EXIT.cx - FLAG_BANNER_W / 2
			const poleTop = EXIT.cy - FLAG_POLE_H / 2
			editor.createShape({
				type: 'line',
				x: poleX,
				y: poleTop,
				meta: { amRole: FLAG_ROLE },
				props: {
					color: 'black',
					dash: 'solid',
					size: 'm',
					spline: 'line',
					points: {
						a1: { id: 'a1', index: 'a1' as IndexKey, x: 0, y: 0 },
						a2: { id: 'a2', index: 'a2' as IndexKey, x: 0, y: FLAG_POLE_H },
					},
					scale: 1,
				},
			})
			editor.createShape({
				type: 'geo',
				x: poleX,
				y: poleTop,
				meta: { amRole: FLAG_ROLE },
				props: {
					geo: 'rectangle',
					w: FLAG_BANNER_W,
					h: FLAG_BANNER_H,
					fill: 'solid',
					color: 'green',
					richText: toRichText('GOAL'),
				},
			})
			// "Drag" hint: a text label OUTSIDE the left wall (walls start at x=0; the
			// left wall spans x∈[-WALL_T,0]) with a curved arrow pointing at the object's
			// spawn (the T's crossbar). Both tagged DECOR_ROLE so they're decorative —
			// not walls, not scoring (readWorldSpec + win detection skip them).
			editor.createShape({
				type: 'text',
				x: DRAG_LABEL.x,
				y: DRAG_LABEL.y,
				meta: { amRole: DECOR_ROLE },
				props: { richText: toRichText('Drag'), color: 'black', size: 'l', font: 'draw' },
			})
			editor.createShape({
				type: 'arrow',
				x: 0,
				y: 0,
				meta: { amRole: DECOR_ROLE },
				props: {
					kind: 'arc',
					// Page-space endpoints (shape origin is 0,0): from just right of the
					// label, curving over to the T's crossbar top-left corner.
					start: { x: DRAG_LABEL.x + 95, y: DRAG_LABEL.y + 35 },
					// Stop the tip SHORT of the T (up and to the left of the crossbar's
					// top-left corner) so the arrowhead stays clear of the shape.
					end: { x: OBJECT_SPAWN.x - 45, y: OBJECT_SPAWN.y - 25 },
					bend: -55, // curve up-and-over, matching the reference drawing
					color: 'black',
					fill: 'none',
					dash: 'solid',
					size: 'm',
					arrowheadStart: 'none',
					arrowheadEnd: 'arrow',
					font: 'draw',
					richText: toRichText(''),
					labelPosition: 0.5,
					labelColor: 'black',
					scale: 1,
					elbowMidPoint: 0.5,
				},
			})
		},
		{ history: 'ignore' }
	)
}

/** Seed a fresh page with the starter maze + object, once. No-op if the page
 * already has shapes (so an edited/persisted canvas is never clobbered — a
 * joiner never re-seeds an in-progress room; only the first player into an empty
 * room seeds it, and the shapes then sync to everyone). */
export function seedDefaultLayout(editor: Editor): void {
	if (editor.getCurrentPageShapes().length > 0) return
	createDefaultLayout(editor)
}

/** Reset the page to the default puzzle: delete EVERY current shape, then
 * re-author the starter maze + T + flag. Unlike seedDefaultLayout this always
 * rebuilds, so it clobbers any edits — that's the point of a reset. The store is
 * synced, so the wipe + reseed propagates to all players. */
export function resetToDefaultLayout(editor: Editor): void {
	const existing = editor.getCurrentPageShapes().map((s) => s.id)
	editor.run(
		() => {
			if (existing.length) editor.deleteShapes(existing)
		},
		{ history: 'ignore' }
	)
	createDefaultLayout(editor)
}

/** Full game reset: stop the current DO run so it rebuilds from the fresh spec,
 * re-arm auto-start so RunController immediately restarts the sim on the new
 * layout, then wipe + reseed. Shared by the panel's reset button and the win
 * dialog's reset. The canvas isn't read-only (the sync layer keeps it readwrite;
 * play mode is gated at the pointer), so the reseed applies even mid-run. */
export function resetGame(editor: Editor): void {
	autoStartAtom.set(true) // re-arm so the sim auto-restarts on the fresh layout
	playIntentAtom.set('stop')
	resetToDefaultLayout(editor)
}
