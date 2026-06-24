/**
 * SHARED SHAPE SCHEMAS  (prop validators)
 * =======================================
 * The prop VALIDATORS for each custom shape live here so they have exactly ONE
 * source of truth, shared by:
 *   • the client editor   (client/shapes/*.tsx → `static props = ...`)
 *   • the sync server     (worker/TldrawDurableObject.ts → createTLSchema)
 *
 * This file imports `@tldraw/validate` ONLY (no React, no DOM), so it is safe to
 * import inside the Cloudflare Worker. The client shape files add the rendering.
 *
 * When you add a new shape: define its prop validators here, then reference them
 * from both the client ShapeUtil and the worker schema. (See CLAUDE.md.)
 */
import { T } from '@tldraw/validate'

export const tokenShapeValidators = {
	w: T.number,
	h: T.number,
	style: T.literalEnum('cube', 'disc', 'meeple', 'cylinder', 'ring'),
	color: T.literalEnum('red', 'blue', 'green', 'yellow', 'black', 'white'),
	count: T.positiveInteger,
	label: T.string,
}

export const trackerShapeValidators = {
	w: T.number,
	h: T.number,
	kind: T.literalEnum('linearTrack', 'circularDial', 'spinnerArrow'),
	min: T.number,
	max: T.number,
	step: T.number,
	value: T.number,
}

/**
 * The map the SYNC SERVER uses. Each entry's `props` must match the client
 * ShapeUtil's `static props`. Keep this list in sync with
 * `client/shapes/registry.ts`.
 */
export const gameShapeSchemas = {
	token: { props: tokenShapeValidators },
	tracker: { props: trackerShapeValidators },
	// ← add your shape's `{ props: <validators> }` here
}
