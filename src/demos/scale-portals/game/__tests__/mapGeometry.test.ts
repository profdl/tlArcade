/**
 * MAP GEOMETRY tests — the cell-role model: submap slots (no room behind them),
 * port-to-port tunnels that poke into slots, per-tunnel gates, and the slot-fit
 * nesting invariant. Pure, no editor.
 */
import { describe, it, expect } from 'vitest'
import { buildMapLayout, roomExtent, CHILD_ROOM_PROPS, type PageRect } from '../mapGeometry'
import {
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
	SLOT,
	SLOT_POKE,
} from '../constants'
import type { Dir } from '../../wfc/tiles'

/** Mint sequential ids so layouts are comparable without a real editor. */
function counter() {
	let n = 0
	return () => `rect-${n++}`
}

const parent = (removeProb = 0) =>
	buildMapLayout(counter(), PARENT_W, PARENT_H, PARENT_SEED, 0, 0, PARENT_ROOM, GAP, {
		removeProb,
		role: 'parent',
		slotSize: SLOT,
		slotPoke: SLOT_POKE,
	})

const child = (gateEdges: Dir[], seed = CHILD_SEED, removeProb = 0.2) =>
	buildMapLayout(counter(), CHILD_W, CHILD_H, seed, 0, 0, CHILD_ROOM, CHILD_GAP, {
		removeProb,
		role: 'child',
		gateEdges,
		roomProps: CHILD_ROOM_PROPS,
	})

const overlaps = (a: PageRect, b: PageRect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y

describe('nesting invariant', () => {
	it('scales child room AND gap by the same factor', () => {
		expect(CHILD_GAP / GAP).toBeCloseTo(CHILD_ROOM / PARENT_ROOM, 10)
	})

	it('pins the child map extent to exactly the SLOT', () => {
		const extent = roomExtent(CHILD_W, CHILD_H, CHILD_ROOM, CHILD_GAP)
		expect(extent.w).toBeCloseTo(SLOT, 6)
		expect(extent.h).toBeCloseTo(SLOT, 6)
		expect(SLOT).toBeLessThan(PARENT_ROOM)
	})
})

describe('parent world — cell roles', () => {
	it('marks a checkerboard of submap cells, never the spawn, all with tunnels', () => {
		const layout = parent()
		expect(layout.submaps.length).toBeGreaterThan(1)
		expect(layout.gates).toHaveLength(0) // parents have no gates
		for (const s of layout.submaps) {
			expect((s.cell.x + s.cell.y) % 2).toBe(1)
			expect(s.cell).not.toEqual(layout.spawnCell)
			expect(s.doorDirs.length).toBeGreaterThan(0) // reachable → at least one tunnel
			// Slot is centred in the cell footprint.
			const pitch = PARENT_ROOM + GAP
			expect(s.slotRect.x).toBeCloseTo(s.cell.x * pitch + (PARENT_ROOM - SLOT) / 2, 6)
			expect(s.slotRect.y).toBeCloseTo(s.cell.y * pitch + (PARENT_ROOM - SLOT) / 2, 6)
			expect(s.slotRect.w).toBeCloseTo(SLOT, 6)
		}
	})

	it('emits NO room rect behind a submap cell', () => {
		const layout = parent()
		for (const s of layout.submaps) {
			const roomsInCell = layout.rects.filter(
				(r) => (r.kind === 'room' || r.kind === 'gate') && overlaps(r, s.slotRect)
			)
			expect(roomsInCell).toHaveLength(0)
		}
	})

	it('runs one tunnel INTO the slot for every submap door direction', () => {
		const layout = parent()
		const doors = layout.rects.filter((r) => r.kind === 'door')
		for (const s of layout.submaps) {
			// Every doorDir must have a door rect that strictly overlaps this slot (the poke).
			const touching = doors.filter((d) => overlaps(d, s.slotRect))
			expect(touching.length).toBe(s.doorDirs.length)
		}
	})

	it('supports a pluggable role function (all-rooms → no submaps)', () => {
		const layout = buildMapLayout(counter(), PARENT_W, PARENT_H, PARENT_SEED, 0, 0, PARENT_ROOM, GAP, {
			removeProb: 0,
			role: 'parent',
			slotSize: SLOT,
			slotPoke: SLOT_POKE,
			roleFor: () => 'room',
		})
		expect(layout.submaps).toHaveLength(0)
		expect(layout.rects.filter((r) => r.kind === 'room')).toHaveLength(PARENT_W * PARENT_H)
	})
})

describe('child map — per-tunnel gates', () => {
	it('places one gate per requested edge, on that edge, distinct cells', () => {
		const combos: Dir[][] = [['W', 'E'], ['N', 'S'], ['W', 'N'], ['N', 'E'], ['S'], ['N', 'E', 'S', 'W']]
		for (const edges of combos) {
			const layout = child(edges, CHILD_SEED, 0) // full grid: every edge cell present
			expect(layout.gates).toHaveLength(edges.length)
			const seen = new Set<string>()
			for (const g of layout.gates) {
				expect(edges).toContain(g.edge)
				// On the correct edge of the grid.
				if (g.edge === 'W') expect(g.cell.x).toBe(0)
				if (g.edge === 'E') expect(g.cell.x).toBe(CHILD_W - 1)
				if (g.edge === 'N') expect(g.cell.y).toBe(0)
				if (g.edge === 'S') expect(g.cell.y).toBe(CHILD_H - 1)
				seen.add(`${g.cell.x},${g.cell.y}`)
			}
			expect(seen.size).toBe(edges.length) // all distinct
			// Gates match the rooms' colour (position at the tunnel mouth marks them, not
			// a special tint), and every rect in a child is green.
			const gateRects = layout.rects.filter((r) => r.kind === 'gate')
			expect(gateRects).toHaveLength(edges.length)
			expect(layout.rects.every((r) => r.props.color === 'light-green')).toBe(true)
		}
	})

	it('always puts gates on the edge-MIDDLE cells (tunnel centrelines), even under pruning', () => {
		// The parent tunnel meets the slot on the cell centreline; if pruning could remove
		// an edge-middle cell the gate would slide along its edge and visually disconnect
		// from the tunnel. Gate cells are protected from pruning, so across any seed the
		// gate must sit exactly at the middle of its edge.
		const combos: Dir[][] = [['W', 'E'], ['W', 'N'], ['N', 'E', 'S'], ['N', 'E', 'S', 'W']]
		const mid = { x: Math.floor((CHILD_W - 1) / 2), y: Math.floor((CHILD_H - 1) / 2) }
		const expected = (edge: Dir) =>
			edge === 'W' ? { x: 0, y: mid.y } : edge === 'E' ? { x: CHILD_W - 1, y: mid.y } : edge === 'N' ? { x: mid.x, y: 0 } : { x: mid.x, y: CHILD_H - 1 }
		for (let seed = 0; seed < 50; seed++) {
			const edges = combos[seed % combos.length]
			const layout = child(edges, seed)
			expect(layout.gates).toHaveLength(edges.length)
			const seen = new Set(layout.gates.map((g) => `${g.cell.x},${g.cell.y}`))
			expect(seen.size).toBe(edges.length)
			for (const g of layout.gates) {
				expect(g.cell).toEqual(expected(g.edge))
			}
			expect(layout.rects.filter((r) => r.kind === 'gate')).toHaveLength(edges.length)
		}
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
		const layout = parent()
		for (const r of layout.rects) {
			expect(r.x).toBeGreaterThanOrEqual(-0.001)
			expect(r.y).toBeGreaterThanOrEqual(-0.001)
			expect(r.x + r.w).toBeLessThanOrEqual(layout.extent.w + 0.001)
			expect(r.y + r.h).toBeLessThanOrEqual(layout.extent.h + 0.001)
		}
	})
})
