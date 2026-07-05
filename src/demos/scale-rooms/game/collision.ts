/**
 * COLLISION — pure axis-separated AABB "slide" movement for the top-down player.
 * ================================================================================
 * "Walkable" is the union of floor rects (here just the current room square), and the
 * correct test for "can the player's box be here" is CONTAINMENT in that union (every
 * corner of the box lands inside *some* walkable rect) — a corner poking into open space
 * next to a wall is still a collision. On top of that, the player must stay CLEAR of any
 * OBSTACLE rect: in Scale Rooms the (smaller, overlapping) child rooms are SOLID, so you
 * walk around them on the parent floor and step onto a doorway to dive in — you can never
 * stand on a child room at parent scale.
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

/** True when `box` overlaps NONE of the `obstacles` (solid child rooms). */
export function clearOfObstacles(box: AABB, obstacles: AABB[]): boolean {
	return !obstacles.some((o) => aabbOverlaps(box, o))
}

/**
 * Resolve moving `box` by `(dx, dy)`: a candidate position is accepted only if it stays
 * CONTAINED in `walkable` AND CLEAR of every `obstacle`. Each axis is tried independently
 * against the box's OTHER axis already resolved, so a diagonal move into a wall keeps the
 * open axis's motion instead of blocking both.
 */
export function resolveMove(box: AABB, dx: number, dy: number, walkable: AABB[], obstacles: AABB[] = []): { x: number; y: number } {
	let x = box.x
	let y = box.y

	if (dx !== 0) {
		const candidate: AABB = { x: x + dx, y, w: box.w, h: box.h }
		if (aabbFullyInsideUnion(candidate, walkable) && clearOfObstacles(candidate, obstacles)) x = candidate.x
	}
	if (dy !== 0) {
		const candidate: AABB = { x, y: y + dy, w: box.w, h: box.h }
		if (aabbFullyInsideUnion(candidate, walkable) && clearOfObstacles(candidate, obstacles)) y = candidate.y
	}

	return { x, y }
}

/**
 * Find a point where a `size`-square player box, CENTRED there, is contained in `walkable`
 * and clear of every `obstacle` — used to place the player on spawn and after a dive so it
 * never lands inside a solid child room. Tries the preferred point first, then samples an
 * expanding ring of angles around it; falls back to the preferred point if nothing is found.
 */
export function findClearPoint(cx: number, cy: number, size: number, walkable: AABB[], obstacles: AABB[]): { x: number; y: number } {
	const boxAt = (px: number, py: number): AABB => ({ x: px - size / 2, y: py - size / 2, w: size, h: size })
	const ok = (px: number, py: number) => aabbFullyInsideUnion(boxAt(px, py), walkable) && clearOfObstacles(boxAt(px, py), obstacles)
	if (ok(cx, cy)) return { x: cx, y: cy }
	const step = size * 0.75
	const RINGS = 40
	const SAMPLES = 16
	for (let r = 1; r <= RINGS; r++) {
		const radius = r * step
		for (let s = 0; s < SAMPLES; s++) {
			const a = (s / SAMPLES) * Math.PI * 2
			const px = cx + Math.cos(a) * radius
			const py = cy + Math.sin(a) * radius
			if (ok(px, py)) return { x: px, y: py }
		}
	}
	return { x: cx, y: cy }
}
