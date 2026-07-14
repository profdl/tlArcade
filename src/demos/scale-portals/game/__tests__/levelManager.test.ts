/**
 * LEVEL MANAGER tests — push/pop stack behaviour and the child cache.
 */
import { describe, it, expect } from 'vitest'
import { LevelManager, submapKey, walkableRects, type LevelState } from '../levelManager'
import type { MapLayout } from '../mapGeometry'

/** A bare layout stub — the manager only stores it, never inspects its rects. */
function stubLayout(): MapLayout<string> {
	return {
		rects: [],
		extent: { w: 100, h: 100 },
		spawnCell: { x: 0, y: 0 },
		spawnRect: { x: 0, y: 0, w: 10, h: 10 },
		submaps: [],
		gates: [],
		portals: [],
	}
}

function level(depth: number, parentDepth: number | null): LevelState<string> {
	return { depth, layout: stubLayout(), roomSize: 100, gap: 20, originX: 0, originY: 0, parentDepth }
}

describe('LevelManager', () => {
	it('tracks the current level and depth through push/pop', () => {
		const m = new LevelManager<string>()
		m.pushRoot(level(0, null))
		expect(m.currentDepth()).toBe(0)

		m.pushChild(level(1, 0))
		expect(m.currentDepth()).toBe(1)

		const back = m.popToParent()
		expect(back?.depth).toBe(0)
		expect(m.currentDepth()).toBe(0)
	})

	it('never pops past the root', () => {
		const m = new LevelManager<string>()
		m.pushRoot(level(0, null))
		expect(m.popToParent()).toBeUndefined()
		expect(m.currentDepth()).toBe(0)
	})

	it('caches a child by submap SLOT page position and returns the same instance', () => {
		const m = new LevelManager<string>()
		m.pushRoot(level(0, null))
		const slotA = { x: 320, y: 0, w: 100, h: 100 }
		expect(m.getCachedChild(submapKey(slotA))).toBeUndefined()

		const child = level(1, 0)
		m.cacheChild(submapKey(slotA), child)
		expect(m.getCachedChild(submapKey(slotA))).toBe(child)
		// A different slot has no child yet.
		expect(m.getCachedChild(submapKey({ x: 0, y: 320, w: 100, h: 100 }))).toBeUndefined()
	})

	it('keys by page position so same-cell slots at different depths do NOT collide', () => {
		// A depth-1 map and a depth-2 map can each have a submap at grid cell (1,0); the
		// slots sit at different PAGE positions, so their cache keys must differ.
		const depth1Slot = { x: 320, y: 0, w: 100, h: 100 }
		const depth2Slot = { x: 71.6, y: 12.4, w: 22, h: 22 }
		expect(submapKey(depth1Slot)).not.toBe(submapKey(depth2Slot))
	})

	it('throws if asked for current before any level is pushed', () => {
		const m = new LevelManager<string>()
		expect(() => m.current()).toThrow()
	})
})

describe('walkableRects', () => {
	it('includes floor (rooms/doors/gates) but EXCLUDES portal-doorway markers', () => {
		const layout = stubLayout()
		layout.rects = [
			{ id: 'room', kind: 'room', x: 0, y: 0, w: 10, h: 10, props: {} },
			{ id: 'door', kind: 'door', x: 10, y: 3, w: 4, h: 4, props: {} },
			{ id: 'gate', kind: 'gate', x: 20, y: 0, w: 10, h: 10, props: {} },
			{ id: 'portal', kind: 'portal', x: 8, y: 3, w: 2, h: 4, props: {} },
		]
		const level: LevelState<string> = { depth: 0, layout, roomSize: 10, gap: 2, originX: 0, originY: 0, parentDepth: null }
		const walkable = walkableRects(level)
		expect(walkable).toHaveLength(3) // the portal is dropped
		// The portal rect's footprint is not present in the walkable set.
		expect(walkable.some((r) => r.x === 8 && r.w === 2)).toBe(false)
	})
})
