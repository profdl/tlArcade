/**
 * Engine — the shared drawing-perception bundle.
 *
 * THE reusable "let Claude see a drawing" primitive (PLAN §1.2). Every AI
 * converter that reads the canvas (autoRig, autoEnemy, autoLevel, …) calls
 * perceive() and differs only in the prompt + the Zod schema of what comes back.
 * Given a set of shape ids it returns, in one bundle:
 *
 *  - PNG — what Claude visually perceives (a raster it can actually look at).
 *  - Leaf geometry keyed by shape id — the GROUND TRUTH Claude maps onto, so it
 *    returns REAL shape ids and exact page coordinates instead of guessing. This
 *    is the load-bearing bit: it turns "somewhere around here" into "shape X".
 *  - SVG — a precision tiebreaker (vector paths where the raster is ambiguous).
 *
 * Verified against tldraw@^5.1.1:
 *  - `editor.toImageDataUrl(ids, opts)` → Promise<{ url, width, height }> — `url`
 *    is a `data:image/png;base64,...` string (NOT a bare string). We split the
 *    base64 payload out for the Anthropic image block (see game/ai/client.ts).
 *  - `editor.getSvgString(ids, opts)` → Promise<{ svg, width, height } | undefined>.
 *  - `editor.getShapeAndDescendantIds([id])` → Set<TLShapeId> — enumerates a
 *    group's leaves so a multi-part figure is perceived by its real parts.
 *
 * This module is editor-BOUND (it reads the live editor), so it is not unit-tested
 * the way the pure sim modules are; its consumers (the converters) are where the
 * testable logic lives. The geometry extraction reuses collision.ts helpers.
 */
import type { Editor, TLShapeId } from 'tldraw'
import { outlineSamples, type Bounds, type Pt } from '../collision'

/** One leaf shape's ground-truth geometry, keyed by its real id. */
export interface LeafGeometry {
  id: TLShapeId
  type: string
  /** Page-space bounds — the box the AI can snap to. */
  bounds: Bounds
  /** Page-space outline sample points (perimeter), if the shape has an outline. */
  outline: Pt[]
  /** The role color, when the shape carries one (geo/draw) — a behavior hint. */
  color?: string
}

/** The full perception bundle handed to a converter. */
export interface Perception {
  /** The shape ids this bundle describes (the exact set passed in, expanded to leaves). */
  ids: TLShapeId[]
  /** PNG data URL (`data:image/png;base64,...`) — pass to client via toImageInput(). */
  png: string
  pngWidth: number
  pngHeight: number
  /** SVG markup string (precision tiebreaker). Absent if the export produced nothing. */
  svg?: string
  /** Leaf geometry keyed by real shape id. */
  leaves: LeafGeometry[]
  /** Union page bounds of everything perceived. */
  bounds: Bounds | null
}

export interface PerceiveOptions {
  /** PNG render scale (default 2 — the "what Claude sees" resolution from §1.2). */
  scale?: number
  /** Include the SVG tiebreaker (default true). Skip for a lighter/faster bundle. */
  includeSvg?: boolean
  /** Render the canvas background into the PNG (default false → transparent). */
  background?: boolean
}

/**
 * Build a perception bundle for the given shapes (a level, a character group, an
 * enemy — anything). Expands groups to their leaves for the geometry map, but
 * renders the PNG/SVG from the ids as given (so a group renders as its whole).
 */
export async function perceive(
  editor: Editor,
  ids: TLShapeId[],
  opts: PerceiveOptions = {},
): Promise<Perception> {
  const { scale = 2, includeSvg = true, background = false } = opts

  // Expand to leaves for the geometry map: a group has no outline of its own, so
  // its drawable children carry the ground truth. getShapeAndDescendantIds
  // includes the passed ids themselves.
  const leafIds: TLShapeId[] = []
  for (const id of editor.getShapeAndDescendantIds(ids)) {
    const shape = editor.getShape(id)
    if (!shape || shape.type === 'group') continue
    leafIds.push(id)
  }

  const leaves: LeafGeometry[] = leafIds.map((id) => geometryOf(editor, id))
  const bounds = unionBounds(leaves.map((l) => l.bounds))

  // PNG — the raster Claude visually perceives. Render from the ids as given.
  const image = await editor.toImageDataUrl(ids, { format: 'png', scale, background })

  // SVG — the precision tiebreaker (optional; larger bundle).
  let svg: string | undefined
  if (includeSvg) {
    const out = await editor.getSvgString(ids, { scale, background })
    svg = out?.svg
  }

  return {
    ids: leafIds,
    png: image.url,
    pngWidth: image.width,
    pngHeight: image.height,
    svg,
    leaves,
    bounds,
  }
}

/** One leaf's ground-truth geometry. */
function geometryOf(editor: Editor, id: TLShapeId): LeafGeometry {
  const shape = editor.getShape(id)!
  const pageBounds = editor.getShapePageBounds(id)
  const bounds: Bounds = pageBounds
    ? {
        minX: pageBounds.minX,
        minY: pageBounds.minY,
        maxX: pageBounds.maxX,
        maxY: pageBounds.maxY,
      }
    : { minX: shape.x, minY: shape.y, maxX: shape.x, maxY: shape.y }

  const outline = outlineSamples(editor, id) ?? []

  // Surface a color when the shape has one — it's the behavior hint the engine
  // reads (roles.ts). Not all shapes have props.color; read defensively.
  const color = (shape.props as { color?: unknown } | undefined)?.color
  return {
    id,
    type: shape.type,
    bounds,
    outline,
    color: typeof color === 'string' ? color : undefined,
  }
}

function unionBounds(all: Bounds[]): Bounds | null {
  if (all.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const b of all) {
    if (b.minX < minX) minX = b.minX
    if (b.minY < minY) minY = b.minY
    if (b.maxX > maxX) maxX = b.maxX
    if (b.maxY > maxY) maxY = b.maxY
  }
  return { minX, minY, maxX, maxY }
}

/**
 * Split a perception PNG data URL into the `{ mediaType, base64 }` an ImageInput
 * (game/ai/client.ts) needs. Handles the `data:image/png;base64,<payload>` form
 * `toImageDataUrl` returns.
 */
export function toImageInput(
  dataUrl: string,
): { mediaType: 'image/png' | 'image/jpeg'; base64: string } {
  const match = dataUrl.match(/^data:(image\/png|image\/jpeg);base64,(.*)$/)
  if (!match) {
    throw new Error('perceive(): PNG was not a base64 image data URL')
  }
  return { mediaType: match[1] as 'image/png' | 'image/jpeg', base64: match[2] }
}
