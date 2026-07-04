/**
 * CharacterDef — one self-contained bundle per entity KIND.
 * ---------------------------------------------------------
 * A kind used to be smeared across five records (DOODLES, KIND_SIZE,
 * KIND_COLOR, dropEntity's preset, thoughtFor's per-kind branch) plus the HUD
 * palette. A CharacterDef gathers all of that in one place, so adding a
 * character is "write one file, register it" instead of editing 5+.
 *
 * The render layer (doodles.ts, bridge.ts) and the sim layer (components.ts)
 * both DERIVE from the CHARACTERS registry — see content/characters/index.ts.
 * Props (bench, stall, pond…) are CharacterDefs too; they just carry an
 * affordance in their spawn() and no behavior.
 */
import type { ReactNode } from 'react'
import type { TLDefaultColorStyle } from 'tldraw'
import type { Stroke } from '../../render/freehand'
import type { Entity, Vec2 } from '../../sim/components'

/** One raw SVG path, already positioned/scaled into a skin's `svg` part group.
 *  Fill colour is literal (baked at authoring time) rather than the tldraw
 *  `color` style — the imported artwork is already multi-tone. */
export type SvgPathPart = { d: string; fill: string; stroke?: string; strokeWidth?: number }
/** One group of an 'svg'-rendered skin: an affine transform into the shared
 *  0–100 art box plus the paths drawn inside it — mirrors the
 *  `<g transform><path/></g>` shape an SVG export from tldraw's own Draw tool
 *  produces, so an artwork like that can be dropped in with only arithmetic on
 *  its transforms (no path-geometry parsing needed). The transform is either
 *  the translate+uniform-scale shorthand (`tx`/`ty`/`scale`) for an
 *  axis-aligned group, or a full 6-value `matrix` [a,b,c,d,e,f] when the source
 *  group rotates/skews (e.g. a tilted hard hat or splayed legs). `matrix` wins
 *  when both are present. */
export type SvgArtPart = {
  tx?: number
  ty?: number
  scale?: number
  matrix?: [number, number, number, number, number, number]
  paths: SvgPathPart[]
}

/** One alternate appearance for a kind — see CharacterDef.skins. Behavior is
 *  never part of a skin (kind/spawn/palette/thought stay fixed); only how the
 *  sprite is drawn does. */
export type Skin = {
  /** Shown in the HUD's skin-switcher control. */
  label: string
  /** 'sprite' (default): hand-drawn doodle strokes, needs `art`. 'svg': literal
   *  imported artwork (needs `svg`), rendered as-is with no perfect-freehand
   *  pass — for art that's already a finished filled drawing rather than a set
   *  of stroke centre-lines. */
  render?: 'sprite' | 'svg'
  art?: Stroke[]
  svg?: SvgArtPart[]
  /** Alternate 'svg' parts drawn while the entity is carrying something (e.g. a
   *  builder hauling a brick) — a different face/arm pose. MUST keep the same
   *  part order/indices as `svg` for any part the walk rig references (the legs),
   *  since the rig is derived from `svg` and reused as-is; only swap the parts
   *  that change (mouth, arms) and append new ones (eyebrows). The render layer
   *  falls back to `svg` when a sprite isn't carrying or a skin omits this. */
  svgCarry?: SvgArtPart[]
  /** Where the carried object rides relative to the carrier's centre, in the
   *  0–100 art box (so it scales with `size`). Omit ⇒ the sim's default carry
   *  position is used unchanged (e.g. floating overhead). Lets one skin hug the
   *  load low against the body while others carry it aloft. */
  carryOffset?: Vec2
  /** Optional walk rig — see CharacterDef.walk. Most alt skins are static
   *  (omit this) and just render their art; a rig with `limbs: []` still buys
   *  the travel-direction facing-flip with no per-limb animation. */
  walk?: { limbs: number[][]; swing?: number; faces?: 'left' | 'right' }
  /** On-canvas sprite size in page px. Defaults to the CharacterDef's `size`. */
  size?: number
}

export type CharacterDef = {
  /** Entity kind string. Also the `sprite.shape` key and registry key. */
  kind: string
  /** How the render bridge draws this kind:
   *  - 'sprite' (default): the hand-drawn doodle (needs `art`).
   *  - 'rect': a NATIVE tldraw rectangle (geo shape, needs `rect`). The built
   *    result is real, editable tldraw content — e.g. the builder's bricks. */
  render?: 'sprite' | 'rect'
  /** Hand-drawn doodle strokes (0–100 box). Was DOODLES[kind]. Omit for 'rect'. */
  art?: Stroke[]
  /** Native rectangle dimensions in page px, when render === 'rect'. */
  rect?: { w: number; h: number }
  /** On-canvas sprite size in page px. Was KIND_SIZE[kind]. */
  size: number
  /** Starting tldraw colour (the player can restyle). Was KIND_COLOR[kind]. */
  color: TLDefaultColorStyle
  /** Build a fresh entity at `at`. Was the dropEntity preset + buildWorld inline
   *  construction, unified into one canonical constructor. */
  spawn: (at: Vec2) => Entity
  /** Present ⇒ this kind is droppable from the HUD (when a scene lists it in
   *  its palette). label + icon drive the palette button. */
  palette?: { label: string; icon: ReactNode }
  /** Thought-bubble line for the current state. Was thoughtFor's per-kind
   *  branch. Absent / '' ⇒ no bubble. */
  thought?: (e: Entity) => string
  /** Optional walk rig: which `art` strokes are legs that swing while the sprite
   *  is moving. `limbs` groups stroke indices into limbs (e.g. one leg + its
   *  foot); the render layer swings them in alternating phase, each rotating
   *  about its hip (the topmost authored point of its strokes). `swing` is the
   *  peak angle in degrees (default 18). `faces` is the horizontal direction the
   *  art is drawn pointing (default 'left'); the sprite mirrors horizontally so
   *  it always faces its travel direction. Kinds without a rig never animate. */
  walk?: { limbs: number[][]; swing?: number; faces?: 'left' | 'right' }
  /** Alternate appearances for this kind, switchable at runtime (HUD skin
   *  control, see render/skins.ts) without touching behavior — every skin
   *  spawns the exact same entity/components. Present ⇒ this CharacterDef's
   *  own `art`/`render`/`walk`/`size` are ignored; author the base look as
   *  `skins[defaultSkin]` instead. */
  skins?: Record<string, Skin>
  /** Which `skins` entry new drops (and freshly-built scenes) start on. */
  defaultSkin?: string
}
