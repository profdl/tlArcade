/**
 * COLLISION tests — the axis-separated slide resolver and its helpers.
 */
import { describe, it, expect } from 'vitest'
import { aabbFullyInsideUnion, aabbOverlaps, resolveMove, type AABB } from '../collision'

// A single 100×100 room at the origin; player is a 10×10 box.
const room: AABB = { x: 0, y: 0, w: 100, h: 100 }
const player = (x: number, y: number): AABB => ({ x, y, w: 10, h: 10 })

describe('aabbFullyInsideUnion', () => {
	it('is true when fully inside one rect, false when a corner pokes out', () => {
		expect(aabbFullyInsideUnion(player(10, 10), [room])).toBe(true)
		expect(aabbFullyInsideUnion(player(95, 10), [room])).toBe(false)
	})

	it('accepts a box straddling two adjacent rects (a doorway)', () => {
		// Two rooms bridged by a doorway strip so the union is continuous.
		const left: AABB = { x: 0, y: 0, w: 100, h: 100 }
		const bridge: AABB = { x: 100, y: 40, w: 40, h: 20 }
		const rightRoom: AABB = { x: 140, y: 0, w: 100, h: 100 }
		const box: AABB = { x: 95, y: 45, w: 10, h: 10 } // straddles left and bridge
		expect(aabbFullyInsideUnion(box, [left, bridge, rightRoom])).toBe(true)
	})
})

describe('aabbOverlaps', () => {
	it('detects touch-level overlap (not full containment)', () => {
		expect(aabbOverlaps(player(50, 50), { x: 55, y: 55, w: 20, h: 20 })).toBe(true)
		expect(aabbOverlaps(player(0, 0), { x: 50, y: 50, w: 20, h: 20 })).toBe(false)
	})
})

describe('resolveMove', () => {
	it('moves freely when the destination stays inside the room', () => {
		const r = resolveMove(player(45, 45), 5, 5, [room])
		expect(r).toEqual({ x: 50, y: 50 })
	})

	it('stops the blocked axis at a wall but keeps the free axis (slide)', () => {
		// Hugging the right wall (x can't grow past 90) but moving down-right: x blocked, y slides.
		const r = resolveMove(player(90, 45), 10, 10, [room])
		expect(r.x).toBe(90) // blocked by right wall
		expect(r.y).toBe(55) // slid down
	})

	it('blocks both axes moving diagonally into a corner', () => {
		const r = resolveMove(player(90, 90), 10, 10, [room])
		expect(r).toEqual({ x: 90, y: 90 })
	})

	it('passes through a doorway gap between two rooms', () => {
		const left: AABB = { x: 0, y: 0, w: 100, h: 100 }
		const bridge: AABB = { x: 100, y: 40, w: 40, h: 20 }
		const rightRoom: AABB = { x: 140, y: 0, w: 100, h: 100 }
		const walkable = [left, bridge, rightRoom]
		// Start at the doorway mouth, move right along the bridge.
		const box: AABB = { x: 88, y: 45, w: 10, h: 10 }
		const r = resolveMove(box, 10, 0, walkable)
		expect(r.x).toBe(98) // advanced into the doorway
	})
})
