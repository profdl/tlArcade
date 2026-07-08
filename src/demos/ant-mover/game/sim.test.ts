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
