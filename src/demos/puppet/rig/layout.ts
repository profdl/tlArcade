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

/**
 * A friendlier, better-proportioned default face. Every part is still a plain
 * native geo shape tagged with a rig role — the same "rig is metadata" contract.
 * The design changes here are purely in the table:
 *
 *  - warm `light-red` skin instead of flat yellow, so the head reads as a face;
 *  - a neck bridging head → body (no floating head);
 *  - rounder `oval` brows and a soft `oval` mouth instead of blocky rectangles;
 *  - a small nose and two blush cheeks for life;
 *  - white catch-light dots in the pupils;
 *  - hair kept as a cohesive violet (back darker, front lighter) — a deliberate
 *    stylized VTuber palette rather than a clash.
 *
 * Every *decorative* part added here (neck, nose, blush, catch-lights) also gets
 * a binding in DEFAULT_BINDINGS so it tracks head yaw/pitch/roll like the eyes —
 * an unbound part would sit frozen while the head moves and read as broken.
 *
 * Back-to-front paint order. Offsets are page-space deltas from the puppet
 * center; the head spans x∈[-100,100], y∈[-125,115] (200×240).
 */
export const PUPPET_LAYOUT: readonly PuppetPart[] = [
	// --- Behind the head ---
	{ role: 'hairBack', geo: 'cloud', x: -125, y: -155, w: 250, h: 310, color: 'violet', fill: 'solid' },
	{ role: 'body', geo: 'ellipse', x: -120, y: 160, w: 240, h: 240, color: 'blue', fill: 'solid' },
	{ role: 'neck', geo: 'rectangle', x: -28, y: 95, w: 56, h: 70, color: 'light-red', fill: 'solid' },

	// --- Head ---
	{ role: 'head', geo: 'ellipse', x: -100, y: -125, w: 200, h: 240, color: 'light-red', fill: 'solid' },

	// --- Cheeks (behind eyes so eyes sit on top) ---
	{ role: 'blushL', geo: 'ellipse', x: -78, y: 5, w: 40, h: 26, color: 'red', fill: 'semi' },
	{ role: 'blushR', geo: 'ellipse', x: 38, y: 5, w: 40, h: 26, color: 'red', fill: 'semi' },

	// --- Eyes ---
	{ role: 'eyeL', geo: 'ellipse', x: -72, y: -52, w: 58, h: 52, color: 'white', fill: 'solid' },
	{ role: 'eyeR', geo: 'ellipse', x: 14, y: -52, w: 58, h: 52, color: 'white', fill: 'solid' },
	{ role: 'pupilL', geo: 'ellipse', x: -52, y: -42, w: 26, h: 30, color: 'black', fill: 'solid' },
	{ role: 'pupilR', geo: 'ellipse', x: 26, y: -42, w: 26, h: 30, color: 'black', fill: 'solid' },
	{ role: 'catchL', geo: 'ellipse', x: -46, y: -40, w: 9, h: 9, color: 'white', fill: 'solid' },
	{ role: 'catchR', geo: 'ellipse', x: 32, y: -40, w: 9, h: 9, color: 'white', fill: 'solid' },
	// Eyelids blink by collapsing to 0 height — skin-toned so a closed eye looks like eyelid.
	{ role: 'eyelidL', geo: 'rectangle', x: -72, y: -56, w: 58, h: 55, color: 'light-red', fill: 'solid', meta: { pivot: { x: 0.5, y: 0 } } },
	{ role: 'eyelidR', geo: 'rectangle', x: 14, y: -56, w: 58, h: 55, color: 'light-red', fill: 'solid', meta: { pivot: { x: 0.5, y: 0 } } },

	// --- Brows (rounded, arched slightly outward) ---
	{ role: 'browL', geo: 'oval', x: -74, y: -82, w: 52, h: 16, color: 'violet', fill: 'solid', meta: { pivot: { x: 0.5, y: 0.5 } } },
	{ role: 'browR', geo: 'oval', x: 22, y: -82, w: 52, h: 16, color: 'violet', fill: 'solid', meta: { pivot: { x: 0.5, y: 0.5 } } },

	// --- Nose + mouth ---
	{ role: 'nose', geo: 'ellipse', x: -8, y: 5, w: 16, h: 22, color: 'red', fill: 'semi' },
	{ role: 'mouth', geo: 'oval', x: -34, y: 52, w: 68, h: 30, color: 'red', fill: 'solid', meta: { pivot: { x: 0.5, y: 0.5 } } },

	// --- In front of the face ---
	{ role: 'hairFront', geo: 'cloud', x: -110, y: -150, w: 220, h: 95, color: 'light-violet', fill: 'solid' },
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
