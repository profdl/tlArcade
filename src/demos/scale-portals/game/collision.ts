/**
 * COLLISION — pure axis-separated AABB "slide" movement for the top-down player.
 * ================================================================================
 * Rooms don't touch (mapGeometry.ts lays them out with a GAP wider than any
 * doorway), so "walkable" is the union of room + doorway rects, and the correct
 * test for "can the player's box be here" is CONTAINMENT in that union (every
 * corner of the box lands inside *some* walkable rect), not raw intersection — a
 * corner poking into open space next to a wall is still a collision.
 *
 * X and Y are resolved independently in the same call so the player slides along
 * a wall it's moving into diagonally instead of stopping dead.
 */

export type AABB = { x: number; y: number; w: number; h: number }

function corners(box: AABB): [number, number][] {
	return [
		[box.x, box.y],
		[box.x + box.w, box.y],
		[box.x, box.y + box.h],
		[box.x + box.w, box.y + box.h],
	]
}

function pointInRect(px: number, py: number, r: AABB): boolean {
	return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h
}

/** True when every corner of `box` lands inside SOME rect in `walkable` (not necessarily
 *  the same one — straddling two rects at a doorway is exactly the case that must pass). */
export function aabbFullyInsideUnion(box: AABB, walkable: AABB[]): boolean {
	return corners(box).every(([px, py]) => walkable.some((r) => pointInRect(px, py, r)))
}

/** Plain overlap test (touch, not full containment) — used for portal/exit trigger checks. */
export function aabbOverlaps(a: AABB, b: AABB): boolean {
	return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

/**
 * Resolve moving `box` by `(dx, dy)` against `walkable` rects. Each axis is tried
 * independently against the box's OTHER axis already resolved, so a diagonal move
 * into a wall keeps the open axis's motion instead of blocking both.
 */
export function resolveMove(box: AABB, dx: number, dy: number, walkable: AABB[]): { x: number; y: number } {
	let x = box.x
	let y = box.y

	if (dx !== 0) {
		const candidate: AABB = { x: x + dx, y, w: box.w, h: box.h }
		if (aabbFullyInsideUnion(candidate, walkable)) x = candidate.x
	}
	if (dy !== 0) {
		const candidate: AABB = { x, y: y + dy, w: box.w, h: box.h }
		if (aabbFullyInsideUnion(candidate, walkable)) y = candidate.y
	}

	return { x, y }
}
