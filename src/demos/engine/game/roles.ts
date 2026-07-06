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

export type Role =
  | 'player'
  | 'wall'
  | 'token'
  | 'hazard'
  | 'goal'
  | 'enemy'
  | 'spring'
  | 'checkpoint'
  | 'oneway'
  // --- Tier 1 recreation primitives (PLAN §4.7) ---
  | 'block' // hittable ?-block: bonk from below → ejects a token / breaks (T1b)
  | 'portal' // paired warp: teleports the player to its channel partner (T1c)
  | 'platform' // moving / blink / crumble platform (T1e/T1f)

/**
 * How an entity moves during play.
 * - `static` — never moves (walls, tokens, hazards, goal).
 * - `platformer` — the player: input + jump/gravity feel pipeline.
 * - `patrol` — a mover that walks back and forth, turning at ledges/walls (enemy).
 * - `sine` — oscillates on a fixed track (no gravity/collision), driven by the sim
 *   clock. A Piranha-plant rise/fall (T1d).
 * - `mover` — travels a straight A↔B path (ping-pong) on the sim clock; the first
 *   SOLID that moves, so its outline is re-read into the solids set each frame
 *   (T1e). Blink/crumble platforms are movers whose presence is gated (T1f).
 */
export type Motion = 'static' | 'platformer' | 'patrol' | 'sine' | 'mover'
/**
 * How it interacts.
 * - `solid` — blocks from every side.
 * - `trigger` — fires an effect on overlap, never blocks.
 * - `oneWay` — a platform that blocks only from ABOVE: you land on it when
 *   falling onto its top, but jump/pass up through it from below (see
 *   `entities/props.ts` → `oneWayBlocks`).
 */
export type Collision = 'solid' | 'trigger' | 'oneWay'
/**
 * What happens when the player overlaps this entity.
 * - `kill` — respawn the player (hazard; an enemy from the side).
 * - `stomp` — the enemy is defeated when the player lands on it from ABOVE, and
 *   the player bounces; touching it from the side is a `kill`. (Enemy only.)
 * - `bounce` — a spring/bounce pad: launch the player UP on overlap (see
 *   `entities/props.ts` → `springLaunchVy`).
 * - `checkpoint` — the first time the player overlaps it, the respawn point
 *   moves here (see `entities/props.ts` → `shouldActivateCheckpoint`).
 */
export type Effect =
  | 'none'
  | 'collect'
  | 'kill'
  | 'win'
  | 'stomp'
  | 'bounce'
  | 'checkpoint'
  // --- Tier 1 (PLAN §4.7) ---
  | 'spawn' // hittable block: bonk from below ejects a token / breaks (T1b)
  | 'teleport' // portal: move the player to its channel partner (T1c)
  | 'blink' // platform: solid on/off on a phase clock (T1f)
  | 'crumble' // platform: drops out a beat after the player stands on it (T1f)

/**
 * The grid unit. Levels are built on a square tile grid like a classic
 * side-scroller: the player is exactly 1 tile wide × 2 tiles tall (60×120), and
 * every other element's default size is a whole/half-tile multiple of this (see
 * ROLES below). Walls default to a 1×1 square you stretch to whole-tile
 * multiples to build floors and platforms. Author levels in tile units via
 * `tiles()` / `tilesW/tilesH` and keep positions on the grid.
 */
export const TILE = 60

/** Tile units → page px. `tiles(2)` → 120. */
export const tiles = (n: number) => n * TILE

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
    geo: 'ellipse', // legacy fallback shape; the real player is the drawn builder
    color: 'blue',
    // The player is drawn as the "builder" figure (game/builder.ts), sized to
    // exactly 1 tile wide × 2 tiles tall — the grid's base unit. builder.ts scales
    // the art to BUILDER_HEIGHT (= 2 tiles); this footprint mirrors it.
    size: { w: tiles(1), h: tiles(2) }, // 60 × 120
    motion: 'platformer',
    collision: 'solid',
    effect: 'none',
  },
  wall: {
    label: 'Wall',
    emoji: '🧱',
    geo: 'rectangle',
    color: 'grey',
    // A 1×1 grid tile. Stretch it to whole-tile multiples to build floors and
    // platforms (a floor is one wide wall, not many stacked squares).
    size: { w: tiles(1), h: tiles(1) }, // 60 × 60
    motion: 'static',
    collision: 'solid',
    effect: 'none',
  },
  token: {
    label: 'Token',
    emoji: '⭐',
    geo: 'star',
    color: 'yellow',
    size: { w: tiles(0.5), h: tiles(0.5) }, // 30 × 30 — half a tile
    motion: 'static',
    collision: 'trigger',
    effect: 'collect',
  },
  hazard: {
    label: 'Hazard',
    emoji: '🔥',
    geo: 'triangle',
    color: 'red',
    size: { w: tiles(1), h: tiles(0.5) }, // 60 × 30 — one tile wide, half tall
    motion: 'static',
    collision: 'trigger',
    effect: 'kill',
  },
  goal: {
    label: 'Goal',
    emoji: '🏁',
    geo: 'rectangle',
    color: 'green',
    size: { w: tiles(1), h: tiles(2) }, // 60 × 120 — a tall flag, player-height
    motion: 'static',
    collision: 'trigger',
    effect: 'win',
  },
  enemy: {
    label: 'Enemy',
    emoji: '👾',
    geo: 'rectangle',
    color: 'violet',
    size: { w: tiles(1), h: tiles(1) }, // 60 × 60 — a one-tile mover
    // A patroller: walks back and forth, turning at walls/ledges. Stompable from
    // above (the player bounces), lethal from the side. It's a moving entity, so
    // the player passes through it — contact fires the stomp/kill decision rather
    // than blocking — hence collision 'trigger'.
    motion: 'patrol',
    collision: 'trigger',
    effect: 'stomp',
  },
  spring: {
    label: 'Spring',
    emoji: '🕹️',
    geo: 'rectangle',
    color: 'orange',
    // A wide, short pad: overlap it and the player is launched straight up.
    size: { w: tiles(1), h: tiles(0.25) }, // 60 × 15 — one tile wide, quarter tall
    motion: 'static',
    collision: 'trigger',
    effect: 'bounce',
  },
  checkpoint: {
    label: 'Checkpoint',
    emoji: '🚩',
    geo: 'rectangle',
    color: 'light-blue',
    // A tall, thin flag-ish marker: touch it once to move the respawn point here.
    size: { w: tiles(0.5), h: tiles(1.5) }, // 30 × 90 — half-tile wide, 1.5 tall
    motion: 'static',
    collision: 'trigger',
    effect: 'checkpoint',
  },
  oneway: {
    label: 'One-Way',
    emoji: '➖',
    geo: 'rectangle',
    color: 'light-green',
    // A thin platform you can jump UP through but land ON from above.
    size: { w: tiles(2), h: tiles(0.25) }, // 120 × 15 — two tiles wide, quarter tall
    motion: 'static',
    collision: 'oneWay',
    effect: 'none',
  },
  // --- Tier 1 recreation primitives (PLAN §4.7) ---
  block: {
    label: 'Block',
    emoji: '❓',
    geo: 'rectangle',
    color: 'light-red',
    // A solid 1×1 block you bonk from BELOW to eject a token (or just break). Solid
    // from every side like a wall; the head-bonk fires its `spawn` effect (T1b).
    size: { w: tiles(1), h: tiles(1) }, // 60 × 60
    motion: 'static',
    collision: 'solid',
    effect: 'spawn',
  },
  portal: {
    label: 'Portal',
    emoji: '🌀',
    geo: 'rectangle',
    color: 'light-violet',
    // A warp pipe/door: overlap it and teleport to its channel partner (T1c). A
    // trigger (never blocks). Pairs are linked by meta.channel; the runtime picks
    // the OTHER portal with the same channel.
    size: { w: tiles(1), h: tiles(2) }, // 60 × 120 — a doorway, player-height
    motion: 'static',
    collision: 'trigger',
    effect: 'teleport',
  },
  platform: {
    label: 'Platform',
    emoji: '🟫',
    geo: 'rectangle',
    // GREY, like a wall — but rendered with a DASHED outline (see shapeForRole) so
    // it reads as "a moving/interactive surface, distinct from a solid wall". Grey
    // is the wall's color, so a platform is disambiguated by a `meta.role:
    // 'platform'` MARKER (which wins over color in engine.ts → roleOf), NOT by a
    // unique color — this is why shapeForRole stamps that marker.
    color: 'grey',
    // A moving platform (T1e): a SOLID that travels an A↔B path (meta.path), so its
    // outline is re-read into the solids set each frame. Blink/crumble variants
    // (T1f) set effect 'blink'/'crumble' + their meta to gate when it's present.
    size: { w: tiles(2), h: tiles(0.5) }, // 120 × 30 — two tiles wide, half tall
    motion: 'mover',
    collision: 'solid',
    effect: 'none',
  },
}

/** Tray order. */
export const ROLE_LIST: Role[] = [
  'player',
  'wall',
  'token',
  'hazard',
  'goal',
  'enemy',
  'spring',
  'checkpoint',
  'oneway',
  'block',
  'portal',
  'platform',
]

/**
 * Tray categories — the roles grouped by kind so the tray reads as a few labeled
 * sections instead of a 12-tall wall of icons (PLAN §7.5: "do not grow a flat wall
 * of icons — group it"). Order here is the tray's section order.
 */
export interface RoleCategory {
  label: string
  roles: Role[]
}

export const ROLE_CATEGORIES: RoleCategory[] = [
  { label: 'Start', roles: ['player', 'goal'] },
  { label: 'Terrain', roles: ['wall', 'oneway', 'platform'] },
  { label: 'Hazards', roles: ['hazard', 'enemy'] },
  { label: 'Items', roles: ['token', 'block'] },
  { label: 'Props', roles: ['spring', 'checkpoint', 'portal'] },
]

/**
 * color → role. Built from ROLES; relies on each role's color being unique — with
 * ONE exception: `platform` reuses grey (the wall's color) and is identified ONLY by
 * a `meta.role` marker (see engine.ts → roleOf), never by color. It is EXCLUDED here
 * so grey still resolves to `wall` — otherwise a plain grey wall (or any saved grey
 * terrain) would be misread as a moving platform.
 */
const COLOR_TO_ROLE = new Map<TLDefaultColorStyle, Role>(
  ROLE_LIST.filter((role) => role !== 'platform').map((role) => [ROLES[role].color, role]),
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
 *
 * The `platform` role is special: it is GREY like a wall (the color budget is
 * exhausted), rendered with a DASHED outline so it reads as "a moving surface,
 * distinct from a solid wall", and stamped with a `meta.role: 'platform'` MARKER so
 * the runtime tells it apart from a grey wall (roleOf checks the marker before
 * color). Returns a `meta` for that marker; the caller spreads it onto createShape.
 */
export function shapeForRole(role: Role) {
  const d = ROLES[role]
  const isPlatform = role === 'platform'
  return {
    type: 'geo' as const,
    props: {
      geo: d.geo,
      w: d.size.w,
      h: d.size.h,
      color: d.color,
      fill: (d.collision === 'solid' ? 'solid' : 'semi') as 'solid' | 'semi',
      // A dashed outline marks a platform as a distinct-from-wall surface.
      dash: (isPlatform ? 'dashed' : 'solid') as 'solid' | 'dashed',
    },
    // Grey would otherwise read as a wall — the marker makes it a platform.
    ...(isPlatform ? { meta: { role: 'platform' } } : {}),
  }
}
