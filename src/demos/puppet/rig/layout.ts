import type { Editor, JsonObject, TLDefaultColorStyle, TLDefaultFillStyle, TLGeoShapeGeoStyle } from 'tldraw'
import { getPuppetMeta, type PuppetMeta, type PuppetRole } from './roles'

/**
 * The default puppet's layout: one entry per rig role, giving the geo, offset
 * (relative to the puppet's center) and size that {@link buildDefaultPuppet}
 * uses. It's the single source of truth for "where each face part lives" so two
 * consumers stay in sync:
 *
 *  1. the builder, which stamps native geo shapes tagged with the role, and
 *  2. the placeholder overlay, which draws a subtle dashed slot at exactly the
 *     same spot for any role that currently has NO shape assigned.
 *
 * Because both read this table, an empty slot's placeholder lines up pixel-for-
 * pixel with where the default art would have gone. Offsets are page-space
 * deltas from the puppet center (cx, cy); order is back-to-front paint order.
 */
export type PuppetPart = {
	role: PuppetRole
	geo: TLGeoShapeGeoStyle
	/** Offset of the part's top-left from the puppet center (cx, cy). */
	x: number
	y: number
	w: number
	h: number
	color: TLDefaultColorStyle
	fill?: TLDefaultFillStyle
	meta?: Partial<PuppetMeta>
}

export const PUPPET_LAYOUT: readonly PuppetPart[] = [
	{ role: 'hairBack', geo: 'ellipse', x: -120, y: -150, w: 240, h: 300, color: 'violet' },
	{ role: 'body', geo: 'ellipse', x: -110, y: 150, w: 220, h: 220, color: 'blue' },
	{ role: 'head', geo: 'ellipse', x: -100, y: -120, w: 200, h: 240, color: 'yellow' },
	{ role: 'eyeL', geo: 'ellipse', x: -70, y: -50, w: 55, h: 45, color: 'white' },
	{ role: 'eyeR', geo: 'ellipse', x: 15, y: -50, w: 55, h: 45, color: 'white' },
	{ role: 'pupilL', geo: 'ellipse', x: -50, y: -38, w: 20, h: 22, color: 'black' },
	{ role: 'pupilR', geo: 'ellipse', x: 35, y: -38, w: 20, h: 22, color: 'black' },
	{ role: 'eyelidL', geo: 'rectangle', x: -70, y: -55, w: 55, h: 48, color: 'yellow', fill: 'solid', meta: { pivot: { x: 0.5, y: 0 } } },
	{ role: 'eyelidR', geo: 'rectangle', x: 15, y: -55, w: 55, h: 48, color: 'yellow', fill: 'solid', meta: { pivot: { x: 0.5, y: 0 } } },
	{ role: 'browL', geo: 'rectangle', x: -68, y: -78, w: 50, h: 10, color: 'orange' },
	{ role: 'browR', geo: 'rectangle', x: 18, y: -78, w: 50, h: 10, color: 'orange' },
	{ role: 'mouth', geo: 'ellipse', x: -35, y: 45, w: 70, h: 26, color: 'red', fill: 'solid', meta: { pivot: { x: 0.5, y: 0.5 } } },
	{ role: 'hairFront', geo: 'rectangle', x: -105, y: -135, w: 210, h: 70, color: 'violet' },
]

/** Page-space center the default layout is placed around. */
export type PuppetCenter = { x: number; y: number }

const CENTER_META_KEY = 'puppetCenter'

/**
 * Persist the puppet's fixed-layout center onto the current page's `meta` so it
 * round-trips through the tldraw doc. The placeholder overlay reads it back to
 * place empty-slot markers at the same spots the default art would occupy.
 */
export function setPuppetCenter(editor: Editor, center: PuppetCenter): void {
	const page = editor.getCurrentPage()
	// Store a PLAIN {x, y} — a tldraw `Vec` instance fails the store's
	// json-serializable meta validator ("got object", not a primitive record).
	const plain = { x: center.x, y: center.y }
	editor.updatePage({ id: page.id, meta: { ...page.meta, [CENTER_META_KEY]: plain } })
}

/** Read the persisted puppet center from the current page's meta, or null if never set. */
export function getPuppetCenter(editor: Editor): PuppetCenter | null {
	const c = (editor.getCurrentPage().meta as JsonObject)[CENTER_META_KEY] as Partial<PuppetCenter> | undefined
	if (typeof c?.x === 'number' && typeof c?.y === 'number') return { x: c.x, y: c.y }
	return null
}

/**
 * The default-layout slot for a role: the page-space CENTER the part occupies in
 * the default puppet (its layout offset from the persisted puppet center, plus
 * half its size). This is the same spot the placeholder overlay draws, so an
 * assigned shape can be centered here to land exactly on its empty slot.
 * Returns null when the role isn't in the layout or no puppet center is stored.
 */
export function defaultSlotCenter(editor: Editor, role: PuppetRole): PuppetCenter | null {
	const part = PUPPET_LAYOUT.find((p) => p.role === role)
	const center = getPuppetCenter(editor)
	if (!part || !center) return null
	return { x: center.x + part.x + part.w / 2, y: center.y + part.y + part.h / 2 }
}

/**
 * The layout parts whose role currently has NO shape assigned on the page — the
 * "empty slots" the placeholder overlay draws. A role is considered filled as
 * soon as any shape carries it via `meta.puppetRole`.
 */
export function unassignedParts(editor: Editor): PuppetPart[] {
	const filled = new Set<string>()
	for (const shape of editor.getCurrentPageShapes()) {
		const role = getPuppetMeta(shape)?.puppetRole
		if (role) filled.add(role)
	}
	return PUPPET_LAYOUT.filter((part) => !filled.has(part.role))
}
