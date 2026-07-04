/**
 * LEVEL MANAGER tests — push/pop stack behaviour and the child cache.
 */
import { describe, it, expect } from 'vitest'
import { LevelManager, type LevelState } from '../levelManager'
import type { MapLayout } from '../mapGeometry'

/** A bare layout stub — the manager only stores it, never inspects its rects. */
function stubLayout(): MapLayout<string> {
	return {
		rects: [],
		extent: { w: 100, h: 100 },
		spawnCell: { x: 0, y: 0 },
		spawnRect: { x: 0, y: 0, w: 10, h: 10 },
		special: 'portal',
		specialCell: { x: 2, y: 2 },
		specialRect: { x: 20, y: 20, w: 10, h: 10 },
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

	it('caches a child by parent depth and returns the same instance', () => {
		const m = new LevelManager<string>()
		m.pushRoot(level(0, null))
		expect(m.getCachedChild(0)).toBeUndefined()

		const child = level(1, 0)
		m.cacheChild(0, child)
		expect(m.getCachedChild(0)).toBe(child)
	})

	it('throws if asked for current before any level is pushed', () => {
		const m = new LevelManager<string>()
		expect(() => m.current()).toThrow()
	})
})
