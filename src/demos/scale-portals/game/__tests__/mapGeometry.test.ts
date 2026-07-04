/**
 * MAP GEOMETRY tests — the nesting invariant (a child map fits exactly inside a
 * parent portal room), checkerboard portals, and the child pass-through. Pure, no editor.
 */
import { describe, it, expect } from 'vitest'
import { buildMapLayout, entranceExitEdges, roomExtent } from '../mapGeometry'
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

const parent = (removeProb = 0) =>
	buildMapLayout(counter(), PARENT_W, PARENT_H, PARENT_SEED, 0, 0, PARENT_ROOM, GAP, { removeProb, role: 'parent' })

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

describe('parent map — alternating portals', () => {
	it('marks a checkerboard of portal rooms, none on the spawn, all reachable', () => {
		const layout = parent()
		expect(layout.portals.length).toBeGreaterThan(1) // several small-maps, not one at the end
		expect(layout.exitRect).toBeUndefined() // a parent has no exit marker
		for (const p of layout.portals) {
			// checkerboard parity, never the spawn room, and reachable (>=1 tunnel).
			expect((p.cell.x + p.cell.y) % 2).toBe(1)
			expect(p.cell).not.toEqual(layout.spawnCell)
			expect(p.doorDirs.length).toBeGreaterThan(0)
		}
		// Portal rooms render as normal rooms (no distinct "portal" fill / border).
		expect(layout.rects.filter((r) => r.kind === 'portal').every((r) => r.props.color === 'blue')).toBe(true)
	})
})

describe('child map — pass-through entrance + exit', () => {
	it('places entrance (spawn) and exit on the requested edges, both as orange portals', () => {
		const layout = buildMapLayout(counter(), CHILD_W, CHILD_H, CHILD_SEED, 0, 0, CHILD_ROOM, CHILD_GAP, {
			removeProb: 0.2,
			role: 'child',
			entranceEdge: 'W',
			exitEdge: 'E',
		})
		expect(layout.spawnCell.x).toBe(0) // entrance on the west edge
		expect(layout.exitCell?.x).toBe(CHILD_W - 1) // exit on the east edge
		// Two orange in/out portals — entrance and exit — and never a plain green entrance.
		expect(layout.rects.filter((r) => r.kind === 'entrance')).toHaveLength(1)
		expect(layout.rects.filter((r) => r.kind === 'exit')).toHaveLength(1)
		expect(layout.rects.filter((r) => r.kind === 'entrance' || r.kind === 'exit').every((r) => r.props.color === 'orange')).toBe(true)
		expect(layout.portals).toHaveLength(0) // a child hosts no further portals here
	})

	it('derives entrance/exit edges from a portal room’s tunnels', () => {
		expect(entranceExitEdges(['N', 'S'])).toEqual({ entrance: 'N', exit: 'S' })
		// One tunnel → exit falls back to the opposite edge, so it's still a pass-through.
		expect(entranceExitEdges(['E'])).toEqual({ entrance: 'E', exit: 'W' })
		expect(entranceExitEdges([])).toEqual({ entrance: 'W', exit: 'E' })
	})
})

describe('buildMapLayout — general', () => {
	it('is deterministic for a fixed seed', () => {
		const shape = (r: { kind: string; x: number; y: number; w: number; h: number }) => ({
			kind: r.kind,
			x: r.x,
			y: r.y,
			w: r.w,
			h: r.h,
		})
		expect(parent().rects.map(shape)).toEqual(parent().rects.map(shape))
	})

	it('positions all rects within the reported extent', () => {
		const originX = 100
		const originY = 50
		const layout = buildMapLayout(counter(), PARENT_W, PARENT_H, PARENT_SEED, originX, originY, PARENT_ROOM, GAP, {
			removeProb: 0,
			role: 'parent',
		})
		for (const r of layout.rects) {
			expect(r.x).toBeGreaterThanOrEqual(originX - 0.001)
			expect(r.y).toBeGreaterThanOrEqual(originY - 0.001)
			expect(r.x + r.w).toBeLessThanOrEqual(originX + layout.extent.w + 0.001)
			expect(r.y + r.h).toBeLessThanOrEqual(originY + layout.extent.h + 0.001)
		}
	})
})
