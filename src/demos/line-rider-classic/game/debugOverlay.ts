// Collision debug overlay drawing, extracted from Rider so the rAF loop stays
// focused on gameplay. Only the "Show Collisions" toggle uses any of this.
//
// All geometry is computed in PAGE space and mapped through editor.pageToViewport
// so it tracks pan/zoom exactly like the sled. Drawn imperatively (no React
// render in the loop), pooling DOM nodes per element type to avoid thrashing the
// DOM every frame on a busy track.

import { toDomPrecision, type Editor } from 'tldraw'
import { PHYSICS, type Body, type LineKind } from './physics'
import type { TrackSegment } from './geometry'
import type { Portal, PortalMouth } from './portals'

const SVG_NS = 'http://www.w3.org/2000/svg'

// The stroke color used to draw each kind's collision segments, roughly matching
// its draw-color legend so the overlay reads against the track. Typed
// Record<LineKind, …> (not Record<string, …>) so adding a new LineKind without a
// debug color is a compile error — see CLAUDE.md's "Adding a line behavior".
const DEBUG_KIND_COLOR: Record<LineKind, string> = {
	solid: '#1d1d1d',
	accelerate: '#e03131',
	brake: '#f76707',
	bounce: '#ffc034',
	sticky: '#ae3ec9',
	ice: '#4dabf7',
	oneway: '#4263eb',
	scenery: '#2f9e44',
}
const DEBUG_SEGMENT_COLOR = '#1d1d1d'
const DEBUG_RIG_COLOR = '#ff1493' // hot pink so the rig circles pop off the track
const DEBUG_PORTAL_IN = '#12b886' // entrance mouth: green ("go in here")
const DEBUG_PORTAL_OUT = '#e8590c' // exit mouth: orange-red ("come out here")

/** The pooled child groups the overlay fills, one element type each. */
export interface DebugGroups {
	segs: SVGGElement
	verts: SVGGElement
	rig: SVGGElement
	portals: SVGGElement
}

/** Page-space corners of a portal mouth's oriented box, mapped to viewport, as
 * an SVG polygon `points` string. */
function mouthPolygonPoints(m: PortalMouth, editor: Editor): string {
	const cos = Math.cos(m.rotation)
	const sin = Math.sin(m.rotation)
	// Local corners (±halfW, ±halfH) rotated into page space, then to viewport.
	const corners: Array<[number, number]> = [
		[-m.halfW, -m.halfH],
		[m.halfW, -m.halfH],
		[m.halfW, m.halfH],
		[-m.halfW, m.halfH],
	]
	return corners
		.map(([lx, ly]) => {
			const p = editor.pageToViewport({ x: m.cx + lx * cos - ly * sin, y: m.cy + lx * sin + ly * cos })
			return `${toDomPrecision(p.x)},${toDomPrecision(p.y)}`
		})
		.join(' ')
}

// Reconcile `g`'s direct children to exactly `count` elements of `tag` (pool
// reusable nodes, create/trim the delta). Pooling avoids thrashing the DOM every
// frame on a busy track. Returns the live child NodeList for the caller to fill.
function poolChildren(g: SVGGElement, tag: string, count: number): NodeListOf<ChildNode> {
	while (g.childElementCount < count) g.appendChild(document.createElementNS(SVG_NS, tag))
	while (g.childElementCount > count) g.removeChild(g.lastChild as ChildNode)
	return g.childNodes
}

/**
 * Draw the collision debug overlay into the three pooled groups, imperatively (no
 * React render in the rAF loop, matching the snail draw).
 *  - SEGMENT lines: one per collision segment, colored by kind. Drawn THICK and
 *    semi-transparent so they read as a highlight OVER the source stroke rather
 *    than hiding exactly under it (a pencil shape's segments trace the drawn line
 *    1:1, so a thin opaque line would be invisible).
 *  - VERTEX dots: one per segment endpoint, so you can see where the actual
 *    collision points sit along the polyline.
 *  - RIG circles: one per sled-rig point at PHYSICS.bodyRadius — the real contact
 *    surface the sim uses, which is larger than the drawn snail.
 */
export function drawDebug(
	groups: DebugGroups,
	segments: TrackSegment[],
	body: Body,
	editor: Editor,
	portals: Portal[]
): void {
	const zoom = editor.getZoomLevel()

	// Segment lines: thick, semi-transparent, kind-colored highlight.
	const segEls = poolChildren(groups.segs, 'line', segments.length)
	for (let i = 0; i < segments.length; i++) {
		const seg = segments[i]
		const a = editor.pageToViewport(seg.a)
		const b = editor.pageToViewport(seg.b)
		const el = segEls[i] as SVGElement
		el.setAttribute('x1', `${toDomPrecision(a.x)}`)
		el.setAttribute('y1', `${toDomPrecision(a.y)}`)
		el.setAttribute('x2', `${toDomPrecision(b.x)}`)
		el.setAttribute('y2', `${toDomPrecision(b.y)}`)
		el.setAttribute('stroke', DEBUG_KIND_COLOR[seg.kind] ?? DEBUG_SEGMENT_COLOR)
		el.setAttribute('stroke-width', '4')
		el.setAttribute('stroke-opacity', '0.45')
		el.setAttribute('stroke-linecap', 'round')
	}

	// Vertex dots at each segment's start, plus the very last segment's end so the
	// polyline's final point is marked too.
	const vertEls = poolChildren(groups.verts, 'circle', segments.length > 0 ? segments.length + 1 : 0)
	for (let i = 0; i < segments.length; i++) {
		const v = editor.pageToViewport(segments[i].a)
		const el = vertEls[i] as SVGElement
		el.setAttribute('cx', `${toDomPrecision(v.x)}`)
		el.setAttribute('cy', `${toDomPrecision(v.y)}`)
		el.setAttribute('r', '2')
		el.setAttribute('fill', DEBUG_KIND_COLOR[segments[i].kind] ?? DEBUG_SEGMENT_COLOR)
	}
	if (segments.length > 0) {
		const last = segments[segments.length - 1]
		const v = editor.pageToViewport(last.b)
		const el = vertEls[segments.length] as SVGElement
		el.setAttribute('cx', `${toDomPrecision(v.x)}`)
		el.setAttribute('cy', `${toDomPrecision(v.y)}`)
		el.setAttribute('r', '2')
		el.setAttribute('fill', DEBUG_KIND_COLOR[last.kind] ?? DEBUG_SEGMENT_COLOR)
	}

	// Rig contact circles at the true body radius.
	const rigEls = poolChildren(groups.rig, 'circle', body.points.length)
	for (let i = 0; i < body.points.length; i++) {
		const c = editor.pageToViewport(body.points[i].pos)
		const el = rigEls[i] as SVGElement
		el.setAttribute('cx', `${toDomPrecision(c.x)}`)
		el.setAttribute('cy', `${toDomPrecision(c.y)}`)
		el.setAttribute('r', `${toDomPrecision(PHYSICS.bodyRadius * zoom)}`)
		el.setAttribute('fill', 'none')
		el.setAttribute('stroke', DEBUG_RIG_COLOR)
		el.setAttribute('stroke-width', '1.5')
	}

	// Portal mouths: entrance (green) + exit (orange-red) oriented boxes, two
	// polygons per portal. The linking arrow is a native shape already visible on
	// the canvas, so its direction needs no extra drawing here.
	const portalEls = poolChildren(groups.portals, 'polygon', portals.length * 2)
	for (let i = 0; i < portals.length; i++) {
		const inEl = portalEls[i * 2] as SVGElement
		inEl.setAttribute('points', mouthPolygonPoints(portals[i].entrance, editor))
		inEl.setAttribute('fill', DEBUG_PORTAL_IN)
		inEl.setAttribute('fill-opacity', '0.18')
		inEl.setAttribute('stroke', DEBUG_PORTAL_IN)
		inEl.setAttribute('stroke-width', '1.5')
		const outEl = portalEls[i * 2 + 1] as SVGElement
		outEl.setAttribute('points', mouthPolygonPoints(portals[i].exit, editor))
		outEl.setAttribute('fill', DEBUG_PORTAL_OUT)
		outEl.setAttribute('fill-opacity', '0.18')
		outEl.setAttribute('stroke', DEBUG_PORTAL_OUT)
		outEl.setAttribute('stroke-width', '1.5')
	}
}
