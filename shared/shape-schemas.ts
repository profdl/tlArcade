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
import {
	DefaultColorStyle,
	DefaultDashStyle,
	DefaultFillStyle,
	DefaultSizeStyle,
	StyleProp,
} from '@tldraw/tlschema'

/**
 * The set of creature kinds, and the native enum StyleProp that selects between
 * them. Lives here (worker-safe, no client deps) so it's the SINGLE source of
 * truth: the client variant registry imports CREATURE_KINDS, and CreatureKindStyle
 * — being a registered StyleProp — makes the kind picker appear in the style panel
 * automatically and lets you switch a creature in place, exactly like the built-in
 * `geo` shape switches rectangle↔ellipse. (CLAUDE.md gotcha #8: prefer native styles.)
 */
export const CREATURE_KINDS = ['fish', 'snake', 'jellyfish', 'crab', 'ant'] as const
export type CreatureKind = (typeof CREATURE_KINDS)[number]

export const CreatureKindStyle = StyleProp.defineEnum('creature:kind', {
	defaultValue: 'fish',
	values: CREATURE_KINDS,
})

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

export const creatureShapeValidators = {
	w: T.number,
	h: T.number,
	// Picks WHICH creature this is. The body math is a deterministic function of
	// `seed`, so every client draws the same swimmer — the only bespoke synced
	// state. The animation itself is computed locally each frame (NOT synced);
	// see client/creature/clock.ts and CreatureShape.tsx.
	seed: T.number,
	// Undulation rate. Public knob: higher = faster swim. Local clock multiplies it.
	speed: T.number,
	// NATIVE tldraw STYLE props. These are the SAME StyleProp objects the built-in
	// shapes use, so the creature shares the global palette and shows up in the
	// style panel automatically — change it exactly like any other shape. The
	// worker's createTLSchema auto-collects these StyleProps from the props map.
	//   kind  → WHICH creature (fish/snake/…)   color → palette hue
	//   size  → stroke width (s/m/l/xl)          dash  → 'draw' = hand-drawn
	//   fill  → none/semi/solid/pattern body fill
	// `kind` is also a StyleProp, so switching it (style panel) transforms the
	// creature in place, exactly like the geo shape's rectangle↔ellipse selector.
	kind: CreatureKindStyle,
	color: DefaultColorStyle,
	size: DefaultSizeStyle,
	dash: DefaultDashStyle,
	fill: DefaultFillStyle,
}

export const bloomShapeValidators = {
	w: T.number,
	h: T.number,
	// Deterministic shape seed (arm twist + per-petal phase). Same value on every
	// client = identical bloom. The animation itself is computed locally each frame
	// from the shared clock (NOT synced); see client/shapes/BloomShape.tsx.
	seed: T.number,
	// Wave/breathing rate. Public knob: higher = faster pulse. Local clock multiplies.
	speed: T.number,
	// NATIVE tldraw STYLE props (same objects the built-ins use): the bloom shares
	// the global palette + style panel automatically. createTLSchema auto-collects.
	//   color → petal hue        size → stroke weight (s/m/l/xl)
	//   dash  → arm line style
	color: DefaultColorStyle,
	size: DefaultSizeStyle,
	dash: DefaultDashStyle,
}

export const hydraShapeValidators = {
	w: T.number,
	h: T.number,
	// Deterministic seed (arm count + per-arm phase/curl/length). Same value on every
	// client = identical hydra. The animation is computed locally each frame from the
	// shared clock (NOT synced); see client/shapes/HydraShape.tsx.
	seed: T.number,
	// Writhe rate. Public knob: higher = faster tentacles. Local clock multiplies.
	speed: T.number,
	// NATIVE tldraw STYLE props (line-art: color/size/dash, no fill).
	color: DefaultColorStyle,
	size: DefaultSizeStyle,
	dash: DefaultDashStyle,
}

export const frondShapeValidators = {
	w: T.number,
	h: T.number,
	// Deterministic seed (arm count + per-arm phase/curl/length). Animation computed
	// locally each frame from the shared clock; see client/shapes/FrondShape.tsx.
	seed: T.number,
	speed: T.number,
	// NATIVE tldraw STYLE props (open-path line-art: color/size/dash, no fill).
	color: DefaultColorStyle,
	size: DefaultSizeStyle,
	dash: DefaultDashStyle,
}

export const plumeShapeValidators = {
	w: T.number,
	h: T.number,
	// Deterministic seed (spine curve + barb count/length/phase). Animation computed
	// locally each frame from the shared clock; see client/shapes/PlumeShape.tsx.
	seed: T.number,
	speed: T.number,
	// NATIVE styles: color (hue) + size (weight) + dash (line style — defaults dotted,
	// the signature look, but solid/dashed/draw are selectable in the style panel).
	color: DefaultColorStyle,
	size: DefaultSizeStyle,
	dash: DefaultDashStyle,
}

export const ribbonShapeValidators = {
	w: T.number,
	h: T.number,
	// Deterministic seed (Lissajous frequencies + phases + drift rates). Animation
	// computed locally each frame from the shared clock; see client/shapes/RibbonShape.tsx.
	seed: T.number,
	speed: T.number,
	// NATIVE styles only: color/size/dash.
	color: DefaultColorStyle,
	size: DefaultSizeStyle,
	dash: DefaultDashStyle,
}

export const canvasSnakeValidators = {
	w: T.number,
	h: T.number,
	// Deterministic seed (spine wobble phase + eye jitter). The slithering body is
	// animated locally each frame from the shared clock; the WHOLE-SHAPE roaming
	// (x/y/rotation around the viewport) is driven by client/creature/registerCanvasSnake.ts.
	seed: T.number,
	speed: T.number,
	// NATIVE styles only: color (ink hue) + size (body weight) + dash. The body is the
	// perfect-freehand FILLED outline (getStroke), so 'draw' isn't special here — every
	// dash renders the same hand-drawn ink blob; dash only restyles the centre seam.
	color: DefaultColorStyle,
	size: DefaultSizeStyle,
	dash: DefaultDashStyle,
}

export const spiderShapeValidators = {
	w: T.number,
	h: T.number,
	// Deterministic seed (per-leg jitter + step desync). Animation computed locally each
	// frame from the shared clock; see client/shapes/SpiderShape.tsx.
	seed: T.number,
	speed: T.number,
	// NATIVE styles only: color/size/dash (one open-path line creature, no fill).
	color: DefaultColorStyle,
	size: DefaultSizeStyle,
	dash: DefaultDashStyle,
}

// Single-continuous-stroke spider variants (stress-test siblings of `spider`). Same
// props; only the per-frame pen routing differs. See client/shapes/SpiderBlobsShape.tsx
// (two blobs, legs retraced) and SpiderOvalShape.tsx (one oval, legs off the rim).
export const spiderBlobsShapeValidators = {
	w: T.number,
	h: T.number,
	seed: T.number,
	speed: T.number,
	color: DefaultColorStyle,
	size: DefaultSizeStyle,
	dash: DefaultDashStyle,
}

export const spiderOvalShapeValidators = {
	w: T.number,
	h: T.number,
	seed: T.number,
	speed: T.number,
	color: DefaultColorStyle,
	size: DefaultSizeStyle,
	dash: DefaultDashStyle,
}

export const gameShapeSchemas = {
	token: { props: tokenShapeValidators },
	tracker: { props: trackerShapeValidators },
	die: { props: dieShapeValidators },
	card: { props: cardShapeValidators },
	container: { props: containerShapeValidators },
	grid: { props: gridShapeValidators },
	creature: { props: creatureShapeValidators },
	bloom: { props: bloomShapeValidators },
	hydra: { props: hydraShapeValidators },
	frond: { props: frondShapeValidators },
	plume: { props: plumeShapeValidators },
	ribbon: { props: ribbonShapeValidators },
	canvasSnake: { props: canvasSnakeValidators },
	spider: { props: spiderShapeValidators },
	spiderBlobs: { props: spiderBlobsShapeValidators },
	spiderOval: { props: spiderOvalShapeValidators },
	// ← add your shape's `{ props: <validators> }` here
}

/** Binding schemas the SYNC SERVER registers (must match client binding utils). */
export const gameBindingSchemas = {
	containment: { props: { index: T.number } },
}
