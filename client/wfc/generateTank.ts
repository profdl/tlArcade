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
import { Editor, TLShapeId, TLShapePartial, createShapeId } from 'tldraw'
import { buildTankRects, tankExtent, type TankRect } from './tankGeometry.ts'
import { buildChaosTankRects } from './chaosGeometry.ts'

/** Write a list of resolved rects to the store as synced geo shapes, sent to the BACK
 *  (so creatures render above them), in ONE history-ignored batch. Returns their ids. */
function writeRects(editor: Editor, rects: TankRect<TLShapeId>[]): TLShapeId[] {
	const partials: TLShapePartial[] = rects.map((r) => ({ id: r.id, type: 'geo', x: r.x, y: r.y, props: r.props } as TLShapePartial))
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
	return writeRects(editor, rects)
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
	return writeRects(editor, rects)
}
