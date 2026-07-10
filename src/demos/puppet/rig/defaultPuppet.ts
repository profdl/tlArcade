import {
	createShapeId,
	type Editor,
	type JsonObject,
	type TLDefaultColorStyle,
	type TLDefaultFillStyle,
	type TLGeoShapeGeoStyle,
	type TLShapeId,
} from 'tldraw'
import type { PuppetMeta, PuppetRole } from './roles'

/**
 * Builds a default puppet entirely from **native tldraw shapes** (geo shapes),
 * each tagged with a rig role via `meta`. It's deliberately plain art the user
 * can select, delete, redraw, or restyle — it's a worked example of the
 * "rig is metadata, not art" contract, not a special asset. Delete any piece
 * and draw your own, then assign it the same role, and the rig keeps working.
 *
 * Returns the created shape ids so the caller can frame/select them.
 */
export function buildDefaultPuppet(editor: Editor, cx: number, cy: number): TLShapeId[] {
	const ids: TLShapeId[] = []

	const add = (
		role: PuppetRole,
		geo: TLGeoShapeGeoStyle,
		x: number,
		y: number,
		w: number,
		h: number,
		color: TLDefaultColorStyle,
		fill: TLDefaultFillStyle = 'solid',
		extraMeta: Partial<PuppetMeta> = {}
	) => {
		const id = createShapeId()
		ids.push(id)
		const meta: PuppetMeta = { puppetRole: role, ...extraMeta }
		editor.createShape({
			id,
			type: 'geo',
			x: cx + x,
			y: cy + y,
			props: { geo, w, h, color, fill, dash: 'draw' },
			meta: meta as unknown as JsonObject,
		})
		return id
	}

	// Back-to-front paint order (tldraw stacks in creation order).
	add('hairBack', 'ellipse', -120, -150, 240, 300, 'violet')
	add('body', 'ellipse', -110, 150, 220, 220, 'blue')
	add('head', 'ellipse', -100, -120, 200, 240, 'yellow')
	// Eyes (whites) + pupils.
	add('eyeL', 'ellipse', -70, -50, 55, 45, 'white')
	add('eyeR', 'ellipse', 15, -50, 55, 45, 'white')
	add('pupilL', 'ellipse', -50, -38, 20, 22, 'black')
	add('pupilR', 'ellipse', 35, -38, 20, 22, 'black')
	// Eyelids: same-size solid overlays that collapse to a slit as the eye "closes".
	// Pivot at top so they hinge down from the top lid.
	add('eyelidL', 'rectangle', -70, -55, 55, 48, 'yellow', 'solid', { pivot: { x: 0.5, y: 0 } })
	add('eyelidR', 'rectangle', 15, -55, 55, 48, 'yellow', 'solid', { pivot: { x: 0.5, y: 0 } })
	// Brows.
	add('browL', 'rectangle', -68, -78, 50, 10, 'orange')
	add('browR', 'rectangle', 18, -78, 50, 10, 'orange')
	// Mouth — pivot at center so it opens symmetrically.
	add('mouth', 'ellipse', -35, 45, 70, 26, 'red', 'solid', { pivot: { x: 0.5, y: 0.5 } })
	// Front hair on top.
	add('hairFront', 'rectangle', -105, -135, 210, 70, 'violet')

	return ids
}
