/**
 * tl-os — tiny hand-drawn stroke helper.
 *
 * Turns a list of points into a filled SVG outline via perfect-freehand (already
 * a repo dep), using the same options busytown uses to match tldraw's geo
 * "Dash: Draw" look — even thickness (no taper), no simulated pressure, tldraw's
 * smoothing. Kept self-contained here rather than importing busytown's copy, so
 * the demos stay isolated (see the repo CLAUDE.md).
 */
import { getStroke } from 'perfect-freehand'

export type Pts = number[][]

// Even, hand-drawn nib that matches tldraw's Draw dash (no thin/thick taper).
const STROKE_OPTS = {
	thinning: 0,
	smoothing: 0.62,
	streamline: 0.5,
	simulatePressure: false,
	last: true,
}

/** Outline points → a closed SVG path `d` string (quadratic smoothing). */
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

/** Points → a fillable freehand outline path at the given nib size. */
export function strokePath(pts: Pts, size: number): string {
	return svgFromOutline(getStroke(pts, { size, ...STROKE_OPTS }))
}

/** Evenly sample `n` points along a segment (so freehand has enough to wobble). */
function seg(x1: number, y1: number, x2: number, y2: number, n = 8): Pts {
	const out: Pts = []
	for (let i = 0; i <= n; i++) {
		const t = i / n
		out.push([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t])
	}
	return out
}

/** A continuous polyline through a list of corners (one stroke). Pass the first
 *  corner again at the end for a closed loop. */
export function poly(corners: number[][], nPer = 6): Pts {
	const out: Pts = []
	for (let i = 0; i < corners.length - 1; i++) {
		const [x1, y1] = corners[i]
		const [x2, y2] = corners[i + 1]
		const s = seg(x1, y1, x2, y2, nPer)
		if (i > 0) s.shift() // drop duplicate join point
		out.push(...s)
	}
	return out
}

// --- Live-geometry helpers (for the column-browser chrome) -----------------
// The glyphs above precompute a fixed 0–100 art box once at module load. The
// browser window's outline/dividers/selection boxes are sized from the shape's
// live w/h, so these take absolute coords and stroke on demand. Cheap enough to
// recompute each render (a few short strokes), and it keeps the wobble honest.

/**
 * A single hand-drawn stroke from (x1,y1) to (x2,y2) at nib `size`. Intermediate
 * sample points are nudged perpendicular to the line by a small, *deterministic*
 * waver (two out-of-phase sines — no `Math.random`, so it doesn't re-wobble on
 * every render and stays stable across a resize). This makes a "straight" rule —
 * a column divider or the header underline — read as visibly drawn, not ruled.
 * `amp` scales the wobble; the default suits a short chrome rule.
 */
export function line(
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	size: number,
	amp = 1.6,
): string {
	const dx = x2 - x1
	const dy = y2 - y1
	const len = Math.hypot(dx, dy) || 1
	// Unit perpendicular to the segment.
	const nx = -dy / len
	const ny = dx / len
	const n = 14
	const pts: Pts = []
	for (let i = 0; i <= n; i++) {
		const t = i / n
		// Taper the waver to zero at both ends so the rule still meets its corners.
		const ends = Math.sin(t * Math.PI)
		const wobble =
			amp * ends * (Math.sin(t * 6.3 + 0.7) * 0.6 + Math.sin(t * 11.0 + 2.1) * 0.4)
		pts.push([x1 + dx * t + nx * wobble, y1 + dy * t + ny * wobble])
	}
	return strokePath(pts, size)
}

/** A rough freehand rounded-rectangle outline (for the window frame / selection
 *  boxes). Corners are chamfered by `r` so the freehand pass reads as a drawn
 *  rounded box rather than a sharp one. Returns a fillable outline `d`. */
export function roughRect(
	x: number,
	y: number,
	w: number,
	h: number,
	r: number,
	size: number,
): string {
	const rr = Math.min(r, w / 2, h / 2)
	return strokePath(
		poly([
			[x + rr, y],
			[x + w - rr, y],
			[x + w, y + rr],
			[x + w, y + h - rr],
			[x + w - rr, y + h],
			[x + rr, y + h],
			[x, y + h - rr],
			[x, y + rr],
			[x + rr, y],
		]),
		size,
	)
}

/** A hand-drawn ‹›-style chevron pointing right, centred at (cx,cy) with the
 *  given half-height. Used for the disclosure arrow on folder rows. */
export function chevron(cx: number, cy: number, half: number, size: number): string {
	return strokePath(
		poly([
			[cx - half * 0.6, cy - half],
			[cx + half * 0.6, cy],
			[cx - half * 0.6, cy + half],
		]),
		size,
	)
}
