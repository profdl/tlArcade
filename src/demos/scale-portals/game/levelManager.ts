/**
 * LEVEL MANAGER — a small stack of generated levels (data-only, no editor).
 * ============================================================================
 * Deliberately an ARRAY-backed stack, not a hardcoded "parent + child" pair, so a
 * third depth is additive later: pushChild()/popToParent() don't know or care how
 * deep the stack already is.
 *
 * Each submap cell's child map is generated once and cached BY CELL (a "x,y" key),
 * so a parent with several submaps holds several distinct children, and walking
 * in/out/in again reuses the same child instead of regenerating (and reseeding) it.
 */
import type { AABB } from './collision.ts'
import type { MapLayout, PageRect } from './mapGeometry.ts'

export type LevelState<Id> = {
	depth: number
	layout: MapLayout<Id>
	roomSize: number
	gap: number
	originX: number
	originY: number
	parentDepth: number | null
	/** The host submap cell's SLOT rect in PAGE space — the footprint this child fills. */
	parentSlotRect?: PageRect
}

/**
 * Stable cache key for a submap SLOT, keyed by its PAGE position. Grid coordinates
 * alone would collide across depths (a depth-1 map and a depth-2 map can both have a
 * submap at cell (1,0)); the slot's page origin is unique in the whole nested world,
 * so the same slot always reuses its one cached child. Rounded to shrug off float drift.
 */
export function submapKey(slotRect: { x: number; y: number }): string {
	return `${Math.round(slotRect.x)},${Math.round(slotRect.y)}`
}

/** The walkable floor of a level: rooms, doorways, and gate rooms. Portal-doorway rects
 *  (kind 'portal') are excluded — they're orange markers/triggers laid OVER walkable
 *  floor (a hallway on the host side, a gate room on the guest side), not floor of their
 *  own, so they must not extend the walkable area past the slot boundary. */
export function walkableRects<Id>(level: LevelState<Id>): AABB[] {
	return level.layout.rects.filter((r) => r.kind !== 'portal').map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h }))
}

export class LevelManager<Id> {
	private levels: LevelState<Id>[] = []
	private childCache = new Map<string, LevelState<Id>>()

	pushRoot(level: LevelState<Id>): void {
		this.levels = [level]
	}

	pushChild(level: LevelState<Id>): void {
		this.levels.push(level)
	}

	popToParent(): LevelState<Id> | undefined {
		if (this.levels.length <= 1) return undefined
		this.levels.pop()
		return this.current()
	}

	current(): LevelState<Id> {
		const level = this.levels[this.levels.length - 1]
		if (!level) throw new Error('LevelManager: no levels pushed yet')
		return level
	}

	currentDepth(): number {
		return this.current().depth
	}

	getCachedChild(key: string): LevelState<Id> | undefined {
		return this.childCache.get(key)
	}

	cacheChild(key: string, level: LevelState<Id>): void {
		this.childCache.set(key, level)
	}
}
