/**
 * MAP GEOMETRY tests — the nesting invariant (a child map fits exactly inside a
 * parent portal room) and basic layout sanity. Pure, no editor.
 */
import { describe, it, expect } from 'vitest'
import { buildMapLayout, roomExtent } from '../mapGeometry'
import {
	CHILD_FILL,
	CHILD_GAP,
	CHILD_H,
	CHILD_ROOM,
	CHILD_SEED,
	CHILD_W,
	GAP,
	PARENT_H,
	PARENT_ROOM,
	PARENT_SEED,
	PARENT_W,
} from '../constants'

/** Mint sequential ids so layouts are comparable without a real editor. */
function counter() {
	let n = 0
	return () => `rect-${n++}`
}

describe('nesting invariant', () => {
	it('scales child room AND gap by the same factor', () => {
		// If only roomSize scaled, this ratio would differ — the classic bug.
		expect(CHILD_GAP / GAP).toBeCloseTo(CHILD_ROOM / PARENT_ROOM, 10)
	})

	it('makes the child map fill exactly CHILD_FILL of a parent room, and fit inside it', () => {
		const child = roomExtent(CHILD_W, CHILD_H, CHILD_ROOM, CHILD_GAP)
		expect(child.w).toBeCloseTo(PARENT_ROOM * CHILD_FILL, 6)
		expect(child.h).toBeCloseTo(PARENT_ROOM * CHILD_FILL, 6)
		expect(child.w).toBeLessThanOrEqual(PARENT_ROOM)
		expect(child.h).toBeLessThanOrEqual(PARENT_ROOM)
	})
})

describe('buildMapLayout', () => {
	it('emits a portal marker in the parent map, distinct from spawn', () => {
		const layout = buildMapLayout(counter(), PARENT_W, PARENT_H, PARENT_SEED, 0, 0, PARENT_ROOM, GAP, {
			removeProb: 0,
			special: 'portal',
		})
		expect(layout.special).toBe('portal')
		expect(layout.rects.filter((r) => r.kind === 'portal')).toHaveLength(1)
		// Portal is the farthest present cell from spawn, so they must differ on a full grid.
		expect(layout.specialCell).not.toEqual(layout.spawnCell)
	})

	it('puts the child exit marker on the spawn cell', () => {
		const layout = buildMapLayout(counter(), CHILD_W, CHILD_H, CHILD_SEED, 0, 0, CHILD_ROOM, CHILD_GAP, {
			removeProb: 0.2,
			special: 'exit',
		})
		expect(layout.special).toBe('exit')
		expect(layout.rects.filter((r) => r.kind === 'exit')).toHaveLength(1)
		expect(layout.specialCell).toEqual(layout.spawnCell)
	})

	it('places the exit on the requested edge so it faces the parent tunnel', () => {
		// exitEdge:'W' → exit must be in column x=0; the player spawns there too so it
		// emerges at the tunnel seam. 'E' → column x=width-1.
		const west = buildMapLayout(counter(), CHILD_W, CHILD_H, CHILD_SEED, 0, 0, CHILD_ROOM, CHILD_GAP, {
			removeProb: 0.2,
			special: 'exit',
			exitEdge: 'W',
		})
		expect(west.specialCell.x).toBe(0)
		expect(west.spawnCell).toEqual(west.specialCell)

		const east = buildMapLayout(counter(), CHILD_W, CHILD_H, CHILD_SEED, 0, 0, CHILD_ROOM, CHILD_GAP, {
			removeProb: 0.2,
			special: 'exit',
			exitEdge: 'E',
		})
		expect(east.specialCell.x).toBe(CHILD_W - 1)
	})

	it('reports the door directions of the special cell (the tunnel sides)', () => {
		const layout = buildMapLayout(counter(), PARENT_W, PARENT_H, PARENT_SEED, 0, 0, PARENT_ROOM, GAP, {
			removeProb: 0,
			special: 'portal',
		})
		// The portal is reachable, so it has at least one door to a present neighbour.
		expect(layout.specialDoorDirs.length).toBeGreaterThan(0)
		expect(layout.specialDoorDirs.every((d) => ['N', 'E', 'S', 'W'].includes(d))).toBe(true)
	})

	it('is deterministic for a fixed seed', () => {
		const a = buildMapLayout(counter(), PARENT_W, PARENT_H, PARENT_SEED, 0, 0, PARENT_ROOM, GAP, { removeProb: 0, special: 'portal' })
		const b = buildMapLayout(counter(), PARENT_W, PARENT_H, PARENT_SEED, 0, 0, PARENT_ROOM, GAP, { removeProb: 0, special: 'portal' })
		expect(a.rects.map((r) => ({ kind: r.kind, x: r.x, y: r.y, w: r.w, h: r.h }))).toEqual(
			b.rects.map((r) => ({ kind: r.kind, x: r.x, y: r.y, w: r.w, h: r.h }))
		)
	})

	it('positions all rects within the reported extent', () => {
		const originX = 100
		const originY = 50
		const layout = buildMapLayout(counter(), PARENT_W, PARENT_H, PARENT_SEED, originX, originY, PARENT_ROOM, GAP, {
			removeProb: 0,
			special: 'portal',
		})
		for (const r of layout.rects) {
			expect(r.x).toBeGreaterThanOrEqual(originX - 0.001)
			expect(r.y).toBeGreaterThanOrEqual(originY - 0.001)
			expect(r.x + r.w).toBeLessThanOrEqual(originX + layout.extent.w + 0.001)
			expect(r.y + r.h).toBeLessThanOrEqual(originY + layout.extent.h + 0.001)
		}
	})
})
