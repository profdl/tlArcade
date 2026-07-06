/**
 * Engine — the element registry.
 *
 * The whole demo is built on ONE custom tldraw shape (`gameEntity`, see
 * render/EntityShapeUtil.tsx). What a given entity *is* — player, wall, token,
 * hazard, goal — is a single `role` prop, and everything else (how it looks, how
 * it moves, how it collides, what happens on contact) is DERIVED from this table.
 *
 * That's the "fewest elements" bet: adding a new game element is a new row here
 * plus (if it introduces a genuinely new behavior) a branch in game/engine.ts —
 * not a new shape type. The tray in App.tsx is generated straight from ROLE_LIST.
 */

/** The droppable elements. This union is the demo's whole vocabulary. */
export type Role = 'player' | 'wall' | 'token' | 'hazard' | 'goal'

/** How an entity moves each tick during play. */
export type Motion = 'static' | 'platformer'
/** How an entity interacts with others. `solid` blocks; `trigger` fires on overlap. */
export type Collision = 'solid' | 'trigger'
/** What happens when the player touches a `trigger` entity. */
export type Effect = 'none' | 'collect' | 'kill' | 'win'

export interface RoleDef {
  label: string
  /** Tray icon + on-canvas glyph. */
  emoji: string
  /** Role tint (a tldraw light-theme solid hex). */
  color: string
  motion: Motion
  collision: Collision
  effect: Effect
  /** Default footprint when dropped from the tray. */
  size: { w: number; h: number }
}

export const ROLES: Record<Role, RoleDef> = {
  player: {
    label: 'Player',
    emoji: '🙂',
    color: '#4465e9',
    motion: 'platformer',
    collision: 'solid',
    effect: 'none',
    size: { w: 40, h: 48 },
  },
  wall: {
    label: 'Wall',
    emoji: '🧱',
    color: '#8a94a6',
    motion: 'static',
    collision: 'solid',
    effect: 'none',
    size: { w: 160, h: 28 },
  },
  token: {
    label: 'Token',
    emoji: '⭐',
    color: '#f1ac4b',
    motion: 'static',
    collision: 'trigger',
    effect: 'collect',
    size: { w: 32, h: 32 },
  },
  hazard: {
    label: 'Hazard',
    emoji: '🔥',
    color: '#e03131',
    motion: 'static',
    collision: 'trigger',
    effect: 'kill',
    size: { w: 80, h: 28 },
  },
  goal: {
    label: 'Goal',
    emoji: '🏁',
    color: '#099268',
    motion: 'static',
    collision: 'trigger',
    effect: 'win',
    size: { w: 48, h: 72 },
  },
}

/** Tray order (also the default z-order of authoring). */
export const ROLE_LIST: Role[] = ['player', 'wall', 'token', 'hazard', 'goal']

/** Narrowing helper — a plain shape `role` string may be anything on disk. */
export function isRole(x: string): x is Role {
  return x in ROLES
}
