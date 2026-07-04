/**
 * LEVEL MANAGER — a small stack of generated levels (data-only, no editor).
 * ============================================================================
 * Deliberately an ARRAY-backed stack, not a hardcoded "parent + child" pair, so a
 * third depth is additive later: pushChild()/popToParent() don't know or care how
 * deep the stack already is.
 *
 * Each portal's child map is generated once and cached BY PORTAL (a "x,y" key), so
 * a parent with several portals holds several distinct children, and walking
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
	/** The parent's portal rect in PAGE space — where the player reappears on exit. */
	parentPortalRect?: PageRect
}

/** Stable cache key for a portal room (its grid cell). */
export function portalKey(cell: { x: number; y: number }): string {
	return `${cell.x},${cell.y}`
}

/** Every rect in a level's layout is walkable floor (rooms, doorways, and the
 *  portal/exit marker cell, which is still a normal room the player stands in). */
export function walkableRects<Id>(level: LevelState<Id>): AABB[] {
	return level.layout.rects.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h }))
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
