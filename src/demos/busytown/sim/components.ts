/**
 * Busytown — ECS components (Miniplex v2)
 * ---------------------------------------
 * One Entity type with optional fields; systems query by which fields are
 * present (the standard Miniplex archetype pattern). The sim layer imports
 * NOTHING from tldraw — `sprite.shape` is just a string the render layer maps
 * to a tldraw shape util. This preserves the three-layer split:
 *
 *     sim/      <- this file + systems. Plain TS + Miniplex. Source of truth.
 *     render/   <- reads entities, syncs tldraw shapes ~10×/sec.
 *     tldraw    <- canvas + interaction.
 */
import { World } from 'miniplex'
import { CHARACTERS } from '../content/characters'
import type { SceneDef } from '../content/scenes/types'

export type Vec2 = { x: number; y: number }
/** Kinds and affordance tags are OPEN strings: a scene can introduce a brand
 *  new prop kind ('pond') or affordance ('drink') just by registering a
 *  CharacterDef — no union edit, no engine change. */
export type EntityKind = string
export type WhimKind = 'shop' | 'rest' | 'wander' | 'home'
export type AffordanceTag = string
/** The things the gardener grows: flowers, saplings & a tower-climbing vine,
 *  plus the row-garden vegetables. Kept as a small closed union (unlike the
 *  open EntityKind) because gardenerSystem and growPlant special-case it. */
export type PlantVariety = 'flower' | 'sapling' | 'vine' | 'carrot' | 'tomato' | 'cabbage'

export type Entity = {
  // --- identity & rendering (every entity) ---
  kind: EntityKind
  position: Vec2
  sprite?: { shape: string } // render layer maps this to a tldraw shape util

  // --- movement (townsfolk, van) ---
  mover?: { speed: number; target: Vec2 | null; arrived: boolean }

  // --- townsperson behavior ---
  whim?: { kind: WhimKind; target: Vec2 | null }
  // 'until'/'cooldownUntil' hold absolute tick values, computed from TIMING.
  dweller?: { state: 'idle' | 'walk' | 'sit' | 'shop'; until: number; bench: Entity | null }
  interactor?: { state: 'none' | 'greet'; partner: Entity | null; until: number; cooldownUntil: number }

  // --- props (advertise affordances; characters seek matching whims) ---
  affordance?: { tags: AffordanceTag[]; capacity: number; occupants: number }
  stock?: { amount: number; max: number } // stall
  spawner?: { kind: EntityKind } // house

  // --- bird ---
  perch?: { state: 'perch' | 'flee'; until: number }

  // --- vehicle ---
  vehicle?: { state: 'drive' | 'restock'; speed: number; until: number }

  // --- dog (new-behavior character; see sim/systems.ts → dogSystem) ---
  chase?: { speed: number; mode: 'follow' | 'drink'; until: number }

  // --- builder + brick (Builder scene; see sim/systems.ts → builderSystem) ---
  // The builder fetches a pile brick, carries it, and stacks it into a wall.
  // `slot` is the wall index it's currently carrying toward (−1 when not
  // carrying); it CLAIMS that slot so other builders skip it and no two builders
  // stack onto the same spot. `placed` is a running count of bricks this builder
  // laid (a stat; slot assignment is by shared occupancy, not this counter).
  // `state`: 'build' while fetching/carrying, 'rest' once the pile is empty (the
  // builder heads to a hangout spot by the tower base). `rest` is that chosen
  // spot (picked once, so the group settles instead of jittering).
  build?: {
    state: 'build' | 'idle' | 'rest'
    carrying: Entity | null
    placed: number
    speed: number
    slot?: number
    rest?: Vec2
    // Per-builder wobble phase (radians) so builders walking toward the same
    // spot trace slightly different paths instead of overlapping exactly.
    wander?: number
    // Set by builderSystem each tick: true for EXACTLY ONE builder at a time,
    // rotated on a timer so the crew speaks in turns — one bubble up at once,
    // never a chorus. thought() shows a line only while this is set.
    speaking?: boolean
  }
  // --- truck (Builder scene; see sim/systems.ts → truckSystem) ---
  // A delivery truck cycles load → haul → dump → return: it sits at a 'supply'
  // prop (the factory) until the crew is nearly out of pile bricks, then hauls
  // a small load to a random drop point and tips it off as fresh pile bricks.
  // `until` is an absolute tick (the load/dump timers); `load` is the bricks on
  // the bed; `drop` is the chosen dump point while hauling.
  deliver?: {
    state: 'load' | 'haul' | 'dump' | 'return'
    speed: number
    until: number
    load: number
    drop: Vec2 | null
    // Current straight-line heading. The truck commits to ONE axis and holds it
    // until that axis is closed, then turns once — so it drives in long
    // horizontal/vertical legs, never diagonally and never in quick zig-zags.
    // See driveStraight in sim/systems.ts.
    leg?: 'x' | 'y'
  }

  // A brick is a NATIVE tldraw rectangle (render: 'rect'); the builder moves it.
  // `w`/`h` optionally OVERRIDE the kind's default rect size (CharacterDef.rect):
  // the builder squares the last brick of each offset course on placement, and
  // the render bridge resizes the rectangle to match. `slot` records which wall
  // index a PLACED brick occupies, so builders can compute the next free slot.
  brick?: { state: 'pile' | 'carried' | 'placed'; w?: number; h?: number; slot?: number }

  // --- gardener + plant (Builder scene; see sim/systems.ts → gardenerSystem) ---
  // The gardener wanders the site planting things, then tends them. It picks a
  // `variety`, walks (around the tower) to a chosen spot, and drops a plant
  // there. `state` is 'seek' while walking to the next spot, 'idle' between
  // plantings; `until` is the absolute tick an idle pause ends. `wander` is a
  // per-gardener wobble phase (so two gardeners don't trace the same path);
  // `speaking` is set true while it holds a thought bubble.
  garden?: {
    state: 'seek' | 'idle'
    target: Vec2 | null
    variety: PlantVariety | null
    // The plot row the gardener is currently sowing (index into the plot's
    // varieties), remembered between picking a target and arriving so the row's
    // label sign lands at the right height. See gardenerSystem.
    row?: number
    speed: number
    until: number
    wander?: number
    speaking?: boolean
  }
  // A plant grows in place from a seedling to full size. `grow` is 0→1 progress
  // (advanced each tick by `rate`); `base` is the FIXED bottom-centre anchor
  // (ground point, or the tower's foot for a vine) — the sprite's centre is
  // raised as it grows so the base stays put. `w`/`h` are the current render
  // size (px), derived from grow between min/max and read by the render bridge
  // (like a brick's size override). A vine's `maxH` is re-stretched each tick to
  // reach the top of the growing tower, so it climbs as the tower rises.
  plant?: {
    variety: PlantVariety
    grow: number
    rate: number
    base: Vec2
    minW: number
    maxW: number
    minH: number
    maxH: number
    w: number
    h: number
  }
  // --- sign (Builder scene; a garden-row label the gardener stakes) ---
  // A little signpost that names the plant filling one plot row. `label` is the
  // text shown on the board (the render bridge writes it onto the sprite's
  // `label` prop; SpriteShapeUtil draws the board + text). `variety` records
  // which row it belongs to, so gardenerSystem stakes exactly one per row.
  sign?: { label: string; variety?: PlantVariety }
}

/** Resolve where the i-th instance of a roster entry is placed. `atKind` cycles
 *  over the scene's props of that kind (townsfolk at houses, birds at trees);
 *  `points` cycles over explicit points (the van's off-canvas start); otherwise
 *  it lands at the scene centre. Each result is a fresh Vec2. */
function placeInstance(scene: SceneDef, entry: SceneDef['roster'][number], i: number): Vec2 {
  const p = entry.placement
  if (p && 'atKind' in p) {
    const spots = scene.props.filter((pr) => pr.kind === p.atKind)
    if (spots.length) {
      const a = spots[i % spots.length].at
      return { x: a.x, y: a.y }
    }
  }
  if (p && 'points' in p && p.points.length) {
    const a = p.points[i % p.points.length]
    return { x: a.x, y: a.y }
  }
  return { x: scene.bounds.w / 2, y: scene.bounds.h / 2 }
}

/**
 * Build a world from a SceneDef: instantiate its fixed props, then its roster,
 * each via the kind's CharacterDef.spawn(). A scene that needs bespoke setup can
 * export a custom `build()` which takes precedence. Props come first so actors
 * have affordances to seek on their first whim roll. STAGGERED initial timers
 * live inside each character's spawn() so the roster doesn't act in lock-step.
 */
export function buildWorld(scene: SceneDef): World<Entity> {
  if (scene.build) return scene.build()

  const world = new World<Entity>()
  for (const prop of scene.props) {
    const def = CHARACTERS[prop.kind]
    if (def) world.add(def.spawn(prop.at))
  }
  for (const entry of scene.roster) {
    const def = CHARACTERS[entry.kind]
    if (!def) continue
    for (let i = 0; i < entry.count; i++) world.add(def.spawn(placeInstance(scene, entry, i)))
  }
  return world
}

/**
 * Player drops an element onto the canvas -> register it live via the kind's
 * CharacterDef.spawn(). Props join with their affordances (nearby townsfolk
 * notice them on the next whim roll); actors join and start behaving. This is
 * the "comes alive" hook, now a thin delegate over the character registry.
 */
export function dropEntity(world: World<Entity>, kind: EntityKind, at: Vec2): Entity | null {
  const def = CHARACTERS[kind]
  if (!def) return null
  return world.add(def.spawn(at))
}
