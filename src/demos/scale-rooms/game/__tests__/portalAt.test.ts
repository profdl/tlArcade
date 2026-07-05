/**
 * portalAt tests — the dive IN/OUT/none decision on a room's doorways (PURE, no editor).
 * A non-root room carries one 'out' doorway plus one 'in' per child; 'out' wins ties.
 */
import { describe, it, expect } from 'vitest'
import { portalAt } from '../gameLoop'
import type { RoomLayout } from '../roomTree'
import type { AABB } from '../collision'

function layout(): RoomLayout<string> {
	return {
		roomRect: { x: 0, y: 0, w: 100, h: 100 },
		extent: { w: 100, h: 100 },
		rects: [],
		portals: [
			{ kind: 'out', edge: 'E', hit: { x: 80, y: 40, w: 20, h: 20 } },
			{ kind: 'in', edge: 'W', hit: { x: 10, y: 40, w: 20, h: 20 }, childKey: 'c1' },
		],
	}
}

const at = (x: number, y: number): AABB => ({ x, y, w: 6, h: 6 })

describe('portalAt', () => {
	it('reports the IN doorway when the player overlaps it (and carries the child key)', () => {
		const hit = portalAt(layout(), at(12, 42))
		expect(hit.kind).toBe('in')
		if (hit.kind === 'in') expect(hit.portal.childKey).toBe('c1')
	})

	it('reports the OUT doorway when the player overlaps it', () => {
		expect(portalAt(layout(), at(82, 42)).kind).toBe('out')
	})

	it('reports none on plain floor', () => {
		expect(portalAt(layout(), at(50, 50)).kind).toBe('none')
	})

	it('does NOT fire when the player only GRAZES a door edge (centre still off it)', () => {
		// The IN hit is x 10–30. A box at x=6 (its right edge at 12) overlaps the door, but its
		// centre (x=9) is still short of the door's near edge (x=10) — i.e. the player is walking
		// up to the wall out on parent floor, not yet standing on the visible leaf. Must be 'none'
		// (the old aabbOverlaps test fired here, teleporting the player before it touched the door).
		expect(portalAt(layout(), at(6, 42)).kind).toBe('none')
		// Step one unit further so the centre (x=10) reaches the door: now it fires.
		expect(portalAt(layout(), at(7, 42)).kind).toBe('in')
	})

	it("'out' wins when the player overlaps both an IN and an OUT doorway", () => {
		const l = layout()
		// Overlap the IN and OUT hits on the same spot, then stand on it.
		l.portals[1].hit = { x: 80, y: 40, w: 20, h: 20 }
		expect(portalAt(l, at(82, 42)).kind).toBe('out')
	})
})
