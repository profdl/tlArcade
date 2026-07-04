/**
 * VALIDATE WORLD tests — the "new map every start", nested-to-MAX_DEPTH guarantee.
 * ================================================================================
 * The game rolls a random world seed each start and nests the world several scales
 * deep, so the gate↔tunnel connection invariants must hold for ANY seed, at EVERY
 * depth — not just the ones we've eyeballed. This suite builds FULL nested worlds
 * (root + every descendant, using the exact production parameters and the same
 * childSeedFor/roomAtDepth derivations gameLoop uses) across hundreds of seeds and
 * asserts validateWorldTree finds nothing.
 *
 * It also proves the validator isn't vacuously green: deliberately broken worlds
 * (a moved gate, a missing gate) must be flagged.
 */
import { describe, it, expect } from 'vitest'
import { buildMapLayout, childSeedFor, CHILD_ROOM_PROPS, type MapLayout, type SubmapInfo } from '../mapGeometry'
import { validateWorldTree, type WorldNode } from '../validateWorld'
import {
	CHILD_FILL,
	CHILD_H,
	CHILD_REMOVE_PROB,
	CHILD_SCALE,
	CHILD_W,
	GAP,
	gapAtDepth,
	MAX_DEPTH,
	PARENT_H,
	PARENT_REMOVE_PROB,
	PARENT_ROOM,
	PARENT_W,
	roomAtDepth,
	SLOT,
	SLOT_POKE,
} from '../constants'

function counter() {
	let n = 0
	return () => `rect-${n++}`
}

/** Build one child map + its recursive subtree, exactly the way registerGame does. */
function buildNode(worldSeed: number, submap: SubmapInfo, depth: number): WorldNode<string> {
	const isHost = depth < MAX_DEPTH
	const roomSize = roomAtDepth(depth)
	const gap = gapAtDepth(depth)
	const layout = buildMapLayout(
		counter(),
		CHILD_W,
		CHILD_H,
		childSeedFor(worldSeed, submap.cell, depth),
		submap.slotRect.x,
		submap.slotRect.y,
		roomSize,
		gap,
		{
			removeProb: CHILD_REMOVE_PROB,
			hasSlots: isHost,
			gateEdges: submap.doorDirs,
			roomProps: CHILD_ROOM_PROPS,
			...(isHost ? { slotSize: roomSize * CHILD_FILL, slotPoke: SLOT_POKE * CHILD_SCALE ** depth } : {}),
		}
	)
	const children = isHost ? layout.submaps.map((s) => buildNode(worldSeed, s, depth + 1)) : []
	return { submap, layout, children }
}

/** Build a full nested world exactly the way registerGame does (same params, same seeds). */
function buildWorld(worldSeed: number): { root: MapLayout<string>; tree: WorldNode<string>[] } {
	const root = buildMapLayout(counter(), PARENT_W, PARENT_H, worldSeed, 0, 0, PARENT_ROOM, GAP, {
		removeProb: PARENT_REMOVE_PROB,
		hasSlots: true,
		slotSize: SLOT,
		slotPoke: SLOT_POKE,
	})
	const tree = root.submaps.map((submap) => buildNode(worldSeed, submap, 1))
	return { root, tree }
}

const childGrid = { w: CHILD_W, h: CHILD_H }

/** Deepest depth actually present in a built tree (0 = root only). */
function treeDepth(tree: WorldNode<string>[]): number {
	if (tree.length === 0) return 0
	return 1 + Math.max(...tree.map((n) => treeDepth(n.children)))
}

describe('validateWorldTree — every generated world connects correctly at every scale', () => {
	it('finds zero violations across 300 random-style world seeds', () => {
		for (let seed = 0; seed < 300; seed++) {
			// Spread seeds across the 32-bit space, not just tiny ints, to mimic randomWorldSeed.
			const worldSeed = (seed * 0x9e3779b9 + seed) >>> 0
			const { root, tree } = buildWorld(worldSeed)
			const violations = validateWorldTree(root, tree, childGrid)
			expect(violations, `seed ${worldSeed}: ${violations.join('; ')}`).toEqual([])
			// And the world is non-trivial: it has submaps, each with at least one gate.
			expect(root.submaps.length).toBeGreaterThan(0)
			expect(tree.every((c) => c.layout.gates.length > 0)).toBe(true)
		}
	})

	it('actually nests MAX_DEPTH scales deep (not just 1)', () => {
		const { tree } = buildWorld(42)
		expect(treeDepth(tree)).toBe(MAX_DEPTH)
		expect(MAX_DEPTH).toBeGreaterThanOrEqual(2)
	})

	it('is deterministic: the same seed builds the same world twice', () => {
		const a = buildWorld(123456789)
		const b = buildWorld(123456789)
		const strip = (l: MapLayout<string>) => l.rects.map((r) => ({ kind: r.kind, x: r.x, y: r.y, w: r.w, h: r.h }))
		expect(strip(a.root)).toEqual(strip(b.root))
		const flatten = (t: WorldNode<string>[]): MapLayout<string>[] =>
			t.flatMap((n) => [n.layout, ...flatten(n.children)])
		const fa = flatten(a.tree)
		const fb = flatten(b.tree)
		expect(fa.length).toBe(fb.length)
		fa.forEach((l, i) => expect(strip(l)).toEqual(strip(fb[i])))
	})

	it('different seeds build different worlds', () => {
		const a = buildWorld(1)
		const b = buildWorld(2)
		const strip = (l: MapLayout<string>) => l.rects.map((r) => ({ kind: r.kind, x: r.x, y: r.y }))
		// Root grids of different seeds virtually never match exactly (doors differ).
		expect(strip(a.root)).not.toEqual(strip(b.root))
	})
})

describe('validateWorldTree — catches broken worlds (not vacuously green)', () => {
	it('flags a gate moved off its tunnel', () => {
		const { root, tree } = buildWorld(42)
		const broken = structuredClone(tree)
		// Shove the first child's first gate rect far away from any tunnel.
		broken[0].layout.gates[0].rect = { x: -9999, y: -9999, w: 10, h: 10 }
		const violations = validateWorldTree(root, broken, childGrid)
		expect(violations.some((v) => v.includes('does not touch any tunnel'))).toBe(true)
	})

	it('flags a missing gate (tunnel with no matching portal)', () => {
		const { root, tree } = buildWorld(42)
		const broken = structuredClone(tree)
		broken[0].layout.gates.pop()
		const violations = validateWorldTree(root, broken, childGrid)
		expect(violations.some((v) => v.includes("don't match tunnels"))).toBe(true)
	})

	it('flags a missing OUT portal-doorway (a gate with no dive-out trigger)', () => {
		const { root, tree } = buildWorld(42)
		const broken = structuredClone(tree)
		const idx = broken[0].layout.portals.findIndex((p) => p.kind === 'out')
		expect(idx, 'expected the depth-1 child to have an OUT doorway').toBeGreaterThanOrEqual(0)
		broken[0].layout.portals.splice(idx, 1)
		const violations = validateWorldTree(root, broken, childGrid)
		expect(violations.some((v) => v.includes('OUT doorways'))).toBe(true)
	})

	it('flags a gate off the edge-middle (disconnected from the tunnel centreline)', () => {
		const { root, tree } = buildWorld(42)
		const broken = structuredClone(tree)
		broken[0].layout.gates[0].cell = { x: 0, y: 0 } // a corner, never an edge-middle on 3x3
		const violations = validateWorldTree(root, broken, childGrid)
		expect(violations.some((v) => v.includes('expected edge-middle'))).toBe(true)
	})

	it('catches a broken gate at a DEEP scale, not just depth 1', () => {
		const { root, tree } = buildWorld(42)
		const broken = structuredClone(tree)
		// Find a node with children (a host), then break one of its grandchildren's gates.
		const host = broken.find((n) => n.children.length > 0)
		expect(host, 'expected at least one host node with children').toBeDefined()
		host!.children[0].layout.gates[0].rect = { x: -9999, y: -9999, w: 10, h: 10 }
		const violations = validateWorldTree(root, broken, childGrid)
		expect(violations.some((v) => v.includes('does not touch any tunnel'))).toBe(true)
	})
})
