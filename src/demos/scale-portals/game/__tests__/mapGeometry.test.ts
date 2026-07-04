/**
 * MAP GEOMETRY tests — the cell-role model: submap slots (no room behind them),
 * port-to-port tunnels that poke into slots, per-tunnel gates, and the slot-fit
 * nesting invariant. Pure, no editor.
 */
import { describe, it, expect } from 'vitest'
import {
	buildMapLayout,
	roomExtent,
	colorForDepth,
	roomPropsForDepth,
	CHILD_ROOM_PROPS,
	PORTAL_IN_REACH,
	PORTAL_IN_CROSS,
	PORTAL_OUT_REACH,
	PORTAL_OUT_CROSS,
	type PageRect,
} from '../mapGeometry'
import {
	CHILD_GAP,
	CHILD_H,
	CHILD_ROOM,
	CHILD_SEED,
	CHILD_W,
	GAP,
	MAX_DEPTH,
	PARENT_H,
	PARENT_ROOM,
	PARENT_SEED,
	PARENT_W,
	PLAYER_FRACTION,
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
		hasSlots: true,
		slotSize: SLOT,
		slotPoke: SLOT_POKE,
	})

// A LEAF child: gates, no slots (the deepest scale).
const child = (gateEdges: Dir[], seed = CHILD_SEED, removeProb = 0.2) =>
	buildMapLayout(counter(), CHILD_W, CHILD_H, seed, 0, 0, CHILD_ROOM, CHILD_GAP, {
		removeProb,
		hasSlots: false,
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
	it('marks a seeded spread of submap cells, never the spawn, all with tunnels', () => {
		const layout = parent()
		expect(layout.submaps.length).toBeGreaterThan(1)
		expect(layout.gates).toHaveLength(0) // parents have no gates
		for (const s of layout.submaps) {
			// No parity rule any more: any present cell can be a submap, EXCEPT the spawn.
			expect(s.cell).not.toEqual(layout.spawnCell)
			expect(s.doorDirs.length).toBeGreaterThan(0) // reachable → at least one tunnel
			// Slot is centred in the cell footprint.
			const pitch = PARENT_ROOM + GAP
			expect(s.slotRect.x).toBeCloseTo(s.cell.x * pitch + (PARENT_ROOM - SLOT) / 2, 6)
			expect(s.slotRect.y).toBeCloseTo(s.cell.y * pitch + (PARENT_ROOM - SLOT) / 2, 6)
			expect(s.slotRect.w).toBeCloseTo(SLOT, 6)
		}
	})

	it('is deterministic in the seed, and a different seed can give a different pattern', () => {
		const key = (l: ReturnType<typeof parent>) => l.submaps.map((s) => `${s.cell.x},${s.cell.y}`).sort().join('|')
		// Same seed → identical role pattern (one world seed reproduces the whole world).
		expect(key(parent())).toEqual(key(parent()))
		// Sweep seeds: at least one differs from PARENT_SEED's pattern (roles track the seed).
		const base = key(parent())
		const differs = Array.from({ length: 20 }, (_, i) =>
			buildMapLayout(counter(), PARENT_W, PARENT_H, i + 100, 0, 0, PARENT_ROOM, GAP, {
				removeProb: 0,
				hasSlots: true,
				slotSize: SLOT,
				slotPoke: SLOT_POKE,
			})
		).some((l) => l.submaps.map((s) => `${s.cell.x},${s.cell.y}`).sort().join('|') !== base)
		expect(differs).toBe(true)
	})

	it('submapProb tunes the coin flip: 0 → all rooms, 1 → every non-spawn cell a submap', () => {
		const build = (submapProb: number) =>
			buildMapLayout(counter(), PARENT_W, PARENT_H, PARENT_SEED, 0, 0, PARENT_ROOM, GAP, {
				removeProb: 0,
				hasSlots: true,
				slotSize: SLOT,
				slotPoke: SLOT_POKE,
				submapProb,
			})
		expect(build(0).submaps).toHaveLength(0)
		const all = build(1)
		// removeProb 0 → full 3x3 grid; every cell but the spawn is a submap.
		expect(all.submaps).toHaveLength(PARENT_W * PARENT_H - 1)
		for (const s of all.submaps) expect(s.cell).not.toEqual(all.spawnCell)
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
			hasSlots: true,
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
			// Gates inherit the map's own roomProps colour (position at the tunnel mouth
			// marks them, not a special tint), so a whole map reads as ONE colour —
			// except portal-doorways, which are deliberately orange markers.
			const gateRects = layout.rects.filter((r) => r.kind === 'gate')
			expect(gateRects).toHaveLength(edges.length)
			expect(layout.rects.filter((r) => r.kind !== 'portal').every((r) => r.props.color === 'light-green')).toBe(true)
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

describe('intermediate map — host AND guest (slots + gates together)', () => {
	it('a hasSlots map with gateEdges emits BOTH submap slots and gates', () => {
		// This is what makes 3+ scales possible: an intermediate map hosts deeper maps
		// (submap slots) while itself being a child of the level above (gates).
		const layout = buildMapLayout(counter(), CHILD_W, CHILD_H, CHILD_SEED, 0, 0, CHILD_ROOM, CHILD_GAP, {
			removeProb: 0,
			hasSlots: true,
			slotSize: CHILD_ROOM * 0.82,
			slotPoke: SLOT_POKE,
			gateEdges: ['W', 'E'],
			roomProps: CHILD_ROOM_PROPS,
		})
		expect(layout.submaps.length).toBeGreaterThan(0) // it's a host
		expect(layout.gates.length).toBe(2) // it's also a guest
		// A submap cell never also carries a gate (gates are rooms; submaps have no room).
		const gateCells = new Set(layout.gates.map((g) => `${g.cell.x},${g.cell.y}`))
		for (const s of layout.submaps) expect(gateCells.has(`${s.cell.x},${s.cell.y}`)).toBe(false)
	})
})

describe('per-depth colour palette (one colour per zoom level)', () => {
	it('gives every depth a DISTINCT colour', () => {
		const colors = Array.from({ length: MAX_DEPTH + 1 }, (_, d) => colorForDepth(d, MAX_DEPTH))
		expect(new Set(colors).size).toBe(colors.length)
	})

	it('paints the root blue and the smallest (leaf) scale light-red', () => {
		expect(colorForDepth(0, MAX_DEPTH)).toBe('blue')
		expect(colorForDepth(MAX_DEPTH, MAX_DEPTH)).toBe('light-red')
		// The leaf is light-red regardless of how deep the world goes.
		expect(colorForDepth(4, 4)).toBe('light-red')
		expect(colorForDepth(1, 1)).toBe('light-red')
	})

	it('roomPropsForDepth carries that colour through to a built map (rooms AND gates)', () => {
		const layout = buildMapLayout(counter(), CHILD_W, CHILD_H, CHILD_SEED, 0, 0, CHILD_ROOM, CHILD_GAP, {
			removeProb: 0,
			hasSlots: false,
			gateEdges: ['W', 'E'],
			roomProps: roomPropsForDepth(MAX_DEPTH, MAX_DEPTH), // the leaf scale
		})
		expect(layout.rects.length).toBeGreaterThan(0)
		// Every non-portal rect takes the depth colour; portal-doorways are orange markers.
		expect(layout.rects.filter((r) => r.kind !== 'portal').every((r) => r.props.color === 'light-red')).toBe(true)
	})
})

describe('portal-doorways (dive triggers on the boundary, not the whole slot/gate)', () => {
	it('host emits one IN doorway per submap tunnel, carrying its submap; no OUT doorways', () => {
		const layout = parent()
		const inn = layout.portals.filter((p) => p.kind === 'in')
		const expected = layout.submaps.reduce((n, s) => n + s.doorDirs.length, 0)
		expect(inn).toHaveLength(expected)
		for (const p of inn) {
			expect(p.submap).toBeDefined()
			expect(p.submap!.doorDirs).toContain(p.dir)
		}
		expect(layout.portals.some((p) => p.kind === 'out')).toBe(false) // parents are host-only
	})

	it('guest (leaf) emits one OUT doorway per gate edge; no IN doorways', () => {
		const layout = child(['W', 'E'], CHILD_SEED, 0)
		const out = layout.portals.filter((p) => p.kind === 'out')
		expect(out.map((p) => p.dir).sort()).toEqual(['E', 'W'])
		expect(layout.portals.some((p) => p.kind === 'in')).toBe(false) // leaves are guest-only
	})

	it('draws every doorway as an orange rect of kind "portal"', () => {
		const layout = child(['W', 'E'], CHILD_SEED, 0)
		const portalRects = layout.rects.filter((r) => r.kind === 'portal')
		expect(portalRects).toHaveLength(layout.portals.length)
		expect(portalRects.every((r) => r.props.color === 'orange')).toBe(true)
	})

	it('every IN doorway overlaps a host tunnel, so it is reachable by walking the tunnel', () => {
		const layout = parent()
		const tunnels = layout.rects.filter((r) => r.kind === 'door')
		for (const p of layout.portals.filter((p) => p.kind === 'in')) {
			expect(tunnels.some((t) => overlaps(t, p.rect))).toBe(true)
		}
	})

	it('every OUT doorway straddles the gate edge but keeps its CENTRE inside the gate room (walkable landing)', () => {
		const layout = child(['W', 'E', 'N', 'S'], CHILD_SEED, 0)
		const inside = (px: number, py: number, r: PageRect) =>
			px >= r.x - 0.001 && px <= r.x + r.w + 0.001 && py >= r.y - 0.001 && py <= r.y + r.h + 0.001
		// The dive lands the player centred on the doorway; the whole player box must clear
		// the non-walkable boundary AND have slack to step off (to re-arm the exit trigger).
		// So the centre must sit at least a player half-width inside the gate room on the
		// axis normal to the gate edge. This guards the REACH − CROSS > PLAYER_FRACTION bound.
		const half = (CHILD_ROOM * PLAYER_FRACTION) / 2
		for (const p of layout.portals.filter((p) => p.kind === 'out')) {
			const gate = layout.gates.find((g) => g.edge === p.dir)!
			const c = { x: p.hit.x + p.hit.w / 2, y: p.hit.y + p.hit.h / 2 }
			expect(inside(c.x, c.y, gate.rect)).toBe(true) // centre is walkable gate floor
			expect(overlaps(p.rect, gate.rect)).toBe(true) // and the doorway meets the gate
			// Distance from the centre INWARD past the straddled boundary edge (the wall on side
			// `dir`) must clear a half-player, so the landed box sits fully on walkable floor.
			const clearance =
				p.dir === 'W'
					? c.x - gate.rect.x
					: p.dir === 'E'
						? gate.rect.x + gate.rect.w - c.x
						: p.dir === 'N'
							? c.y - gate.rect.y
							: gate.rect.y + gate.rect.h - c.y
			expect(clearance).toBeGreaterThan(half)
		}
	})

	// Both doorway size sets are landing targets (OUT on dive-in, IN on dive-out), so both
	// must keep the landed player clear of the boundary: the centre sits (REACH − CROSS)/2
	// inside, and that must exceed a player half-width — i.e. REACH − CROSS > PLAYER_FRACTION.
	// Guards the IN set directly (its landing floor is a hallway tunnel, not one gate rect).
	it('both doorway size sets satisfy the walkable-landing clearance bound', () => {
		expect(PORTAL_IN_REACH - PORTAL_IN_CROSS).toBeGreaterThan(PLAYER_FRACTION)
		expect(PORTAL_OUT_REACH - PORTAL_OUT_CROSS).toBeGreaterThan(PLAYER_FRACTION)
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
