/**
 * VALIDATE WORLD tests — the "new map every start" guarantee.
 * ============================================================
 * The game rolls a random world seed each start, so the gate↔tunnel connection
 * invariants must hold for ANY seed, not just the ones we've eyeballed. This suite
 * builds FULL worlds (parent + every child, using the exact production parameters
 * and the same childSeedFor derivation gameLoop uses) across hundreds of seeds and
 * asserts validateWorld finds nothing.
 *
 * It also proves the validator isn't vacuously green: deliberately broken worlds
 * (a moved gate, a missing gate) must be flagged.
 */
import { describe, it, expect } from 'vitest'
import { buildMapLayout, childSeedFor, CHILD_ROOM_PROPS, type MapLayout, type SubmapInfo } from '../mapGeometry'
import { validateWorld, type WorldChild } from '../validateWorld'
import {
	CHILD_GAP,
	CHILD_H,
	CHILD_REMOVE_PROB,
	CHILD_ROOM,
	CHILD_W,
	GAP,
	PARENT_H,
	PARENT_REMOVE_PROB,
	PARENT_ROOM,
	PARENT_W,
	SLOT,
	SLOT_POKE,
} from '../constants'

function counter() {
	let n = 0
	return () => `rect-${n++}`
}

/** Build a full world exactly the way registerGame does (same params, same seeds). */
function buildWorld(worldSeed: number): { parent: MapLayout<string>; children: WorldChild<string>[] } {
	const parent = buildMapLayout(counter(), PARENT_W, PARENT_H, worldSeed, 0, 0, PARENT_ROOM, GAP, {
		removeProb: PARENT_REMOVE_PROB,
		role: 'parent',
		slotSize: SLOT,
		slotPoke: SLOT_POKE,
	})
	const children = parent.submaps.map((submap: SubmapInfo) => ({
		submap,
		layout: buildMapLayout(
			counter(),
			CHILD_W,
			CHILD_H,
			childSeedFor(worldSeed, submap.cell),
			submap.slotRect.x,
			submap.slotRect.y,
			CHILD_ROOM,
			CHILD_GAP,
			{ removeProb: CHILD_REMOVE_PROB, role: 'child', gateEdges: submap.doorDirs, roomProps: CHILD_ROOM_PROPS }
		),
	}))
	return { parent, children }
}

const childGrid = { w: CHILD_W, h: CHILD_H }

describe('validateWorld — every generated world connects correctly', () => {
	it('finds zero violations across 300 random-style world seeds', () => {
		for (let seed = 0; seed < 300; seed++) {
			// Spread seeds across the 32-bit space, not just tiny ints, to mimic randomWorldSeed.
			const worldSeed = (seed * 0x9e3779b9 + seed) >>> 0
			const { parent, children } = buildWorld(worldSeed)
			const violations = validateWorld(parent, children, childGrid)
			expect(violations, `seed ${worldSeed}: ${violations.join('; ')}`).toEqual([])
			// And the world is non-trivial: it has submaps, each with at least one gate.
			expect(parent.submaps.length).toBeGreaterThan(0)
			expect(children.every((c) => c.layout.gates.length > 0)).toBe(true)
		}
	})

	it('is deterministic: the same seed builds the same world twice', () => {
		const a = buildWorld(123456789)
		const b = buildWorld(123456789)
		const strip = (l: MapLayout<string>) => l.rects.map((r) => ({ kind: r.kind, x: r.x, y: r.y, w: r.w, h: r.h }))
		expect(strip(a.parent)).toEqual(strip(b.parent))
		a.children.forEach((c, i) => expect(strip(c.layout)).toEqual(strip(b.children[i].layout)))
	})

	it('different seeds build different worlds', () => {
		const a = buildWorld(1)
		const b = buildWorld(2)
		const strip = (l: MapLayout<string>) => l.rects.map((r) => ({ kind: r.kind, x: r.x, y: r.y }))
		// Parent grids of different seeds virtually never match exactly (doors differ).
		expect(strip(a.parent)).not.toEqual(strip(b.parent))
	})
})

describe('validateWorld — catches broken worlds (not vacuously green)', () => {
	it('flags a gate moved off its tunnel', () => {
		const { parent, children } = buildWorld(42)
		const broken = structuredClone(children)
		// Shove the first gate rect far away from any tunnel.
		broken[0].layout.gates[0].rect = { x: -9999, y: -9999, w: 10, h: 10 }
		const violations = validateWorld(parent, broken, childGrid)
		expect(violations.some((v) => v.includes('does not touch any tunnel'))).toBe(true)
	})

	it('flags a missing gate (tunnel with no matching portal)', () => {
		const { parent, children } = buildWorld(42)
		const broken = structuredClone(children)
		broken[0].layout.gates.pop()
		const violations = validateWorld(parent, broken, childGrid)
		expect(violations.some((v) => v.includes("don't match tunnels"))).toBe(true)
	})

	it('flags a gate off the edge-middle (disconnected from the tunnel centreline)', () => {
		const { parent, children } = buildWorld(42)
		const broken = structuredClone(children)
		broken[0].layout.gates[0].cell = { x: 0, y: 0 } // a corner, never an edge-middle on 3x3
		const violations = validateWorld(parent, broken, childGrid)
		expect(violations.some((v) => v.includes('expected edge-middle'))).toBe(true)
	})
})
