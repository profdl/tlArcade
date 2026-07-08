// The starter-layout seed: draws a maze + object onto a fresh canvas as NATIVE
// tldraw shapes, once. Split out of geometry.ts because it imports tldraw
// (createShape) — geometry.ts must stay tldraw-free so the sim import chain
// ports cleanly into the Durable Object. After seeding, the shapes are ordinary
// editable tldraw shapes (author mode); the seed is just a convenient start, not
// a source of truth the sim reads.

import { createShapeId, type Editor, type TLShapeId } from 'tldraw'
import { FIELD, type Vec2 } from './geometry'
import { OBJECT_ROLE } from './shapes'

/** Where the object seeds (page-space top-left of its bounding box). */
const OBJECT_SPAWN: Vec2 = { x: 130, y: 300 }
/** Seed object size (px). A star this size is comfortably wider than the pinch
 * gap (240px) at some orientations, so it must be turned to thread it. */
const OBJECT_SIZE = 200

/** A geo rectangle spec (page space, top-left + size) for seeding walls. */
interface SeedRect {
	x: number
	y: number
	w: number
	h: number
}

const WALL_T = 60 // wall thickness (px)
const CORRIDOR_X = 620 // x of the pinch
const GAP = 120 // half the opening → 240px tall
const GAP_CY = 400
const GAP_TOP = GAP_CY - GAP
const GAP_BOTTOM = GAP_CY + GAP

/** Seed wall rectangles (boxed field + a central pinch). */
const SEED_WALLS: SeedRect[] = [
	{ x: FIELD.minX, y: FIELD.minY - WALL_T, w: FIELD.maxX - FIELD.minX, h: WALL_T }, // top
	{ x: FIELD.minX, y: FIELD.maxY, w: FIELD.maxX - FIELD.minX, h: WALL_T }, // bottom
	{ x: FIELD.minX - WALL_T, y: FIELD.minY, w: WALL_T, h: FIELD.maxY - FIELD.minY }, // left
	{ x: FIELD.maxX, y: FIELD.minY, w: WALL_T, h: FIELD.maxY - FIELD.minY }, // right
	// The pinch: two vertical walls leaving a gap centered on GAP_CY.
	{ x: CORRIDOR_X - WALL_T / 2, y: FIELD.minY, w: WALL_T, h: GAP_TOP - FIELD.minY },
	{ x: CORRIDOR_X - WALL_T / 2, y: GAP_BOTTOM, w: WALL_T, h: FIELD.maxY - GAP_BOTTOM },
]

/** Seed a fresh page with the starter maze + object, once. No-op if the page
 * already has shapes (so an edited/persisted canvas is never clobbered). The
 * object is a native geo STAR — genuinely concave, so it exercises the
 * convex-decomposition path (a bounding box would be wrong) — tagged via
 * meta.amRole so the sim knows which shape is the load. Users can delete it and
 * designate any other drawing as the object instead. */
export function seedDefaultLayout(editor: Editor): void {
	if (editor.getCurrentPageShapes().length > 0) return

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
			// The object: a native concave star, tagged as the load.
			const objId: TLShapeId = createShapeId()
			editor.createShape({
				id: objId,
				type: 'geo',
				x: OBJECT_SPAWN.x,
				y: OBJECT_SPAWN.y,
				meta: { amRole: OBJECT_ROLE },
				props: { geo: 'star', w: OBJECT_SIZE, h: OBJECT_SIZE, fill: 'solid', color: 'blue' },
			})
		},
		{ history: 'ignore' }
	)
}
