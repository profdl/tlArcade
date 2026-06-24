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

export const dieShapeValidators = {
	w: T.number,
	h: T.number,
	// number of faces the referee rolls over (d6 → 6). For custom dice this is
	// customFaces.length; for standard dice it's the die size.
	faceCount: T.positiveInteger,
	// custom face labels, e.g. ['+','+','-','-','',''] for a Fate die. Empty = numeric.
	customFaces: T.arrayOf(T.string),
	// the current top face, as a 0-based index into the faces.
	value: T.number,
	// drives the local spin animation while a roll is in flight.
	rolling: T.boolean,
}

/**
 * The map the SYNC SERVER uses. Each entry's `props` must match the client
 * ShapeUtil's `static props`. Keep this list in sync with
 * `client/shapes/registry.ts`.
 */
export const cardShapeValidators = {
	w: T.number,
	h: T.number,
	aspect: T.literalEnum('poker', 'square', 'tarot'),
	state: T.literalEnum('faceUp', 'faceDown'),
	// card-back appearance (shown while face-down)
	backColor: T.string,
	// PUBLIC face value — only set when the card is face-up & public. Null = hidden.
	revealedValue: T.nullable(T.string),
	// opaque referee handle while hidden; resolves to the real value server-side.
	// NEVER holds the value itself — that would leak it to every client.
	secretRef: T.nullable(T.string),
	// seat that privately owns this card (owner-only hands). Null = on the table.
	owner: T.nullable(T.string),
}

export const containerShapeValidators = {
	w: T.number,
	h: T.number,
	label: T.string,
	visibility: T.literalEnum('public', 'hidden', 'ownerOnly'),
	owner: T.nullable(T.string), // SeatId for ownerOnly
	layout: T.literalEnum('autoGrid', 'stack', 'fan'),
	// public count of hidden contents (a deck/bag seeded via the referee).
	// 0 for a plain public container that just holds visible pieces.
	count: T.positiveInteger,
}

export const gridShapeValidators = {
	w: T.number,
	h: T.number,
	type: T.literalEnum('square', 'hexFlat', 'hexPointy'),
	cellSize: T.positiveInteger,
	snap: T.literalEnum('strict', 'loose', 'none'),
}

export const gameShapeSchemas = {
	token: { props: tokenShapeValidators },
	tracker: { props: trackerShapeValidators },
	die: { props: dieShapeValidators },
	card: { props: cardShapeValidators },
	container: { props: containerShapeValidators },
	grid: { props: gridShapeValidators },
	// ← add your shape's `{ props: <validators> }` here
}

/** Binding schemas the SYNC SERVER registers (must match client binding utils). */
export const gameBindingSchemas = {
	containment: { props: { index: T.number } },
}
