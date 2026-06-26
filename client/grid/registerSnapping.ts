/**
 * GRID SNAPPING  (SPEC §4.1, §5.6)
 * ================================
 * On drop, if a moved piece sits over a grid with `snap: 'strict'`, clamp the
 * piece so its centre lands on the nearest cell centre. `loose`/`none` don't
 * clamp (loose could draw a guide later; for now it's a no-op).
 *
 * Same lifecycle discipline as containment (see registerContainment): collect
 * moved piece ids cheaply during change, do the work once per operation after
 * the flush drains, skip while still dragging, guard against re-entry. Call once
 * from <Tldraw onMount>; returns a disposer.
 */
import { Editor, TLShapeId } from 'tldraw'
import { GridShape } from '../shapes/GridShape'
import { makeGrid } from './geometry'

export function registerSnapping(editor: Editor): () => void {
	let busy = false
	const moved = new Set<TLShapeId>()

	const offChange = editor.sideEffects.registerAfterChangeHandler('shape', (prev, next) => {
		if (busy || next.type === 'grid') return
		// Creatures swim continuously (a write every tick) and never snap to a grid —
		// skipping them here avoids running a gridUnder hit-test per creature per
		// frame, which was a dominant cost with many creatures roaming. See the swim
		// loop perf notes.
		if (next.type === 'creature') return
		if (prev.x !== next.x || prev.y !== next.y) moved.add(next.id)
	})

	const offComplete = editor.sideEffects.registerOperationCompleteHandler(() => {
		if (busy || moved.size === 0) return
		if (editor.isIn('select.translating')) return // wait for the drop

		busy = true
		try {
			editor.run(() => {
				for (const id of moved) snapToGrid(editor, id)
			}, { history: 'ignore' })
		} finally {
			moved.clear()
			busy = false
		}
	})

	return () => {
		offChange()
		offComplete()
	}
}

function snapToGrid(editor: Editor, id: TLShapeId) {
	const shape = editor.getShape(id)
	const bounds = editor.getShapePageBounds(id)
	if (!shape || !bounds) return

	const grid = gridUnder(editor, bounds.center)
	if (!grid || grid.props.snap !== 'strict') return

	const gridBounds = editor.getShapePageBounds(grid.id)
	if (!gridBounds) return

	// Snap in the grid's LOCAL space (its geometry origin is the grid's top-left).
	const local = { x: bounds.center.x - gridBounds.x, y: bounds.center.y - gridBounds.y }
	const geom = makeGrid(grid.props.type, grid.props.cellSize)
	const cell = geom.snap(local)

	// Convert the snapped centre back to a top-left page position for the piece.
	const nextX = gridBounds.x + cell.x - bounds.width / 2
	const nextY = gridBounds.y + cell.y - bounds.height / 2
	if (Math.abs(nextX - shape.x) < 0.5 && Math.abs(nextY - shape.y) < 0.5) return
	editor.updateShape({ id, type: shape.type, x: nextX, y: nextY })
}

/** The topmost grid whose bounds contain a page point. */
function gridUnder(editor: Editor, p: { x: number; y: number }): GridShape | null {
	const hit = editor.getShapeAtPoint(p, {
		filter: (s) => s.type === 'grid',
		hitInside: true,
	})
	return (hit as GridShape | undefined) ?? null
}
