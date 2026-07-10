import type { TLShape, TLShapeId } from 'tldraw'

/**
 * A puppet is not a special kind of shape — it's ordinary tldraw art (draw,
 * geo, image, group…) tagged, via each shape's `meta`, with the *role* it plays
 * in the rig. The driver transforms whatever shapes carry these tags and is
 * totally blind to what they actually are. Redraw a feature, swap geo for a
 * doodle, import a PNG — as long as it carries the role, the rig picks it up.
 */

/** The built-in role vocabulary. Any string is allowed (custom roles); these are the ones the default binding table knows about. */
export const PUPPET_ROLES = [
	'head',
	'hairFront',
	'hairBack',
	'body',
	'eyeL',
	'eyeR',
	'eyelidL', // an overlay shape scaled to 0 height as the eye "opens"
	'eyelidR',
	'browL',
	'browR',
	'pupilL', // follows gaze within the eye
	'pupilR',
	'mouth',
	'accessory',
] as const

export type PuppetRole = (typeof PUPPET_ROLES)[number] | (string & {})

/**
 * The rig metadata written onto a shape's `meta`. Everything here is plain JSON
 * so it round-trips through the tldraw doc and export.
 */
export type PuppetMeta = {
	/** Which rig role this shape plays. Absence of this key means "not part of the puppet". */
	puppetRole: PuppetRole
	/**
	 * Rotation/scale pivot in the shape's own local unit space (0..1 across its
	 * bounds). Defaults to the shape center (0.5, 0.5) when omitted.
	 */
	pivot?: { x: number; y: number }
	/**
	 * For swap-sets (e.g. several mouth shapes as visemes): which discrete variant
	 * this shape represents. The driver cross-fades opacity between same-role
	 * variants by a param. Omit for a single continuously-deformed feature.
	 */
	variant?: string
	/**
	 * Optional per-shape binding override name. When set, the driver uses this
	 * entry from the binding table instead of the one keyed by `puppetRole`,
	 * letting a user rebind a feature without changing its role.
	 */
	binding?: string
}

/** Read a shape's puppet meta, or null if it isn't tagged as a rig feature. */
export function getPuppetMeta(shape: TLShape): PuppetMeta | null {
	const role = (shape.meta as Partial<PuppetMeta>)?.puppetRole
	if (typeof role !== 'string' || role.length === 0) return null
	return shape.meta as unknown as PuppetMeta
}

/** True if this shape is tagged as part of the puppet. */
export function isPuppetShape(shape: TLShape): boolean {
	return getPuppetMeta(shape) !== null
}

/** A rig feature resolved for a frame: the shape id + its parsed meta + the origin transform to deform from. */
export type RigFeature = {
	id: TLShapeId
	role: PuppetRole
	meta: PuppetMeta
	/** The shape's rest-pose transform, captured when the rig is (re)scanned, so per-frame deltas are relative to rest, not cumulative. */
	rest: { x: number; y: number; rotation: number }
}
