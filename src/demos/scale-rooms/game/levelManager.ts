/**
 * LEVEL MANAGER — a small stack of the rooms you've dived through (data-only, no editor).
 * =======================================================================================
 * Scale Rooms builds the ENTIRE room tree up front (every room's shapes are on the page
 * before you move — roomTree.ts / gameLoop's buildWorld), so there's no per-level cache to
 * maintain: the tree of `RoomNode`s IS the cache. This is just the path from the root to
 * the room you're currently standing in — pushChild on a dive-in, popToParent on a dive-out.
 * Deliberately an ARRAY-backed stack so nesting depth is never hardcoded.
 */
import type { AABB } from './collision.ts'
import type { RoomNode } from './roomTree.ts'

/** The walkable floor of a level: its own room square. The player is confined to the room
 *  it's standing in; its child rooms are SOLID obstacles carved out of this floor. */
export function walkableRects<Id>(node: RoomNode<Id>): AABB[] {
	const r = node.rect
	return [{ x: r.x, y: r.y, w: r.w, h: r.h }]
}

/** The solid obstacles at a level: its DIRECT child rooms (you can't walk onto them — walk
 *  around them and step onto a doorway to dive in). Deeper descendants aren't obstacles here;
 *  you'd have dived into the child before ever navigating its interior. */
export function obstacleRects<Id>(node: RoomNode<Id>): AABB[] {
	return node.children.map((c) => ({ x: c.rect.x, y: c.rect.y, w: c.rect.w, h: c.rect.h }))
}

export class LevelManager<Id> {
	private stack: RoomNode<Id>[] = []

	pushRoot(node: RoomNode<Id>): void {
		this.stack = [node]
	}

	pushChild(node: RoomNode<Id>): void {
		this.stack.push(node)
	}

	popToParent(): RoomNode<Id> | undefined {
		if (this.stack.length <= 1) return undefined
		this.stack.pop()
		return this.current()
	}

	current(): RoomNode<Id> {
		const node = this.stack[this.stack.length - 1]
		if (!node) throw new Error('LevelManager: no levels pushed yet')
		return node
	}

	currentDepth(): number {
		return this.current().depth
	}
}
