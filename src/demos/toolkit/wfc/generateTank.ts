/**
 * GENERATE TANK — write a WFC-generated tank to the store as synced geo shapes.
 * =============================================================================
 * The thin IMPURE wrapper around the pure layout (tankGeometry.ts). It centres a
 * generated grid on the viewport, mints real shape ids, and writes the rects to the
 * store. Because they're ordinary synced `geo` shapes, every client sees the tank
 * instantly and anyone can drop creatures into it — no special transport (CLAUDE.md
 * gotcha #7: write to the store, sync replicates for free). All the geometry — rooms,
 * 10%-overlap doorways, food placement — lives in tankGeometry.ts and is unit-tested.
 *
 * STYLING (set in tankGeometry): rooms + doorways are solid ORANGE; food is solid
 * GREEN (must stay green — that's how the swim loop identifies food).
 */
import type { Editor, TLShapeId, TLShapePartial} from 'tldraw';
import { createShapeId } from 'tldraw'
import { buildTankRects, tankExtent, type TankRect } from './tankGeometry.ts'
import { buildChaosTankRects } from './chaosGeometry.ts'
import { mulberry32 } from './collapse.ts'

/** How many creatures to drop into random rooms when a tank is generated. */
const SPAWN_CREATURE_COUNT = 5

/** Write a list of resolved rects to the store as synced geo shapes, sent to the BACK
 *  (so creatures render above them), in ONE history-ignored batch. Returns their ids. */
function writeRects(editor: Editor, rects: TankRect<TLShapeId>[]): TLShapeId[] {
	const partials: TLShapePartial[] = rects.map(
		(r) => ({ id: r.id, type: 'geo', x: r.x, y: r.y, rotation: r.rotation ?? 0, props: r.props } as TLShapePartial)
	)
	editor.run(
		() => {
			editor.createShapes(partials)
			editor.sendToBack(rects.map((r) => r.id))
		},
		{ history: 'ignore' }
	)
	return rects.map((r) => r.id)
}

/**
 * Drop SPAWN_CREATURE_COUNT fish into random ROOMS of a just-generated tank. Each lands at a
 * room's CENTRE (reliably inside the painted shape) so the swim loop adopts it. The rooms are
 * picked via a seeded shuffle off the tank seed, so a generated tank is reproducible. Created
 * AFTER (and not sent to back) so they render above the tank, like any dropped piece.
 */
function spawnCreaturesInRooms(editor: Editor, rects: TankRect<TLShapeId>[], seed: number): void {
	const roomRects = rects.filter((r) => r.kind === 'room')
	if (roomRects.length === 0) return
	const rng = mulberry32((seed ^ 0x1d2c6f) >>> 0)

	// Shuffle room indices and take the first N (so creatures land in DISTINCT rooms).
	const idx = roomRects.map((_, i) => i)
	for (let i = idx.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1))
		;[idx[i], idx[j]] = [idx[j], idx[i]]
	}
	const chosen = idx.slice(0, Math.min(SPAWN_CREATURE_COUNT, roomRects.length))

	editor.run(
		() => {
			for (const i of chosen) {
				const r = roomRects[i]
				// Room centre in page space. r.x,r.y is the (un-rotated) top-left; rotating the
				// half-box offset gives the centre — but for placement the AABB centre suffices
				// since the shape contains it. Use the simple centre of the local box rotated.
				const cos = Math.cos(r.rotation ?? 0)
				const sin = Math.sin(r.rotation ?? 0)
				const cx = r.x + (r.w / 2) * cos - (r.h / 2) * sin
				const cy = r.y + (r.w / 2) * sin + (r.h / 2) * cos
				// Creature shapes are ~60×32; offset so the body centres on the room centre.
				editor.createShape({ id: createShapeId(), type: 'creature', x: cx - 30, y: cy - 16, props: { kind: 'fish' } })
			}
		},
		{ history: 'ignore' }
	)
}

/**
 * Generate a tidy WFC tank and WRITE it to the store, centred on the viewport. Because
 * they're ordinary synced `geo` shapes, every client sees the tank and anyone can drop
 * creatures into it (CLAUDE.md gotcha #7). All geometry lives in tankGeometry.ts.
 *
 * `seed` defaults to a time-derived value so each click makes a different tank; pass a
 * fixed seed to reproduce one.
 *
 * SIZE: the default is 12×12 = 144 cells — 12× the original 4×3 = 12-room tank — before
 * pruning removes ~a third for an irregular outline. (A big collapse; the WFC retry budget
 * in collapse() comfortably handles this size.)
 */
export function generateTank(editor: Editor, width = 12, height = 12, seed = Date.now() & 0xffffffff): TLShapeId[] {
	const vp = editor.getViewportPageBounds()
	const extent = tankExtent(width, height)
	const originX = vp.center.x - extent.w / 2
	const originY = vp.center.y - extent.h / 2

	const rects = buildTankRects(() => createShapeId(), width, height, seed, originX, originY)
	const ids = writeRects(editor, rects)
	spawnCreaturesInRooms(editor, rects, seed)
	return ids
}

/**
 * Generate a CHAOS tank — same reachable topology, but rooms are varied native geo shapes
 * at random scales/colours, jittered off the grid, with deep (50%) doorways. See
 * chaosGeometry.ts. Centred on the viewport (with a little extra margin for the jitter +
 * up-to-1.35× room scale that can spill past the nominal grid extent).
 */
export function generateChaosTank(editor: Editor, width = 12, height = 12, seed = Date.now() & 0xffffffff): TLShapeId[] {
	const vp = editor.getViewportPageBounds()
	const extent = tankExtent(width, height)
	const originX = vp.center.x - extent.w / 2
	const originY = vp.center.y - extent.h / 2

	const rects = buildChaosTankRects(() => createShapeId(), width, height, seed, originX, originY)
	const ids = writeRects(editor, rects)
	spawnCreaturesInRooms(editor, rects, seed)
	return ids
}
