/**
 * CREATURE VARIANT REGISTRY
 * =========================
 * Maps each `kind` (the synced enum StyleProp on the creature shape) to its
 * variant — geometry generator + motion params. Adding a creature = add a file in
 * this folder and one line here. The renderer (CreatureShape.tsx) and the swim
 * loop (registerSwimming.ts) are generic over whatever a variant produces.
 *
 * CREATURE_KINDS is the SINGLE SOURCE OF TRUTH for the set of kinds: the schema's
 * `kind` StyleProp (shared/shape-schemas.ts) is defined from it, so the type union,
 * the style-panel options, and this registry can never drift apart.
 */
import type { CreatureVariant } from './types'
import { CREATURE_KINDS, type CreatureKind } from '../../../shared/shape-schemas'
import { fishVariant } from './fish'
import { snakeVariant } from './snake'
import { jellyfishVariant } from './jellyfish'
import { crabVariant } from './crab'
import { antVariant } from './ant'
import { lineFishVariant } from './lineFish'

// CREATURE_KINDS / CreatureKind are the SINGLE source of truth, defined alongside
// the schema StyleProp in shared/ so the type union, the enum, and this registry
// can't drift. Re-export for convenience.
export { CREATURE_KINDS, type CreatureKind }

const VARIANTS: Record<CreatureKind, CreatureVariant> = {
	fish: fishVariant,
	snake: snakeVariant,
	jellyfish: jellyfishVariant,
	crab: crabVariant,
	ant: antVariant,
	lineFish: lineFishVariant,
}

/** Look up a variant by kind, falling back to fish for any unknown value. */
export function getCreatureVariant(kind: string): CreatureVariant {
	return VARIANTS[kind as CreatureKind] ?? VARIANTS.fish
}

/** The UI icon NAME for each kind (referenced by the style-panel picker). */
export function creatureKindIcon(kind: CreatureKind): string {
	return `creature-${kind}`
}

/**
 * Custom UI icon URLs to register on <Tldraw assetUrls={{ icons }}>, so the
 * style-panel creature picker can show a glyph per kind (the SVGs live in
 * public/creature-icons/). Keyed by the same `creature-<kind>` name the picker uses.
 */
export const creatureIconAssetUrls: Record<string, string> = Object.fromEntries(
	CREATURE_KINDS.map((kind) => [`creature-${kind}`, `/creature-icons/${kind}.svg`])
)
