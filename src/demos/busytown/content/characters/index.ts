/**
 * CHARACTERS registry — kind → CharacterDef.
 * ------------------------------------------
 * The single source of truth every layer derives from:
 *   render/doodles.ts  → KIND_SIZE + DOODLE_RENDER (art)
 *   render/bridge.ts   → per-kind colour + thought bubble
 *   sim/components.ts  → buildWorld / dropEntity spawn presets
 *   App / HUD          → the droppable palette (via each scene's palette list)
 *
 * Registering a character = adding its CharacterDef to one of the arrays below.
 * All kinds across all scenes are registered here (scenes pick which to use), so
 * a shape of any kind can always be rendered and dropped.
 */
import type { CharacterDef } from './types'
import { BUSYTOWN_CHARACTERS } from './busytown'
import { EXTRA_CHARACTERS } from './extras'
import { BUILDER_CHARACTERS } from './builder'
import { GARDENER_CHARACTERS } from './gardener'
import { FAIRY_CHARACTERS } from './fairy'

const ALL: CharacterDef[] = [
  ...BUSYTOWN_CHARACTERS,
  ...EXTRA_CHARACTERS,
  ...BUILDER_CHARACTERS,
  ...GARDENER_CHARACTERS,
  ...FAIRY_CHARACTERS,
]

export const CHARACTERS: Record<string, CharacterDef> = Object.fromEntries(
  ALL.map((c) => [c.kind, c]),
)

export type { CharacterDef } from './types'
