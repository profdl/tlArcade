/**
 * Busytown — perfect-freehand helpers.
 * Sprites are drawn as hand-inked doodles: each stroke is a list of points run
 * through perfect-freehand's `getStroke`, which returns a variable-width outline
 * we fill as an SVG path. All coordinates live in a 0–100 box (see doodles.ts)
 * so a sprite scales to whatever size the shape is rendered at.
 */
import { getStroke } from 'perfect-freehand'

export type StrokePts = number[][]

/** tldraw default Draw stroke weights (S/M/L/XL). Authored on each stroke and
 *  mapped to page px at render time (see doodles.ts → DRAW_WEIGHT). */
export type Weight = 's' | 'm' | 'l' | 'xl'

/** One authored doodle stroke: a point list, its pen weight, whether it
 *  encloses fillable area, and whether it should sit on an opaque white
 *  backing (so strokes drawn earlier — e.g. wings behind a head — don't show
 *  through it) regardless of the shape's editable fill style. This is the art
 *  primitive a CharacterDef carries. */
export type Stroke = { pts: StrokePts; w: Weight; closed?: boolean; bg?: boolean }

/** Terse stroke constructor used throughout the character art files. */
export const s = (pts: StrokePts, w: Weight, closed = false, bg = false): Stroke => ({
  pts,
  w,
  closed,
  bg,
})

/** Evenly sampled points along a line segment. */
export function seg(x1: number, y1: number, x2: number, y2: number, n = 10): StrokePts {
  const pts: StrokePts = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    pts.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t])
  }
  return pts
}

/** A polyline through a list of corners (one continuous stroke). */
export function poly(corners: number[][], nPer = 6): StrokePts {
  const pts: StrokePts = []
  for (let i = 0; i < corners.length - 1; i++) {
    const [x1, y1] = corners[i]
    const [x2, y2] = corners[i + 1]
    const s = seg(x1, y1, x2, y2, nPer)
    if (i > 0) s.shift() // avoid duplicate join point
    pts.push(...s)
  }
  return pts
}

/** A closed ellipse outline. */
export function ring(cx: number, cy: number, rx: number, ry: number, n = 28): StrokePts {
  const pts: StrokePts = []
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry])
  }
  return pts
}

/** A vertical stadium/oval outline: rounded top & bottom, straight-ish sides. */
export function capsule(cx: number, top: number, bottom: number, r: number, n = 14): StrokePts {
  const pts: StrokePts = []
  const yTop = top + r
  const yBot = bottom - r
  for (let i = 0; i <= n; i++) {
    const a = Math.PI + (i / n) * Math.PI // top cap: left → over top → right
    pts.push([cx + Math.cos(a) * r, yTop + Math.sin(a) * r])
  }
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI // right side down, then bottom cap: right → under → left
    pts.push([cx + Math.cos(a) * r, yBot + Math.sin(a) * r])
  }
  pts.push([cx - r, yTop]) // left side back up to close
  return pts
}

// Matches tldraw's geo "Dash: Draw" rendering: EVEN thickness (no taper), no
// simulated pressure, and tldraw's smoothing — so every stroke in a character
// has the exact same weight and hand-drawn character as a native tldraw oval.
const STROKE_OPTS = {
  thinning: 0,
  smoothing: 0.62,
  streamline: 0.5,
  simulatePressure: false,
  last: true,
}

/** Outline points → an SVG path `d` string (quadratic smoothing). */
function svgFromOutline(stroke: number[][]): string {
  if (!stroke.length) return ''
  const d = stroke.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length]
      acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2)
      return acc
    },
    ['M', ...stroke[0], 'Q'] as (string | number)[],
  )
  d.push('Z')
  return d.join(' ')
}

/** Build the fillable SVG path for one stroke at a given nib size (Dash: Draw). */
export function strokePath(pts: StrokePts, size: number): string {
  return svgFromOutline(getStroke(pts, { size, ...STROKE_OPTS }))
}

/** The stroke's centre-line as an SVG path (for solid / dashed / dotted dash
 *  styles, which stroke a thin line rather than filling a freehand outline). */
export function centerlinePath(pts: StrokePts, closed = false): string {
  if (!pts.length) return ''
  let d = `M ${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`
  for (let i = 1; i < pts.length; i++) d += ` L ${pts[i][0].toFixed(2)} ${pts[i][1].toFixed(2)}`
  return closed ? `${d} Z` : d
}
