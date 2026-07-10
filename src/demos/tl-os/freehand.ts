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
