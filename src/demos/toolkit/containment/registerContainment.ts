/**
 * CONTAINMENT SIDE-EFFECT  (SPEC §4.2)
 * ====================================
 * "Drop a piece on a container → it goes inside; drag it out → it leaves; the
 * container arranges its contents." tldraw has no native version, so we build it
 * from a `containment` binding + store side-effects.
 *
 * DESIGN (after review — see commit msg): the naive "react to every position
 * change and re-layout" approach recurses, because tldraw fires after-change
 * handlers in a deferred flush loop — our own layout writes re-enter the handler.
 * Instead we:
 *   • CHEAPLY note which pieces moved during a change (just collect ids), and
 *   • do the real work ONCE per store operation, in registerOperationCompleteHandler,
 *     which runs after the whole flush drains — so our layout writes (made in the
 *     next operation) don't recurse within this one.
 *   • skip while a drag is in progress (`editor.isIn('select.translating')`) so we
 *     act on drop, not on every mid-drag frame.
 * Layout writes are wrapped in `editor.run(fn, { history: 'ignore' })` so they
 * don't pollute undo. A `busy` flag belts-and-braces against re-entry.
 *
 * Call `registerContainment(editor)` once from <Tldraw onMount>; it returns a disposer.
 */
import type { Editor, TLShape, TLShapeId, TLShapePartial} from 'tldraw';
import { createBindingId } from 'tldraw'
import type { ContainerShape } from '../shapes/ContainerShape'
import type { ChildSize} from './layout';
import { layoutChildren } from './layout'

export function registerContainment(editor: Editor): () => void {
	let busy = false
	const movedPieces = new Set<TLShapeId>()
	const containersToRelayout = new Set<TLShapeId>()

	const offChange = editor.sideEffects.registerAfterChangeHandler('shape', (prev, next) => {
		if (busy || next.type === 'container') return
		// Creatures swim continuously (a write every tick) and are never container
		// members — skipping them avoids a containerUnder hit-test + binding lookup
		// per creature per frame, a dominant cost with many creatures roaming. A
		// creature's "container" is its geo tank, handled by the swim loop, not here.
		if (next.type === 'creature') return
		if (prev.x !== next.x || prev.y !== next.y) movedPieces.add(next.id)
	})

	// A container itself moved → re-pack its children to follow it.
	const offContainerMove = editor.sideEffects.registerAfterChangeHandler('shape', (prev, next) => {
		if (busy || next.type !== 'container') return
		if (prev.x !== next.x || prev.y !== next.y) containersToRelayout.add(next.id)
	})

	// A bound child was deleted → re-pack the container that held it.
	const offDelete = editor.sideEffects.registerAfterDeleteHandler('shape', (shape) => {
		if (busy) return
		for (const b of editor.getBindingsInvolvingShape(shape.id)) {
			if (b.type === 'containment') containersToRelayout.add(b.fromId)
		}
	})

	// Do the real work once per store operation, after the flush has fully drained.
	const offComplete = editor.sideEffects.registerOperationCompleteHandler(() => {
		if (busy) return
		// Don't reshuffle a piece the user is still dragging — wait for the drop.
		if (editor.isIn('select.translating')) return
		if (movedPieces.size === 0 && containersToRelayout.size === 0) return

		busy = true
		try {
			editor.run(
				() => {
					for (const id of movedPieces) {
						const shape = editor.getShape(id)
						if (shape) syncMembership(editor, shape, containersToRelayout)
					}
					for (const id of containersToRelayout) relayout(editor, id)
				},
				{ history: 'ignore' }
			)
		} finally {
			movedPieces.clear()
			containersToRelayout.clear()
			busy = false
		}
	})

	return () => {
		offChange()
		offContainerMove()
		offDelete()
		offComplete()
	}
}

/** Bind `shape` to the container under its centre (or unbind), noting which
 *  containers need a relayout as a result. */
function syncMembership(editor: Editor, shape: TLShape, dirty: Set<TLShapeId>) {
	const container = containerUnder(editor, shape.id)
	const existing = editor.getBindingsInvolvingShape(shape.id).find((b) => b.type === 'containment')

	const currentContainerId = existing?.fromId ?? null
	const targetContainerId = container?.id ?? null
	if (currentContainerId === targetContainerId) return

	if (existing) {
		editor.deleteBinding(existing.id)
		dirty.add(existing.fromId)
	}
	if (container) {
		const index = editor.getBindingsFromShape(container.id, 'containment').length
		editor.createBinding({
			id: createBindingId(),
			type: 'containment',
			fromId: container.id,
			toId: shape.id,
			props: { index },
		})
		dirty.add(container.id)
	}
}

/** The topmost container whose bounds contain the shape's page centre. */
function containerUnder(editor: Editor, shapeId: TLShapeId): ContainerShape | null {
	const bounds = editor.getShapePageBounds(shapeId)
	if (!bounds) return null
	const hit = editor.getShapeAtPoint(bounds.center, {
		filter: (s) => s.type === 'container',
		hitInside: true,
	})
	return (hit as ContainerShape | undefined) ?? null
}

/** Arrange one container's bound children, in binding `index` order. */
function relayout(editor: Editor, containerId: TLShapeId) {
	const container = editor.getShape(containerId) as ContainerShape | undefined
	if (!container || container.type !== 'container') return

	const bindings = editor
		.getBindingsFromShape(containerId, 'containment')
		.slice()
		.sort((a, b) => (a.props.index as number) - (b.props.index as number))
	if (bindings.length === 0) return

	const bounds = editor.getShapePageBounds(containerId)
	if (!bounds) return

	const childIds = bindings.map((b) => b.toId)
	const sizes: ChildSize[] = childIds.map((id) => {
		const b = editor.getShapePageBounds(id)
		return { w: b?.width ?? 40, h: b?.height ?? 40 }
	})
	const placements = layoutChildren(
		container.props.layout,
		bounds.x,
		bounds.y,
		container.props.w,
		container.props.h,
		sizes
	)
	childIds.forEach((id, i) => {
		const child = editor.getShape(id)
		if (child) editor.updateShape({ id, type: child.type, x: placements[i].x, y: placements[i].y } as TLShapePartial)
	})
}
