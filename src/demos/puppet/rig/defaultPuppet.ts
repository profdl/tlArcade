import { createShapeId, type Editor, type JsonObject, type TLShapeId } from 'tldraw'
import { PUPPET_LAYOUT } from './layout'
import type { PuppetMeta } from './roles'

/**
 * Builds a default puppet entirely from **native tldraw shapes** (geo shapes),
 * each tagged with a rig role via `meta`. It's deliberately plain art the user
 * can select, delete, redraw, or restyle — it's a worked example of the
 * "rig is metadata, not art" contract, not a special asset. Delete any piece
 * and draw your own, then assign it the same role, and the rig keeps working.
 *
 * The layout (which part goes where) comes from the shared {@link PUPPET_LAYOUT}
 * table so the unassigned-part placeholder overlay can draw its dashed slots at
 * exactly the same positions.
 *
 * Returns the created shape ids so the caller can frame/select them.
 */
export function buildDefaultPuppet(editor: Editor, cx: number, cy: number): TLShapeId[] {
	const ids: TLShapeId[] = []

	// Back-to-front paint order (tldraw stacks in creation order) — the table is
	// already in that order.
	for (const part of PUPPET_LAYOUT) {
		const id = createShapeId()
		ids.push(id)
		const px = cx + part.x
		const py = cy + part.y
		// Capture rest at creation time so the driver never has to infer it from a
		// (possibly already-deformed) live shape. See PuppetDriver's rest invariant.
		const meta: PuppetMeta = {
			puppetRole: part.role,
			...part.meta,
			rest: { x: px, y: py, rotation: 0, w: part.w, h: part.h },
		}
		editor.createShape({
			id,
			type: 'geo',
			x: px,
			y: py,
			props: { geo: part.geo, w: part.w, h: part.h, color: part.color, fill: part.fill ?? 'solid', dash: 'draw' },
			meta: meta as unknown as JsonObject,
		})
	}

	return ids
}
