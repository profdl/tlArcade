/**
 * SCENES registry — id → SceneDef.
 * --------------------------------
 * The dropdown in the HUD lists these; App builds the active one by id and
 * rebuilds on switch. Busytown is first (the default + behavior anchor).
 */
import type { SceneDef } from './types'
import { busytown } from './busytown'
import { pondside } from './pondside'
import { builder } from './builder'

export const SCENE_LIST: SceneDef[] = [busytown, pondside, builder]

export const SCENES: Record<string, SceneDef> = Object.fromEntries(
  SCENE_LIST.map((s) => [s.id, s]),
)

export const DEFAULT_SCENE_ID = builder.id

export type { SceneDef } from './types'
