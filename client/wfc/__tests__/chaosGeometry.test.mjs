/**
 * CHAOS GEOMETRY tests — prove the wild variant still satisfies the swim loop's contract:
 *   • every doorway rect overlaps BOTH rooms it connects with POSITIVE AREA (the deep 50%
 *     overlap must actually land, despite random shapes/scales/jitter), and
 *   • every ROOM is reachable from every other through the doorways (the reachability
 *     guarantee survives the chaos), and
 *   • rooms are genuinely VARIED (multiple geo shapes + colours), and
 *   • every emitted geo shape value is in the valid tldraw geo enum.
 * Pure — buildChaosTankRects takes an id factory, so no tldraw import is needed.
 */
import { buildChaosTankRects, ROOM_SHAPES, DOOR_MOUTH_MIN } from '../chaosGeometry.ts'

// Valid tldraw geo enum (from @tldraw/tlschema) — every emitted shape must be one of these.
const VALID_GEO = new Set([
	'rectangle', 'cloud', 'ellipse', 'triangle', 'diamond', 'pentagon', 'hexagon', 'octagon',
	'star', 'rhombus', 'rhombus-2', 'oval', 'trapezoid', 'arrow-right', 'arrow-left', 'arrow-up',
	'arrow-down', 'x-box', 'check-box', 'heart',
])

// The TRUE axis-aligned bounding box of a (possibly rotated) rect. x,y is the un-rotated
// top-left; tldraw rotates about that origin. We rotate all four corners and take min/max —
// this is the box the swim loop confines/clusters by, so overlap must be tested on THIS.
const box = (r) => {
	const rot = r.rotation ?? 0
	const cos = Math.cos(rot)
	const sin = Math.sin(rot)
	const corners = [
		[0, 0],
		[r.w, 0],
		[r.w, r.h],
		[0, r.h],
	].map(([lx, ly]) => ({ x: r.x + lx * cos - ly * sin, y: r.y + lx * sin + ly * cos }))
	return {
		minX: Math.min(...corners.map((c) => c.x)),
		minY: Math.min(...corners.map((c) => c.y)),
		maxX: Math.max(...corners.map((c) => c.x)),
		maxY: Math.max(...corners.map((c) => c.y)),
	}
}
function positiveOverlap(a, b) {
	const oxMin = Math.max(a.minX, b.minX)
	const oxMax = Math.min(a.maxX, b.maxX)
	const oyMin = Math.max(a.minY, b.minY)
	const oyMax = Math.min(a.maxY, b.maxY)
	return oxMax - oxMin > 0 && oyMax - oyMin > 0
}

const ids = () => {
	let n = 0
	return () => `c${n++}`
}

for (const seed of [1, 2, 3, 7, 42, 100, 2024]) {
	const rects = buildChaosTankRects(ids(), 12, 12, seed, 0, 0)
	const roomRects = rects.filter((r) => r.kind === 'room')
	const rooms = roomRects.map(box)
	const doors = rects.filter((r) => r.kind === 'door').map(box)
	const food = rects.filter((r) => r.kind === 'food').map(box)

	// Every doorway overlaps (positive area) at least the two rooms it bridges. With deep
	// overlap + jitter a doorway can also clip a third room's box; we require ≥2 (its pair),
	// which is what makes it a passage.
	let everyDoorBridges = true
	for (const d of doors) {
		const hits = rooms.filter((rm) => positiveOverlap(d, rm)).length
		if (hits < 2) everyDoorBridges = false
	}

	// EVERY ROOM REACHABLE FROM EVERY OTHER — mirror the swim loop's nav: graph over
	// rooms+doors linked by positive-area AABB overlap, BFS from room 0, all rooms visited.
	const nodes = [...rooms, ...doors] // 0..rooms.length-1 are rooms
	const adj = nodes.map(() => [])
	for (let i = 0; i < nodes.length; i++)
		for (let j = i + 1; j < nodes.length; j++)
			if (positiveOverlap(nodes[i], nodes[j])) {
				adj[i].push(j)
				adj[j].push(i)
			}
	const seen = new Set([0])
	const queue = [0]
	while (queue.length) {
		const cur = queue.shift()
		for (const nx of adj[cur]) if (!seen.has(nx)) (seen.add(nx), queue.push(nx))
	}
	let allRoomsReachable = true
	for (let i = 0; i < rooms.length; i++) if (!seen.has(i)) allRoomsReachable = false

	// Variety: rooms use several different geo shapes (not all rectangles).
	const shapesUsed = new Set(roomRects.map((r) => r.props.geo))
	const varied = shapesUsed.size >= 4

	// ROTATION: rooms are actually tilted (a spread of non-zero rotations), not axis-aligned.
	const rotated = roomRects.filter((r) => Math.abs(r.rotation ?? 0) > 0.01).length
	const roomsRotated = rotated >= roomRects.length * 0.5

	// BIG LANDMARK ROOMS: a few rooms are ≥2.5× the MEDIAN room's side (the ×3–4 chambers).
	const sides = roomRects.map((r) => (r.w + r.h) / 2).sort((a, b) => a - b)
	const medianSide = sides[Math.floor(sides.length / 2)]
	const bigRooms = roomRects.filter((r) => (r.w + r.h) / 2 >= medianSide * 2.5).length
	const hasBigRooms = bigRooms >= 2 && bigRooms <= 4

	// DOORWAY WIDTH: every doorway's mouth (its local h — the bar is w=len long, h=mouth wide)
	// is at least DOOR_MOUTH_MIN, so a fish body fits through every opening.
	const doorRawRects = rects.filter((r) => r.kind === 'door')
	const allWideEnough = doorRawRects.every((d) => d.h >= DOOR_MOUTH_MIN - 1e-6)

	// REACH-TO-CENTRE: every door's AABB contains BOTH its rooms' centres — i.e. it plunges
	// through the shapes, not just into their corners. Each door must contain at least TWO room
	// CENTRES (its pair). Room centre = AABB centre. This is the fix for doors falling short of
	// non-rectangular/rotated room outlines.
	const doorRects = rects.filter((r) => r.kind === 'door')
	const roomCenters = rooms.map((r) => ({ x: (r.minX + r.maxX) / 2, y: (r.minY + r.maxY) / 2 }))
	let doorsReachCenters = true
	for (const d of doorRects.map(box)) {
		const contains = roomCenters.filter((c) => c.x >= d.minX && c.x <= d.maxX && c.y >= d.minY && c.y <= d.maxY).length
		if (contains < 2) doorsReachCenters = false
	}

	// Every emitted geo value is valid.
	const allValidGeo = rects.every((r) => VALID_GEO.has(r.props.geo))

	// COLOUR: rooms + doors are the uniform light-orange Fill—Fill (orange + fill:'fill'),
	// matching the tidy generator — only shape/size vary, not colour. (Food stays green.)
	const uniformOrange = [...roomRects, ...rects.filter((r) => r.kind === 'door')].every(
		(r) => r.props.color === 'orange' && r.props.fill === 'fill'
	)

	console.log(`seed ${String(seed).padStart(4)}: EVERY room reachable from every other:`, allRoomsReachable)
	console.log(`seed ${String(seed).padStart(4)}: every doorway bridges its two rooms (positive area):`, everyDoorBridges)
	console.log(`seed ${String(seed).padStart(4)}: most rooms are rotated/tilted (${rotated}/${roomRects.length}):`, roomsRotated)
	console.log(`seed ${String(seed).padStart(4)}: has 2–4 big landmark rooms (${bigRooms}):`, hasBigRooms)
	console.log(`seed ${String(seed).padStart(4)}: every door reaches BOTH room centres (plunges in):`, doorsReachCenters)
	console.log(`seed ${String(seed).padStart(4)}: every doorway is ≥${DOOR_MOUTH_MIN}px wide (fish fits):`, allWideEnough)
	console.log(`seed ${String(seed).padStart(4)}: rooms use ≥4 distinct geo shapes (${shapesUsed.size}):`, varied)
	console.log(`seed ${String(seed).padStart(4)}: rooms + doors are uniform light-orange Fill—Fill:`, uniformOrange)
	console.log(`seed ${String(seed).padStart(4)}: every emitted geo value is valid:`, allValidGeo)
	console.log(`seed ${String(seed).padStart(4)}: every food pellet sits in a room:`, food.every((f) => rooms.some((rm) => positiveOverlap(f, rm))))
}

// ── Determinism: same seed → identical chaos layout. ────────────────────────────
{
	const a = buildChaosTankRects(ids(), 12, 12, 999, 0, 0)
	const b = buildChaosTankRects(ids(), 12, 12, 999, 0, 0)
	const same =
		a.length === b.length &&
		a.every((r, i) => r.kind === b[i].kind && r.x === b[i].x && r.y === b[i].y && r.w === b[i].w && r.h === b[i].h && r.props.geo === b[i].props.geo)
	console.log('determinism: same seed → identical chaos layout:', same)
}

// ── Sanity: ROOM_SHAPES are all in the valid geo enum. ──────────────────────────
console.log('config: every ROOM_SHAPES value is a valid geo:', ROOM_SHAPES.every((s) => VALID_GEO.has(s)))
