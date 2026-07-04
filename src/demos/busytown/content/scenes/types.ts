/**
 * SceneDef — a buildable, swappable world.
 * ----------------------------------------
 * A scene is pure data the engine consumes: how big the world is (bounds, which
 * replaces the old CANVAS global), what fixed scenery it has (props, was
 * LAYOUT), who starts in it (roster, was START), which behaviors run (pipeline,
 * was the fixed runSystems order), and what the player can drop (palette).
 *
 * buildWorld(scene) in sim/components.ts instantiates props then roster via each
 * kind's CharacterDef.spawn(). A scene the declarative form can't express may
 * supply a custom `build()` override.
 */
import type { Vec2 } from '../../sim/components'
import type { SystemFn } from '../../sim/systems'
import type { World } from 'miniplex'
import type { Entity } from '../../sim/components'

/** A fixed piece of scenery placed at an authored point. */
export type PropSpec = { kind: string; at: Vec2 }

/** Where each instance of a roster entry is placed. */
export type Placement =
  | { atKind: string } // cycle over the scene's props of this kind
  | { points: Vec2[] } // cycle over explicit points (e.g. the van's start)

/** A group of actors to spawn at scene start. */
export type RosterEntry = { kind: string; count: number; placement?: Placement }

export type SceneDef = {
  id: string
  /** Dropdown label. */
  name: string
  /** Page-space extent; becomes the systems' SimContext.bounds. */
  bounds: { w: number; h: number }
  /** Fixed scenery, instantiated first so actors have affordances to seek. */
  props: PropSpec[]
  /** Actors spawned at start (townsfolk, birds, van, dog…). */
  roster: RosterEntry[]
  /** Which systems run, in order (Busytown's is the seven originals). */
  pipeline: SystemFn[]
  /** Kinds the player can drop from the HUD in this scene. */
  palette: string[]
  /** Optional escape hatch for a scene the declarative form can't express. */
  build?: () => World<Entity>
}
