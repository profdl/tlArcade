// Convex decomposition — turn an arbitrary (possibly concave) simple polygon
// into a set of convex pieces planck can use as fixtures.
//
// WHY: planck/Box2D polygon fixtures MUST be convex (a Polygon silently takes
// the convex HULL of concave input, which would erase a shape's notches — a
// drawn squiggle would stop being awkward, exactly what the plan forbids). The
// designated OBJECT must be solid and tumble, so we decompose its outline into
// convex pieces and weld them onto one body. (The maze doesn't need this — its
// walls are Chain fixtures, which take a concave polyline directly.)
//
// PURE & FRAMEWORK-FREE (no tldraw / planck / DOM) so it ports into the DO with
// sim.ts and is trivially unit-testable. Coordinates are plain {x,y}; the caller
// owns units (this runs on page-px outlines before the px→m conversion).
//
// Algorithm: ear clipping. O(n²), fine for the vertex counts a hand-drawn
// outline produces. Ear clipping yields TRIANGLES (always convex); we then
// greedily merge adjacent triangles back into larger convex polygons so we emit
// far fewer fixtures than triangles (a rectangle → 1 quad, not 2 tris).

export interface P {
	x: number
	y: number
}

/** Cross product of (b−a)×(c−a) — sign tells the turn direction at b. In our
 * convention a POSITIVE cross is the "convex" turn we ear-clip on; area2 below
 * uses the SAME sign so "positive-area winding" and "positive-cross convex
 * vertex" agree regardless of whether the page frame is +y-up or +y-down. */
function cross(a: P, b: P, c: P): number {
	return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

/** Signed area ×2 (shoelace). Same sign convention as `cross`: a polygon whose
 * vertices make positive `cross` turns has positive area here. */
function area2(poly: P[]): number {
	let a = 0
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		a += poly[j].x * poly[i].y - poly[i].x * poly[j].y
	}
	return a
}

/** Is p inside (or on the edges of) triangle abc? Barycentric sign test. */
function pointInTri(p: P, a: P, b: P, c: P): boolean {
	const d1 = cross(p, a, b)
	const d2 = cross(p, b, c)
	const d3 = cross(p, c, a)
	const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
	const hasPos = d1 > 0 || d2 > 0 || d3 > 0
	// Inside iff all cross products share a sign (allowing zero for on-edge).
	return !(hasNeg && hasPos)
}

/** Drop consecutive duplicate / near-duplicate vertices and any that are
 * collinear with their neighbors (they add nothing and break ear tests). */
function clean(poly: P[], eps = 1e-6): P[] {
	const pts = poly.filter((p, i) => {
		const q = poly[(i + 1) % poly.length]
		return Math.hypot(p.x - q.x, p.y - q.y) > eps
	})
	if (pts.length < 3) return pts
	const out: P[] = []
	for (let i = 0; i < pts.length; i++) {
		const prev = pts[(i - 1 + pts.length) % pts.length]
		const cur = pts[i]
		const next = pts[(i + 1) % pts.length]
		if (Math.abs(cross(prev, cur, next)) > eps) out.push(cur)
	}
	return out.length >= 3 ? out : pts
}

/**
 * Ear-clip a simple polygon into triangles. Input may wind either way and may
 * be concave; it must be simple (non-self-intersecting), which a shape outline
 * from tldraw is. Returns triangles as [a,b,c] triples; empty if degenerate.
 */
function earClip(input: P[]): P[][] {
	let poly = clean(input)
	if (poly.length < 3) return []
	// Work in CCW winding so a convex vertex has cross > 0.
	if (area2(poly) < 0) poly = poly.slice().reverse()

	const tris: P[][] = []
	const idx = poly.map((_, i) => i)
	let guard = 0
	const maxGuard = poly.length * poly.length + 10

	while (idx.length > 3 && guard++ < maxGuard) {
		let clipped = false
		for (let i = 0; i < idx.length; i++) {
			const ai = idx[(i - 1 + idx.length) % idx.length]
			const bi = idx[i]
			const ci = idx[(i + 1) % idx.length]
			const a = poly[ai]
			const b = poly[bi]
			const c = poly[ci]
			// Convex (left-turn) vertex?
			if (cross(a, b, c) <= 0) continue
			// No other polygon vertex inside this candidate ear?
			let contains = false
			for (let k = 0; k < idx.length; k++) {
				const vk = idx[k]
				if (vk === ai || vk === bi || vk === ci) continue
				if (pointInTri(poly[vk], a, b, c)) {
					contains = true
					break
				}
			}
			if (contains) continue
			tris.push([a, b, c])
			idx.splice(i, 1)
			clipped = true
			break
		}
		if (!clipped) break // no ear found (numerical trouble) — bail with what we have
	}
	if (idx.length === 3) {
		tris.push([poly[idx[0]], poly[idx[1]], poly[idx[2]]])
	}
	return tris
}

/** Would merging convex polygons `p` and `q` across a shared edge stay convex
 * and within planck's vertex cap? `p`/`q` are CCW; the shared edge is given as
 * the two vertex positions. Returns the merged CCW polygon or null. */
function tryMerge(p: P[], q: P[], maxVerts: number, eps = 1e-6): P[] | null {
	// Find a shared directed edge (p has a→b, q has b→a).
	for (let i = 0; i < p.length; i++) {
		const a = p[i]
		const b = p[(i + 1) % p.length]
		for (let j = 0; j < q.length; j++) {
			const c = q[j]
			const d = q[(j + 1) % q.length]
			if (Math.hypot(a.x - d.x, a.y - d.y) < eps && Math.hypot(b.x - c.x, b.y - c.y) < eps) {
				// Stitch: p from b..a (skipping the shared edge's second endpoint) then
				// q from c..d equivalent. Walk p starting after b back to a, then q
				// starting after c back to d.
				const merged: P[] = []
				for (let k = 0; k < p.length - 1; k++) merged.push(p[(i + 1 + k) % p.length]) // b .. a
				for (let k = 0; k < q.length - 1; k++) merged.push(q[(j + 1 + k) % q.length]) // c .. d
				const m = clean(merged)
				if (m.length > maxVerts) return null
				// Convex iff every turn is a left turn (CCW).
				for (let k = 0; k < m.length; k++) {
					const u = m[(k - 1 + m.length) % m.length]
					const v = m[k]
					const w = m[(k + 1) % m.length]
					if (cross(u, v, w) < -eps) return null
				}
				return m
			}
		}
	}
	return null
}

/**
 * Convex hull (Andrew's monotone chain) of an arbitrary point set — the smallest
 * convex polygon containing every point, returned CCW. Used as the ROBUST
 * fallback when an outline can't be decomposed as a simple polygon (a hand-drawn
 * stroke that self-intersects when closed, or is too thin to enclose area): the
 * hull is always a valid convex solid, so the object always gets a usable body.
 * Returns [] for fewer than 3 non-degenerate points.
 */
export function convexHull(input: P[]): P[] {
	const pts = input
		.slice()
		.sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x))
		.filter((p, i, arr) => i === 0 || p.x !== arr[i - 1].x || p.y !== arr[i - 1].y)
	if (pts.length < 3) return []
	const half = (src: P[]): P[] => {
		const h: P[] = []
		for (const p of src) {
			while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop()
			h.push(p)
		}
		h.pop() // drop the last point; it's the first of the other half
		return h
	}
	const lower = half(pts)
	const upper = half(pts.slice().reverse())
	const hull = lower.concat(upper)
	return hull.length >= 3 ? hull : []
}

/**
 * The min-area-ish "thick bar" around a point set: its convex hull swept out to
 * at least `thickness` on its short axis. For a near-straight stroke (which
 * encloses no area, so neither fill nor hull gives a usable solid) this is the
 * last-resort body — a thin rectangle along the stroke's long axis. We use the
 * hull's bounding box in its dominant direction; a floor on the short side
 * guarantees real area. Returns a single CCW quad, or [] if the points have no
 * extent at all (a single dot).
 */
export function thickBar(input: P[], thickness: number): P[] {
	const hull = convexHull(input)
	const pts = hull.length >= 2 ? hull : input
	if (pts.length < 2) return []
	// Dominant axis = the segment between the two farthest-apart points.
	let a = pts[0]
	let b = pts[1]
	let best = -1
	for (let i = 0; i < pts.length; i++) {
		for (let j = i + 1; j < pts.length; j++) {
			const d = (pts[i].x - pts[j].x) ** 2 + (pts[i].y - pts[j].y) ** 2
			if (d > best) {
				best = d
				a = pts[i]
				b = pts[j]
			}
		}
	}
	const len = Math.hypot(b.x - a.x, b.y - a.y)
	if (len < 1e-6) return []
	// Unit along the axis, and its perpendicular (the thickness direction).
	const ux = (b.x - a.x) / len
	const uy = (b.y - a.y) / len
	const px = -uy
	const py = ux
	// Project every point onto the perpendicular; take the widest span, floored
	// at `thickness`, so a curved-but-thin stroke keeps a little of its real width.
	let lo = Infinity
	let hi = -Infinity
	for (const p of pts) {
		const t = (p.x - a.x) * px + (p.y - a.y) * py
		if (t < lo) lo = t
		if (t > hi) hi = t
	}
	const mid = (lo + hi) / 2
	const half = Math.max((hi - lo) / 2, thickness / 2)
	const off = { x: px * half, y: py * half }
	const cA = { x: a.x + px * mid, y: a.y + py * mid }
	const cB = { x: b.x + px * mid, y: b.y + py * mid }
	return [
		{ x: cA.x - off.x, y: cA.y - off.y },
		{ x: cB.x - off.x, y: cB.y - off.y },
		{ x: cB.x + off.x, y: cB.y + off.y },
		{ x: cA.x + off.x, y: cA.y + off.y },
	]
}

/**
 * Decompose a simple polygon outline into convex pieces (each ≤ maxVerts
 * vertices), suitable one-per-planck-fixture. Ear-clips to triangles, then
 * greedily merges adjacent triangles that stay convex. Returns [] for
 * degenerate input.
 */
export function decomposeConvex(outline: P[], maxVerts = 8): P[][] {
	const tris = earClip(outline)
	if (tris.length === 0) return []
	const pieces: P[][] = tris.map((t) => t.slice())
	// Greedy merge passes until nothing more can be combined.
	let merged = true
	while (merged) {
		merged = false
		outer: for (let i = 0; i < pieces.length; i++) {
			for (let j = i + 1; j < pieces.length; j++) {
				const m = tryMerge(pieces[i], pieces[j], maxVerts)
				if (m) {
					pieces.splice(j, 1)
					pieces[i] = m
					merged = true
					break outer
				}
			}
		}
	}
	return pieces
}
