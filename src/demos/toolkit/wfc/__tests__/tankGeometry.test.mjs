/**
 * TANK GEOMETRY tests — prove the emitted rects satisfy the swim loop's contract:
 *   • every doorway rect overlaps BOTH the rooms it connects with POSITIVE AREA
 *     (what registerSwimming's buildRoomGraph requires to register a passage), and
 *   • adjacent rooms are separated by more than TOUCH_SLACK (so they connect ONLY via
 *     doorways, never by being near each other).
 * Pure — buildTankRects takes an id factory, so no tldraw import is needed.
 */
import { buildTankRects, ROOM, GAP, DOOR_OVERLAP } from '../tankGeometry.ts'

// Mirror of registerSwimming's TOUCH_SLACK and its positive-area overlap predicate.
const TOUCH_SLACK = 2
const box = (r) => ({ minX: r.x, minY: r.y, maxX: r.x + r.w, maxY: r.y + r.h })
function positiveOverlap(a, b) {
	const oxMin = Math.max(a.minX, b.minX)
	const oxMax = Math.min(a.maxX, b.maxX)
	const oyMin = Math.max(a.minY, b.minY)
	const oyMax = Math.min(a.maxY, b.maxY)
	return oxMax - oxMin > 0 && oyMax - oyMin > 0
}
// Two boxes "cluster" in the swim loop iff they touch within TOUCH_SLACK.
function boxesTouch(a, b) {
	return (
		a.minX <= b.maxX + TOUCH_SLACK &&
		b.minX <= a.maxX + TOUCH_SLACK &&
		a.minY <= b.maxY + TOUCH_SLACK &&
		b.minY <= a.maxY + TOUCH_SLACK
	)
}

// A simple deterministic id factory for the pure build.
const ids = () => {
	let n = 0
	return () => `r${n++}`
}

// ── Build a few LARGE tanks (with pruning) across seeds and check invariants. ────
// 12×12 exercises the bigger map + the random room removal; the reachability check below
// is the real test that pruning never orphans a surviving room.
for (const seed of [1, 2, 3, 7, 42, 100]) {
	const rects = buildTankRects(ids(), 12, 12, seed, 0, 0)
	const rooms = rects.filter((r) => r.kind === 'room').map(box)
	const doors = rects.filter((r) => r.kind === 'door').map(box)
	const food = rects.filter((r) => r.kind === 'food').map(box)

	// Every doorway must overlap (positive area) EXACTLY two rooms — the pair it bridges.
	let everyDoorBridgesTwoRooms = true
	for (const d of doors) {
		const hits = rooms.filter((rm) => positiveOverlap(d, rm)).length
		if (hits !== 2) everyDoorBridgesTwoRooms = false
	}

	// No two ROOMS may touch each other (they must connect only through doorways).
	let noRoomsTouch = true
	for (let i = 0; i < rooms.length; i++)
		for (let j = i + 1; j < rooms.length; j++) if (boxesTouch(rooms[i], rooms[j])) noRoomsTouch = false

	// Each door pokes ~DOOR_OVERLAP·ROOM deep into each room (a real area, not a sliver).
	const expectedDepth = ROOM * DOOR_OVERLAP
	let depthsRight = true
	for (const d of doors) {
		for (const rm of rooms) {
			if (!positiveOverlap(d, rm)) continue
			const ox = Math.min(d.maxX, rm.maxX) - Math.max(d.minX, rm.minX)
			const oy = Math.min(d.maxY, rm.maxY) - Math.max(d.minY, rm.minY)
			// The shallow axis of the overlap (across the gap) should be ~the poke depth.
			const shallow = Math.min(ox, oy)
			if (Math.abs(shallow - expectedDepth) > 0.5) depthsRight = false
		}
	}

	// Every food pellet must sit inside a room (positive overlap with some room).
	const everyFoodInARoom = food.every((f) => rooms.some((rm) => positiveOverlap(f, rm)))

	// EVERY ROOM REACHABLE FROM EVERY OTHER — the core requirement. Mirror the swim loop's
	// nav: build a graph over rooms+doors linked by positive-area overlap (buildRoomGraph),
	// then BFS from room 0; every room must be visited. (Doors are the bridge nodes.)
	const nodes = [...rooms, ...doors] // indices 0..rooms.length-1 are rooms
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

	console.log(`seed ${String(seed).padStart(3)}: EVERY room reachable from every other:`, allRoomsReachable)
	console.log(`seed ${String(seed).padStart(3)}: every doorway bridges exactly 2 rooms:`, everyDoorBridgesTwoRooms)
	console.log(`seed ${String(seed).padStart(3)}: no two rooms touch (gap > slack):`, noRoomsTouch)
	console.log(`seed ${String(seed).padStart(3)}: door overlap depth ≈ ${expectedDepth}px into each room:`, depthsRight)
	console.log(`seed ${String(seed).padStart(3)}: every food pellet is inside a room:`, everyFoodInARoom)
}

// ── Pruning makes it NOT a perfect grid (fewer rooms than width×height). ─────────
{
	let anyPruned = false
	for (const seed of [1, 2, 3, 7, 42, 100]) {
		const rooms = buildTankRects(ids(), 12, 12, seed, 0, 0).filter((r) => r.kind === 'room')
		if (rooms.length < 144) anyPruned = true
	}
	console.log('pruning: tank has fewer rooms than the full 12×12 grid (not a perfect grid):', anyPruned)
}

// ── Determinism: same seed → identical rects. ───────────────────────────────────
{
	const a = buildTankRects(ids(), 12, 12, 555, 0, 0)
	const b = buildTankRects(ids(), 12, 12, 555, 0, 0)
	const same =
		a.length === b.length &&
		a.every((r, i) => r.kind === b[i].kind && r.x === b[i].x && r.y === b[i].y && r.w === b[i].w && r.h === b[i].h)
	console.log('determinism: same seed → identical rect layout:', same)
}

// ── GAP sanity: the configured gap genuinely exceeds the cluster slack. ──────────
console.log('config: room gap exceeds TOUCH_SLACK:', GAP > TOUCH_SLACK)
