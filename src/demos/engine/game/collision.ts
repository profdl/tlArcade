/**
 * Engine — geometry-accurate collision.
 *
 * Instead of colliding axis-aligned bounding boxes, we read each shape's real
 * outline (via tldraw's geometry — same approach as the Line Rider demo) into
 * page space:
 *  - CLOSED shapes (geo like rectangle/triangle/ellipse, or a closed drawing)
 *    become a filled polygon — the player can't enter it.
 *  - OPEN strokes (pencil/line, open geo) become a thin band along the path, so
 *    a hand-drawn line is a ridable surface: draw hills and valleys.
 *
 * The player is sampled as points around its OWN outline, so an oddly-shaped
 * player collides by its perimeter too. Collision resolution pushes each
 * penetrating sample point out along the surface normal (see engine.ts).
 *
 * Freshness: we pass shape *ids* to getShapeGeometry / getShapePageTransform so
 * the reactive caches resolve against the live record (see line-rider CLAUDE.md).
 */
import { getPointsFromDrawSegment, type Editor, type TLDrawShape, type TLShapeId } from 'tldraw'

export interface Pt {
  x: number
  y: number
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface Body {
  /** Page-space outline: a polygon for `closed`, a polyline otherwise. */
  pts: Pt[]
  closed: boolean
  bounds: Bounds
  /** Half-thickness for open (band) bodies; 0 for closed (filled) bodies. */
  margin: number
  /**
   * A one-way platform (G3a): solid only from ABOVE. The resolver ignores its
   * contact unless the push-out is a floor normal lifting the entity UP (a
   * landing) — so you jump up through it and land on top, but never bonk it from
   * below or get blocked sideways. Undefined/false = a normal solid.
   */
  oneWay?: boolean
}

/** How thick an open stroke's collision band is (page px, each side of the line). */
const OPEN_MARGIN = 9
/** Perimeter sampling step for the player outline (page px between points). */
const SAMPLE_STEP = 7

function boundsOf(pts: Pt[]): Bounds {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of pts) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY }
}

/** The page-space outline points of a shape (draw strokes concatenated). */
function outlinePoints(editor: Editor, id: TLShapeId): { pts: Pt[]; closed: boolean } | null {
  const transform = editor.getShapePageTransform(id)
  const shape = editor.getShape(id)
  if (!transform || !shape) return null

  const pts: Pt[] = []
  let closed: boolean

  if (shape.type === 'draw') {
    const draw = shape as TLDrawShape
    const scale = draw.props.scale
    for (const stroke of draw.props.segments) {
      const page = transform.applyToPoints(getPointsFromDrawSegment(stroke, scale, scale))
      for (const p of page) pts.push({ x: p.x, y: p.y })
    }
    closed = draw.props.isClosed
  } else {
    const geo = editor.getShapeGeometry(id)
    const verts = geo.vertices
    if (!verts || verts.length < 2) return null
    for (const p of transform.applyToPoints(verts)) pts.push({ x: p.x, y: p.y })
    closed = geo.isClosed
  }

  return pts.length >= 2 ? { pts, closed } : null
}

/** Build a collision body for a shape, or null if it has no usable outline. */
export function buildBody(editor: Editor, id: TLShapeId): Body | null {
  const outline = outlinePoints(editor, id)
  if (!outline) return null
  return {
    pts: outline.pts,
    closed: outline.closed,
    bounds: boundsOf(outline.pts),
    margin: outline.closed ? 0 : OPEN_MARGIN,
  }
}

/** Sample points around a shape's outline, in page space (used for the player). */
export function outlineSamples(editor: Editor, id: TLShapeId): Pt[] | null {
  const outline = outlinePoints(editor, id)
  if (!outline) return null
  const { pts, closed } = outline
  const n = pts.length
  const edges = closed ? n : n - 1
  const out: Pt[] = []
  for (let i = 0; i < n; i++) {
    out.push({ x: pts[i].x, y: pts[i].y })
    if (i >= edges) continue
    const a = pts[i]
    const b = pts[(i + 1) % n]
    const d = Math.hypot(b.x - a.x, b.y - a.y)
    const steps = Math.floor(d / SAMPLE_STEP)
    for (let k = 1; k < steps; k++) {
      const t = k / steps
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
    }
  }
  return out
}

/** Even-odd point-in-polygon test. */
export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x
    const yi = poly[i].y
    const xj = poly[j].x
    const yj = poly[j].y
    if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

function nearestOnSegment(p: Pt, a: Pt, b: Pt): Pt {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return { x: a.x, y: a.y }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  t = t < 0 ? 0 : t > 1 ? 1 : t
  return { x: a.x + dx * t, y: a.y + dy * t }
}

/**
 * Closest point on a path (polygon if `closed`) to p, plus the distance to it and
 * the DIRECTION of the governing edge (`ex,ey`, un-normalized a→b). The edge vector
 * lets a caller derive an outward normal (perpendicular to the edge) even when p sits
 * exactly ON the boundary (dist ≈ 0), where the "p − nearest" direction is undefined
 * — the case that used to fall back to a hardcoded "push up" and let a point flush
 * against a vertical wall face creep upward each frame.
 */
export function nearestOnPath(
  p: Pt,
  pts: Pt[],
  closed: boolean,
): { pt: Pt; dist: number; ex: number; ey: number } {
  const n = pts.length
  const edges = closed ? n : n - 1
  let best = pts[0]
  let bestD = Infinity
  let ex = 0
  let ey = 0
  for (let i = 0; i < edges; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % n]
    const q = nearestOnSegment(p, a, b)
    const d = Math.hypot(p.x - q.x, p.y - q.y)
    if (d < bestD) {
      bestD = d
      best = q
      ex = b.x - a.x
      ey = b.y - a.y
    }
  }
  return { pt: best, dist: bestD, ex, ey }
}

/**
 * How far, and in which direction, a single point must move to leave a body's
 * solid region — the minimum-translation push-out for that point, or null if the
 * point is already outside (not penetrating).
 *
 *  - CLOSED body (filled polygon): a point is penetrating iff it's inside the
 *    polygon. Push it out to the nearest edge (that's the shallowest way out), so
 *    the normal points from the surface toward where the point sits.
 *  - OPEN body (band of half-thickness `margin`): a point penetrates iff it's
 *    within `margin` of the path. Push it out to `margin` along the direction from
 *    the path to the point (the side it's on), so a stroke reads as a two-sided
 *    ridable surface.
 *
 * The returned vector (nx, ny) is a UNIT normal pointing OUT of the body (toward
 * the point's free side); `depth` is how far along it the point must move.
 */
export function penetration(p: Pt, body: Body): { nx: number; ny: number; depth: number } | null {
  // Cheap AABB reject first (inflated by margin for open bands).
  const m = body.margin
  if (
    p.x < body.bounds.minX - m ||
    p.x > body.bounds.maxX + m ||
    p.y < body.bounds.minY - m ||
    p.y > body.bounds.maxY + m
  ) {
    return null
  }

  if (body.closed) {
    if (!pointInPolygon(p, body.pts)) return null
    // Inside: the shallowest way out is to the nearest edge point `pt`. The
    // OUTWARD normal points from the interior point toward that boundary point
    // (pt - p), and the point must travel `dist` to reach the surface.
    const { pt, dist, ex, ey } = nearestOnPath(p, body.pts, true)
    if (dist < 1e-9) {
      // Dead on the boundary — (pt − p) is degenerate. Push out PERPENDICULAR to
      // the governing edge instead of a hardcoded "up": a point flush against a
      // wall's vertical face gets a horizontal push OUT of the wall (its true
      // shallowest exit), not a 0.5px upward nudge that ratcheted the player up the
      // face each frame (the "auto-slide up walls" glitch). Perp of edge (ex,ey) is
      // (ey,−ex) or (−ey,ex); pick the one pointing toward the polygon exterior by
      // sampling a hair along it.
      const el = Math.hypot(ex, ey)
      if (el < 1e-9) return { nx: 0, ny: -1, depth: 0.5 } // degenerate edge; old fallback
      let nx = ey / el
      let ny = -ex / el
      // Orient outward: if stepping along (nx,ny) lands us back INSIDE, flip it.
      if (pointInPolygon({ x: p.x + nx * 0.5, y: p.y + ny * 0.5 }, body.pts)) {
        nx = -nx
        ny = -ny
      }
      return { nx, ny, depth: 0.5 }
    }
    return { nx: (pt.x - p.x) / dist, ny: (pt.y - p.y) / dist, depth: dist }
  }

  // Open band: penetrating iff within `margin` of the path.
  const { pt, dist } = nearestOnPath(p, body.pts, false)
  if (dist >= m) return null
  if (dist < 1e-9) return { nx: 0, ny: -1, depth: m } // on the line; push straight up
  return { nx: (p.x - pt.x) / dist, ny: (p.y - pt.y) / dist, depth: m - dist }
}
