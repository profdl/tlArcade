/**
 * PORTAL DECISION tests — the dive IN / dive OUT / none decision the tick loop makes.
 * ===================================================================================
 * The trigger is now a small PORTAL-DOORWAY (not the whole slot / whole gate room): an
 * 'in' doorway at each submap tunnel mouth (dive in) and an 'out' doorway at each gate
 * (dive out). Also a regression guard for the bug where an INTERMEDIATE map (both 'out'
 * and 'in' doorways) only ever dove OUT — the tick loop must check BOTH. The decision is
 * pure (portalAt), so we can test it directly without an editor.
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

/** A tiny AABB centred on a page point (small enough to sit inside one doorway rect). */
function playerAt(cx: number, cy: number, size = 4): AABB {
	return { x: cx - size / 2, y: cy - size / 2, w: size, h: size }
}
const centre = (r: { x: number; y: number; w: number; h: number }) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })

/** Build an INTERMEDIATE map: it is a guest ('out' doorways on both W and E) AND a host ('in' doorways). */
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
	it('dives OUT when the player stands on an OUT doorway (at a gate)', () => {
		const layout = intermediate(1)
		const out = layout.portals.filter((p) => p.kind === 'out')
		expect(out.length).toBeGreaterThan(0)
		const p = out[0]
		const hit = portalAt(layout, playerAt(centre(p.rect).x, centre(p.rect).y))
		expect(hit.kind).toBe('out')
		if (hit.kind === 'out') expect(hit.portal.dir).toBe(p.dir)
	})

	it('dives IN when the player stands on an IN doorway (THE bug: not masked by having gates)', () => {
		const layout = intermediate(1)
		const inn = layout.portals.filter((p) => p.kind === 'in')
		expect(inn.length).toBeGreaterThan(0) // it's a host too
		const p = inn[0]
		const hit = portalAt(layout, playerAt(centre(p.rect).x, centre(p.rect).y))
		expect(hit.kind).toBe('in')
		if (hit.kind === 'in') {
			expect(hit.portal.submap?.cell).toEqual(p.submap?.cell)
			expect(hit.portal.dir).toBe(p.dir)
		}
	})

	it('returns none in open floor (a normal room centre, on no doorway)', () => {
		const layout = intermediate(1)
		const room = layout.rects.find((r) => r.kind === 'room')!
		const hit = portalAt(layout, playerAt(centre(room).x, centre(room).y))
		expect(hit.kind).toBe('none')
	})

	it('holds across many seeds: every intermediate map exposes at least one IN doorway', () => {
		for (let seed = 0; seed < 100; seed++) {
			const layout = intermediate(seed)
			const inn = layout.portals.filter((p) => p.kind === 'in')
			// Full grid (removeProb 0) → the coin flip always yields submap slots, each with a tunnel.
			expect(inn.length, `seed ${seed}`).toBeGreaterThan(0)
			const p = inn[0]
			expect(portalAt(layout, playerAt(centre(p.rect).x, centre(p.rect).y)).kind).toBe('in')
		}
	})
})
