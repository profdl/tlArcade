import { describe, it, expect } from 'vitest'
import { createWorld, step, objPose, hitTestObject, type Grab } from './sim'
import type { WorldSpec } from './shapes'
import type { TLShapeId } from 'tldraw'

/** A concave star outline (page px) — the seed object's shape. Exercises the
 * convex-decomposition path (a bounding box would be wrong for a star). */
function star(cx: number, cy: number, R: number, r: number, n: number) {
	const pts = []
	for (let i = 0; i < 2 * n; i++) {
		const rad = i % 2 === 0 ? R : r
		const a = (i / (2 * n)) * Math.PI * 2 - Math.PI / 2
		pts.push({ x: cx + Math.cos(a) * rad, y: cy + Math.sin(a) * rad })
	}
	return pts
}

/** A thin concave T outline (page px), like the default load: a wide crossbar,
 * a thin centred stem, a short foot. Its true area is only ~20% of its bounding
 * box, so it's the case that a bbox-ratio fallback test wrongly convex-hulls. */
function tShape(x: number, y: number) {
	const ARM = 24.7, W = 197.8, H = 382.5, STEM = 24.7, FOOT = 85.1
	const sL = (W - STEM) / 2, sR = sL + STEM
	const fL = (W - FOOT) / 2, fR = fL + FOOT, fT = H - ARM
	return [
		{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: ARM }, { x: sR, y: ARM },
		{ x: sR, y: fT }, { x: fR, y: fT }, { x: fR, y: H }, { x: fL, y: H },
		{ x: fL, y: fT }, { x: sL, y: fT }, { x: sL, y: ARM }, { x: 0, y: ARM },
	].map((p) => ({ x: p.x + x, y: p.y + y }))
}

const id = (s: string) => s as TLShapeId

describe('sim.createWorld from a WorldSpec', () => {
	it('builds a dynamic body of multiple convex fixtures from a concave star', () => {
		const spec: WorldSpec = {
			object: { id: id('s1'), outlines: [{ points: star(200, 400, 100, 45, 5), closed: true }] },
			walls: [],
		}
		const sim = createWorld(spec)
		expect(sim).not.toBeNull()
		// A 5-point star decomposes into more than one convex piece.
		expect(sim!.shape.pieces.length).toBeGreaterThan(1)
		// Body spawns near the star's centroid.
		expect(sim!.shape.spawn.x).toBeCloseTo(200, 0)
		expect(sim!.shape.spawn.y).toBeCloseTo(400, 0)
	})

	it('keeps a thin concave T concave (does NOT collapse to a convex hull)', () => {
		// Regression: the fallback that convex-hulls a failed decomposition must key
		// off the outline's OWN area, not its bounding box. A T fills only ~20% of
		// its bbox, so a bbox-ratio test would false-trigger and hull it — filling
		// the notches and breaking the puzzle. It must stay a multi-piece concave
		// body whose area is the T's true (small) area, not the fat hull's.
		const spec: WorldSpec = {
			object: { id: id('t1'), outlines: [{ points: tShape(140, 230), closed: true }] },
			walls: [],
		}
		const sim = createWorld(spec)!
		expect(sim).not.toBeNull()
		// The concave T decomposes into several convex pieces; a hull would be ~1.
		expect(sim.shape.pieces.length).toBeGreaterThan(1)
		// Total body area ≈ the T's true area (~15200 px²), FAR below the convex
		// hull's (~55000). If the hull had been used this would be way higher.
		const area = sim.shape.pieces.reduce((s, poly) => {
			let a = 0
			for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
				a += poly[j].x * poly[i].y - poly[i].x * poly[j].y
			}
			return s + Math.abs(a) / 2
		}, 0)
		expect(area).toBeLessThan(25000) // hull would be ~55k
		expect(area).toBeGreaterThan(10000) // real fill, not a sliver
	})

	it('returns null when no object is designated', () => {
		const spec: WorldSpec = { object: null, walls: [] }
		expect(createWorld(spec)).toBeNull()
	})

	it('hit-tests the object center and pulls it toward a target', () => {
		const spec: WorldSpec = {
			object: { id: id('s1'), outlines: [{ points: star(200, 400, 100, 45, 5), closed: true }] },
			walls: [{ id: id('w1'), outlines: [{ points: [{ x: 0, y: 0 }, { x: 1200, y: 0 }], closed: false }] }],
		}
		const sim = createWorld(spec)!
		const anchor = hitTestObject(sim, sim.shape.spawn)
		expect(anchor).not.toBeNull()

		const grab: Grab = { anchorLocal: anchor!, cursor: { x: 1000, y: 400 } }
		for (let i = 0; i < 60; i++) step(sim, [grab])
		const p = objPose(sim)
		// Pulled +x toward the target; stays near the same y.
		expect(p.x).toBeGreaterThan(250)
		expect(Math.abs(p.y - 400)).toBeLessThan(120)
	})

	it('does not tunnel through a solid wall under a hard drag', () => {
		// A small box object to the LEFT of a thick solid wall spanning x∈[300,360].
		// Grab it and yank hard toward a cursor on the FAR side; it must stop at the
		// wall, not pass through. (Bullet CCD + solid Polygon walls + velocity clamp.)
		const box = [
			{ x: 120, y: 380 },
			{ x: 160, y: 380 },
			{ x: 160, y: 420 },
			{ x: 120, y: 420 },
		]
		const wall = [
			{ x: 300, y: 200 },
			{ x: 360, y: 200 },
			{ x: 360, y: 600 },
			{ x: 300, y: 600 },
		]
		const spec: WorldSpec = {
			object: { id: id('o'), outlines: [{ points: box, closed: true }] },
			walls: [{ id: id('w'), outlines: [{ points: wall, closed: true }] }],
		}
		const sim = createWorld(spec)!
		const anchor = hitTestObject(sim, { x: 140, y: 400 })!
		// Cursor far past the wall — maximal pull straight into it.
		const grab: Grab = { anchorLocal: anchor, cursor: { x: 900, y: 400 } }
		for (let i = 0; i < 120; i++) step(sim, [grab])
		// The object's CENTER must remain on the near (left) side of the wall's near
		// face (x=300), minus roughly its half-width (~20px).
		expect(objPose(sim).x).toBeLessThan(300)
	})

	it('builds a solid body from an OPEN pen stroke (fills the drawn region)', () => {
		// A wiggly open stroke (closed:false) — no interior, so the sim must fill it.
		const squiggle = [
			{ x: 100, y: 400 }, { x: 140, y: 360 }, { x: 180, y: 440 },
			{ x: 220, y: 360 }, { x: 260, y: 440 }, { x: 300, y: 400 },
		]
		const spec: WorldSpec = {
			object: { id: id('o'), outlines: [{ points: squiggle, closed: false }] },
			walls: [],
		}
		const sim = createWorld(spec)
		expect(sim).not.toBeNull()
		expect(sim!.obj.getMass()).toBeGreaterThan(1)
	})

	it('builds a solid body from a self-intersecting drawn loop (hull fallback)', () => {
		// A figure-8: closed but NOT simple. Ear-clip can't fill it, so it falls
		// back to the convex hull — still a grabbable solid.
		const fig8 = [
			{ x: 100, y: 380 }, { x: 200, y: 420 }, { x: 300, y: 380 },
			{ x: 200, y: 380 }, { x: 100, y: 420 }, { x: 300, y: 420 },
		]
		const spec: WorldSpec = {
			object: { id: id('o'), outlines: [{ points: fig8, closed: true }] },
			walls: [],
		}
		const sim = createWorld(spec)
		expect(sim).not.toBeNull()
		expect(sim!.obj.getMass()).toBeGreaterThan(1)
	})

	it('gives a near-straight stroke a min-thickness bar body (not a massless flap)', () => {
		// A drawn line encloses no area; it must still become a grabbable solid.
		const line = [
			{ x: 100, y: 400 }, { x: 160, y: 401 }, { x: 220, y: 399 },
			{ x: 280, y: 400 }, { x: 340, y: 400 },
		]
		const spec: WorldSpec = {
			object: { id: id('o'), outlines: [{ points: line, closed: false }] },
			walls: [],
		}
		const sim = createWorld(spec)
		expect(sim).not.toBeNull()
		// A ~240px line × 24px thick bar has real mass — well above a sliver.
		expect(sim!.obj.getMass()).toBeGreaterThan(1)
		// Grabbing its center point hits the filled bar.
		expect(hitTestObject(sim!, sim!.shape.spawn)).not.toBeNull()
	})

	it('sums many grabs on one body (co-op/conflict mechanic)', () => {
		const spec: WorldSpec = {
			object: { id: id('s1'), outlines: [{ points: star(200, 400, 100, 45, 5), closed: true }] },
			walls: [],
		}
		const sim = createWorld(spec)!
		// Three grabs all pulling toward +x move the body farther than one would.
		const grabs: Grab[] = [
			{ anchorLocal: { x: 0, y: 1 }, cursor: { x: 900, y: 400 } },
			{ anchorLocal: { x: 1, y: 0 }, cursor: { x: 900, y: 400 } },
			{ anchorLocal: { x: -1, y: 0 }, cursor: { x: 900, y: 400 } },
		]
		for (let i = 0; i < 40; i++) step(sim, grabs)
		expect(objPose(sim).x).toBeGreaterThan(300)
	})
})
