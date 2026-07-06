/**
 * Engine — the shared Zod contract for AI-authored game data.
 *
 * This is the SINGLE contract shared by the AI client (game/ai/client.ts), every
 * converter (autoLevel, autoTune, …), and — eventually — the Worker. The rule
 * (see the engine-data-converter skill): AI authors data; the deterministic
 * runtime plays data. So every model an AI can emit is defined here as a Zod
 * schema, and the client validates Claude's JSON against it before the runtime
 * ever sees it. Invalid JSON is fed back to Claude for one retry (client.ts).
 *
 * Versioning: every persisted model carries a `version`, because levels persist
 * in localStorage (persistenceKey="tlArcade-engine-native") and old docs will
 * carry old schemas. The loader Zod-parses and migrates/defaults rather than
 * crashing on an old shape.
 *
 * S1 ships the two models that already have runtime meaning today — LevelLayout
 * (roles the engine reads at start()) and Tunables (the live physics knobs). Later
 * phases add Rig, Clip[], EnemyBehavior, GameDef here, extending the same pattern.
 */
import { z } from 'zod'
import { PHYSICS_DEFAULTS } from '../physics'
import { ROLE_LIST, type Role } from '../roles'

/**
 * The role enum, derived from ROLE_LIST so it can never drift from the registry.
 * Runtime-validates against the real role names; its inferred type is the `Role`
 * union (not a bare `string`), so a parsed placement's `role` feeds straight into
 * `shapeForRole`.
 */
export const RoleSchema = z.enum(ROLE_LIST as [Role, ...Role[]])
export type RoleName = z.infer<typeof RoleSchema>

// ---------------------------------------------------------------------------
// LevelLayout — a list of placed roles. Mirrors game/level.ts `Placement`, plus
// an optional `meta` bag for future per-entity behavior params (§G2/G3). The
// runtime already knows how to create shapes from role + position (level.ts).
// ---------------------------------------------------------------------------

export const PlacementSchema = z.object({
  role: RoleSchema,
  x: z.number(),
  y: z.number(),
  w: z.number().positive().optional(),
  h: z.number().positive().optional(),
  /** Reserved for future behavior params written to the shape's meta. */
  meta: z.record(z.string(), z.unknown()).optional(),
})
export type Placement = z.infer<typeof PlacementSchema>

export const LevelLayoutSchema = z.object({
  version: z.literal(1),
  placements: z.array(PlacementSchema),
})
export type LevelLayout = z.infer<typeof LevelLayoutSchema>

// ---------------------------------------------------------------------------
// Tunables — the physics feel knobs. Keys and ranges are the single source of
// truth in physics.ts; here we build a schema from PHYSICS_DEFAULTS so the two
// can't drift. Every key is an optional number: the AI (or a partial hand-edit)
// may emit only the knobs it wants to change, merged over the current tunables.
// ---------------------------------------------------------------------------

const tunableKeyShape = Object.fromEntries(
  Object.keys(PHYSICS_DEFAULTS).map((k) => [k, z.number().finite().optional()]),
) as Record<keyof typeof PHYSICS_DEFAULTS, z.ZodOptional<z.ZodNumber>>

export const TunablesPatchSchema = z.object(tunableKeyShape).strict()
export type TunablesPatch = z.infer<typeof TunablesPatchSchema>

// ---------------------------------------------------------------------------
// Registry — name → schema, so the client can validate by a target string and
// the ✨ Generate door can pick a schema from the chosen target.
// ---------------------------------------------------------------------------

export const SCHEMAS = {
  level: LevelLayoutSchema,
  tunables: TunablesPatchSchema,
} as const

export type ConverterTarget = keyof typeof SCHEMAS
