/**
 * Busytown — sprite doodle PRECOMPILE (render side).
 * --------------------------------------------------
 * The hand-drawn art now lives with each character (content/characters/* →
 * CharacterDef.art / .size, or CharacterDef.skins for a kind with more than
 * one selectable appearance — see content/characters/types.ts → Skin). This
 * module DERIVES the render tables from the CHARACTERS registry: SKIN_SIZE
 * (on-canvas px per kind × skin), DOODLE_RENDER (per kind × skin × size-style,
 * the precompiled Dash:Draw filled outline + centre-line, for 'sprite'-render
 * skins) and SVG_RENDER (per kind × skin, literal imported artwork, for
 * 'svg'-render skins). Colour is NOT baked into doodle strokes — it comes from
 * the shape's tldraw `color` style, applied uniformly at render — and each
 * weight renders at its ABSOLUTE page width regardless of sprite size. 'svg'
 * skins keep their own literal fill colours instead (see Skin.render).
 *
 * A kind with no `skins` is modelled as having exactly one skin, keyed ''
 * (DEFAULT_SKIN[kind] === ''), built from its own art/walk/size — so every
 * lookup below has one shape regardless of whether a kind opts into skins.
 *
 * We precompute ONCE per (kind × skin × size-style) so changing color / dash /
 * fill at render, or switching skins, is just swapping attributes/lookups,
 * never re-running perfect-freehand.
 */
import { strokePath, centerlinePath, type Weight } from './freehand'
import { CHARACTERS, type CharacterDef } from '../content/characters'
import type { Skin, SvgArtPart } from '../content/characters/types'

/** tldraw default Draw stroke weights, in page px. */
const DRAW_WEIGHT: Record<Weight, number> = { s: 2, m: 3.5, l: 5, xl: 10 }

/** The shape's tldraw `size` style scales the whole sprite's pen weight. */
type SizeStyle = 's' | 'm' | 'l' | 'xl'
const SIZE_MULT: Record<SizeStyle, number> = { s: 0.6, m: 1, l: 1.5, xl: 2.6 }
const SIZES: SizeStyle[] = ['s', 'm', 'l', 'xl']

/** The default skin id for every kind ('' for a kind with no `skins`). */
export const DEFAULT_SKIN: Record<string, string> = Object.fromEntries(
  Object.values(CHARACTERS).map((c) => [c.kind, c.skins ? (c.defaultSkin ?? Object.keys(c.skins)[0]) : '']),
)

/** Ordered skin ids + labels for kinds that declare more than one — the HUD
 *  skin-switcher control derives its options from this. Kinds without `skins`
 *  are absent (nothing to switch). */
export const SKIN_OPTIONS: Record<string, { id: string; label: string }[]> = Object.fromEntries(
  Object.values(CHARACTERS)
    .filter((c) => c.skins && Object.keys(c.skins).length > 1)
    .map((c) => [c.kind, Object.entries(c.skins!).map(([id, sk]) => ({ id, label: sk.label }))]),
)

/** Normalizes a CharacterDef into its skin map, whether or not it opted into
 *  `skins` — a kind with none behaves as a single '' skin built from its own
 *  art/walk/size. Skips 'rect'-render kinds (e.g. brick), which never reach
 *  the doodle/svg pipelines. */
function skinsOf(c: CharacterDef): Record<string, Skin> {
  if (c.render === 'rect') return {}
  if (c.skins) return c.skins
  return { '': { label: c.kind, art: c.art, walk: c.walk, size: c.size } }
}

/** On-canvas size of each sprite (page px), per kind × skin. Single source of
 *  truth is each Skin's `size` (falling back to the CharacterDef's own size);
 *  the render bridge imports this. */
export const SKIN_SIZE: Record<string, Record<string, number>> = Object.fromEntries(
  Object.values(CHARACTERS).map((c) => [
    c.kind,
    Object.fromEntries(Object.entries(skinsOf(c)).map(([id, sk]) => [id, sk.size ?? c.size])),
  ]),
)

/** Default-skin size per kind — a convenience fallback for call sites that
 *  don't (yet) know which skin is active. */
export const KIND_SIZE: Record<string, number> = Object.fromEntries(
  Object.values(CHARACTERS).map((c) => [c.kind, SKIN_SIZE[c.kind]?.[DEFAULT_SKIN[c.kind]] ?? c.size]),
)

/** One stroke ready to render: the Dash:Draw filled outline, the centre-line
 *  path, the stroke width (in the 0–100 box), whether it encloses area, and
 *  whether it sits on an opaque white backing (see Stroke.bg). */
export type RenderStroke = { draw: string; line: string; sw: number; closed: boolean; bg: boolean }

/** Precomputed render data for every 'sprite'-render skin: kind → skin →
 *  size-style → strokes. */
export const DOODLE_RENDER: Record<string, Record<string, Record<SizeStyle, RenderStroke[]>>> =
  Object.fromEntries(
    Object.values(CHARACTERS).map((c) => [
      c.kind,
      Object.fromEntries(
        Object.entries(skinsOf(c))
          .filter(([, sk]) => (sk.render ?? 'sprite') === 'sprite' && sk.art && sk.art.length)
          .map(([id, sk]) => {
            const box = sk.size ?? c.size ?? 100
            const bySize = Object.fromEntries(
              SIZES.map((sz) => {
                const strokes = sk.art!.map((st) => {
                  // page width = DRAW_WEIGHT × size-multiplier; back into the 0–100 box.
                  const sw = (DRAW_WEIGHT[st.w] * SIZE_MULT[sz] * 100) / box
                  return {
                    draw: strokePath(st.pts, sw),
                    line: centerlinePath(st.pts, !!st.closed),
                    sw,
                    closed: !!st.closed,
                    bg: !!st.bg,
                  }
                })
                return [sz, strokes]
              }),
            ) as Record<SizeStyle, RenderStroke[]>
            return [id, bySize]
          }),
      ),
    ]),
  )

/** Precomputed render data for every 'svg'-render skin: kind → skin → parts,
 *  passed through untouched (already-finished artwork, not freehand strokes —
 *  see Skin.render / SvgArtPart). */
export const SVG_RENDER: Record<string, Record<string, SvgArtPart[]>> = Object.fromEntries(
  Object.values(CHARACTERS).map((c) => [
    c.kind,
    Object.fromEntries(
      Object.entries(skinsOf(c))
        .filter(([, sk]) => sk.render === 'svg' && sk.svg && sk.svg.length)
        .map(([id, sk]) => [id, sk.svg!]),
    ),
  ]),
)

/** The carrying-pose variant of SVG_RENDER: kind → skin → parts, present only
 *  for skins that declare `svgCarry`. The render layer swaps to these while the
 *  entity is carrying (SpriteShape.carrying), keeping the SAME walk rig — so the
 *  legs (whose indices the rig references) must stay put across the two arrays. */
export const SVG_RENDER_CARRY: Record<string, Record<string, SvgArtPart[]>> = Object.fromEntries(
  Object.values(CHARACTERS).map((c) => [
    c.kind,
    Object.fromEntries(
      Object.entries(skinsOf(c))
        .filter(([, sk]) => sk.render === 'svg' && sk.svgCarry && sk.svgCarry.length)
        .map(([id, sk]) => [id, sk.svgCarry!]),
    ),
  ]),
)

/** Where a carried object rides relative to its carrier's centre, per kind ×
 *  skin (0–100 art box units). Only skins that set `carryOffset` appear; the
 *  render bridge uses it to place a carried brick, falling back to the sim's
 *  default carry position otherwise. */
export const SKIN_CARRY_OFFSET: Record<string, Record<string, { x: number; y: number }>> =
  Object.fromEntries(
    Object.values(CHARACTERS).map((c) => [
      c.kind,
      Object.fromEntries(
        Object.entries(skinsOf(c))
          .filter(([, sk]) => sk.carryOffset)
          .map(([id, sk]) => [id, sk.carryOffset!]),
      ),
    ]),
  )

/** One swinging limb: the render-stroke indices that move together, and the hip
 *  it rotates about (0–100 box). */
export type WalkLimb = { idxs: number[]; pivot: { x: number; y: number } }
/** A kind's walk rig: alternating-phase limbs, peak swing angle (degrees), and
 *  the horizontal direction the art is drawn facing (mirrored to face travel). */
export type WalkRig = { limbs: WalkLimb[]; swing: number; faces: 'left' | 'right' }

/** The hip a limb swings about, in the 0–100 box:
 *  - 'sprite' skin: the topmost (min-y) authored point across the limb's
 *    strokes — i.e. where the leg meets the body.
 *  - 'svg' skin: the limb parts have no sampled points to scan, so the hip is
 *    each part's GROUP ORIGIN (its matrix translation / tx-ty) — for an
 *    imported limb that's authored at the joint, this lands at the hip. Across
 *    several parts it's their centroid. */
function limbPivot(sk: Skin, idxs: number[]): { x: number; y: number } {
  if (sk.render === 'svg' && sk.svg) {
    let sx = 0
    let sy = 0
    let n = 0
    for (const i of idxs) {
      const p = sk.svg[i]
      if (!p) continue
      sx += p.matrix ? p.matrix[4] : (p.tx ?? 0)
      sy += p.matrix ? p.matrix[5] : (p.ty ?? 0)
      n++
    }
    return n ? { x: sx / n, y: sy / n } : { x: 50, y: 0 }
  }
  let pivot = { x: 50, y: 0 }
  let minY = Infinity
  for (const i of idxs) {
    for (const [x, y] of sk.art?.[i]?.pts ?? []) {
      if (y < minY) {
        minY = y
        pivot = { x, y }
      }
    }
  }
  return pivot
}

/** Precomputed walk rigs, derived from each skin's `walk`: kind → skin → rig.
 *  The render layer swings each limb (a group of stroke- or svg-part indices)
 *  about its hip as one rigid unit. Indices survive DOODLE_RENDER / SVG_RENDER's
 *  maps (they preserve authored order). A skin with `walk` but empty `limbs`
 *  (e.g. one that wants only the facing-flip) gets a rig with no limbs. */
export const WALK_RIG: Record<string, Record<string, WalkRig>> = Object.fromEntries(
  Object.values(CHARACTERS).map((c) => [
    c.kind,
    Object.fromEntries(
      Object.entries(skinsOf(c))
        .filter(([, sk]) => sk.walk)
        .map(([id, sk]) => {
          const limbs = sk.walk!.limbs.map((idxs) => ({ idxs, pivot: limbPivot(sk, idxs) }))
          return [id, { limbs, swing: sk.walk!.swing ?? 18, faces: sk.walk!.faces ?? 'left' }]
        }),
    ),
  ]),
)
