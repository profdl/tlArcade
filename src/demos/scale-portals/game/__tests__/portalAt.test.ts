/**
 * PORTAL DECISION tests — the dive IN / dive OUT / none decision the tick loop makes.
 * ===================================================================================
 * Regression guard for the bug where an INTERMEDIATE map (both gates AND submap slots)
 * only ever dove OUT: the tick loop used "gates XOR slots", so a level with gates never
 * had its slots checked, and the light-red maps nested inside it were unreachable. The
 * decision is pure (portalAt), so we can test it directly without an editor.
 */
import { describe, it, expect } from 'vitest'
import { portalAt } from '../gameLoop'
import { buildMapLayout, roomPropsForDepth, type MapLayout } from '../mapGeometry'
import type { AABB } from '../collision'
import {
	CHILD_FILL,
	CHILD_H,
	CHILD_SCALE,
	CHILD_W,
	MAX_DEPTH,
	SLOT_POKE,
	gapAtDepth,
	roomAtDepth,
} from '../constants'

function counter() {
	let n = 0
	return () => `rect-${n++}`
}

/** A tiny AABB centred on a page point (small enough to sit inside one slot/gate rect). */
function playerAt(cx: number, cy: number, size = 4): AABB {
	return { x: cx - size / 2, y: cy - size / 2, w: size, h: size }
}
const centre = (r: { x: number; y: number; w: number; h: number }) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })

/** Build an INTERMEDIATE map: it is a guest (gates on both W and E) AND a host (slots). */
function intermediate(seed: number): MapLayout<string> {
	const depth = 1
	return buildMapLayout(counter(), CHILD_W, CHILD_H, seed, 0, 0, roomAtDepth(depth), gapAtDepth(depth), {
		removeProb: 0,
		hasSlots: true,
		gateEdges: ['W', 'E'],
		slotSize: roomAtDepth(depth) * CHILD_FILL,
		slotPoke: SLOT_POKE * CHILD_SCALE ** depth,
		roomProps: roomPropsForDepth(depth, MAX_DEPTH),
	})
}

describe('portalAt — an intermediate map can dive BOTH out and in', () => {
	it('dives OUT when the player stands on a gate', () => {
		const layout = intermediate(1)
		expect(layout.gates.length).toBeGreaterThan(0)
		const g = layout.gates[0]
		const hit = portalAt(layout, playerAt(centre(g.rect).x, centre(g.rect).y))
		expect(hit.kind).toBe('out')
		if (hit.kind === 'out') expect(hit.gate.edge).toBe(g.edge)
	})

	it('dives IN when the player reaches a submap slot (THE bug: not masked by having gates)', () => {
		const layout = intermediate(1)
		expect(layout.submaps.length).toBeGreaterThan(0) // it's a host too
		const s = layout.submaps[0]
		const hit = portalAt(layout, playerAt(centre(s.slotRect).x, centre(s.slotRect).y))
		expect(hit.kind).toBe('in')
		if (hit.kind === 'in') expect(hit.submap.cell).toEqual(s.cell)
	})

	it('returns none in open floor (a normal room centre, on no portal)', () => {
		const layout = intermediate(1)
		const room = layout.rects.find((r) => r.kind === 'room')!
		const hit = portalAt(layout, playerAt(centre(room).x, centre(room).y))
		expect(hit.kind).toBe('none')
	})

	it('holds across many seeds: every intermediate map exposes at least one dive-in slot', () => {
		for (let seed = 0; seed < 100; seed++) {
			const layout = intermediate(seed)
			// Full grid (removeProb 0) → the checkerboard always yields submap slots.
			expect(layout.submaps.length, `seed ${seed}`).toBeGreaterThan(0)
			const s = layout.submaps[0]
			expect(portalAt(layout, playerAt(centre(s.slotRect).x, centre(s.slotRect).y)).kind).toBe('in')
		}
	})
})
