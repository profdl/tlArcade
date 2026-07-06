/**
 * Engine — the element registry (native-first, color-coded).
 *
 * There is NO custom shape. Every game element is a plain native tldraw `geo`
 * shape, and its ROLE is read from its COLOR at play time (see game/engine.ts →
 * `roleOf`): blue = player, grey = wall, yellow = token, red = hazard, green =
 * goal. A geo shape in any other color — or any draw / line stroke — is solid
 * terrain, which is why you can just draw a level with the pencil.
 *
 * Because color *is* the behavior, each role's color must be unique (see
 * COLOR_TO_ROLE). This table drives what the left tray drops (`shapeForRole`)
 * and the three behavior axes the engine reads — motion, collision, effect.
 */
import type { TLDefaultColorStyle, TLGeoShape } from 'tldraw'

export type Role = 'player' | 'wall' | 'token' | 'hazard' | 'goal'

/** How an entity moves during play. */
export type Motion = 'static' | 'platformer'
/** How it interacts: `solid` blocks; `trigger` fires on overlap. */
export type Collision = 'solid' | 'trigger'
/** What happens when the player touches a `trigger`. */
export type Effect = 'none' | 'collect' | 'kill' | 'win'

type GeoKind = TLGeoShape['props']['geo']

export interface RoleDef {
  /** Display name (tray only — nothing is written on the canvas). */
  label: string
  /** Tray glyph. */
  emoji: string
  geo: GeoKind
  /** The role's color — MUST be unique across roles (color is the behavior). */
  color: TLDefaultColorStyle
  size: { w: number; h: number }
  motion: Motion
  collision: Collision
  effect: Effect
}

export const ROLES: Record<Role, RoleDef> = {
  player: {
    label: 'Player',
    emoji: '🙂',
    geo: 'ellipse', // an oval, a bit taller than wide (see size)
    color: 'blue',
    size: { w: 40, h: 48 },
    motion: 'platformer',
    collision: 'solid',
    effect: 'none',
  },
  wall: {
    label: 'Wall',
    emoji: '🧱',
    geo: 'rectangle',
    color: 'grey',
    size: { w: 160, h: 28 },
    motion: 'static',
    collision: 'solid',
    effect: 'none',
  },
  token: {
    label: 'Token',
    emoji: '⭐',
    geo: 'star',
    color: 'yellow',
    size: { w: 32, h: 32 },
    motion: 'static',
    collision: 'trigger',
    effect: 'collect',
  },
  hazard: {
    label: 'Hazard',
    emoji: '🔥',
    geo: 'triangle',
    color: 'red',
    size: { w: 80, h: 28 },
    motion: 'static',
    collision: 'trigger',
    effect: 'kill',
  },
  goal: {
    label: 'Goal',
    emoji: '🏁',
    geo: 'rectangle',
    color: 'green',
    size: { w: 48, h: 72 },
    motion: 'static',
    collision: 'trigger',
    effect: 'win',
  },
}

/** Tray order. */
export const ROLE_LIST: Role[] = ['player', 'wall', 'token', 'hazard', 'goal']

/** color → role. Built from ROLES; relies on each role's color being unique. */
const COLOR_TO_ROLE = new Map<TLDefaultColorStyle, Role>(
  ROLE_LIST.map((role) => [ROLES[role].color, role]),
)

/**
 * Resolve a geo shape's color to a role. Returns null for any color that isn't
 * a role color (the caller treats such a geo shape as solid terrain).
 */
export function roleForColor(color: TLDefaultColorStyle): Role | null {
  return COLOR_TO_ROLE.get(color) ?? null
}

/**
 * The native geo shape the tray drops for a role — a coloured, unlabelled geo
 * shape. Solids get a solid fill; triggers a translucent (`semi`) fill so
 * "blocks me" vs "fires on touch" reads at a glance. Caller sets x / y.
 */
export function shapeForRole(role: Role) {
  const d = ROLES[role]
  return {
    type: 'geo' as const,
    props: {
      geo: d.geo,
      w: d.size.w,
      h: d.size.h,
      color: d.color,
      fill: (d.collision === 'solid' ? 'solid' : 'semi') as 'solid' | 'semi',
      dash: 'solid' as const,
    },
  }
}
