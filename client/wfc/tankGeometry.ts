/**
 * TANK GEOMETRY — the PURE rectangle layout for a generated tank.
 * ===============================================================
 * Turns a WFC room grid (collapse.ts) into the list of rectangles to emit: room
 * rects, doorway rects, and food rects, all in page space. NO tldraw import — it
 * takes an id-factory instead of calling createShapeId — so this geometry runs under
 * `yarn test` and the doorway-overlap invariant (the thing the swim nav depends on)
 * is unit-testable without an editor. generateTank.ts is the thin impure wrapper that
 * supplies the real id factory and writes the rects to the store.
 *
 * THE GEOMETRY — how a door grid becomes a swimmable tank (see also generateTank.ts):
 *   • Rooms DON'T touch — laid on a pitch with a GAP wider than the swim loop's cluster
 *     TOUCH_SLACK (2px), so rooms connect ONLY at doorways, never by being near.
 *   • A door becomes its own rect bridging the gap, poking DOOR_OVERLAP (10%) into EACH
 *     room — a positive-AREA overlap on both ends, which registerSwimming's buildRoomGraph
 *     requires to register a passage (it rejects zero-area / line overlaps).
 *   • Food = green rects in reachable rooms; the swim loop treats green geo as food.
 */
import { collapse } from './collapse.ts'
import { pruneAndConnect, largestComponent, chooseFood } from './connectivity.ts'
import { DELTA, type Dir } from './tiles.ts'

// ── LAYOUT KNOBS — the physical size of the generated tank (page px). ────────────
/** Side length of each room rectangle. */
export const ROOM = 220
/**
 * GAP between adjacent rooms (the empty band a doorway bridges). Must exceed the swim
 * loop's TOUCH_SLACK (2px) by a wide margin so two rooms NEVER cluster just by being
 * near each other — they connect only where we place a doorway rect.
 */
export const GAP = 80
/** Centre-to-centre PITCH between cells = room + gap. */
export const PITCH = ROOM + GAP
/**
 * How far (fraction of the room) a doorway pokes INTO each room it connects. The brief
 * said 10%. This makes the doorway↔room overlap a positive-AREA rectangle (ROOM·DOOR_OVERLAP
 * deep), which buildRoomGraph needs to count it as a passage.
 */
export const DOOR_OVERLAP = 0.1
/** The doorway's MOUTH — its width across the opening, as a fraction of the room side. */
export const DOOR_MOUTH = 0.34
/**
 * Fraction of rooms to REMOVE so the tank reads as an irregular warren, not a perfect
 * grid. Only removals that keep the survivors 4-connected are applied (pruneAndConnect),
 * so the actual removed fraction is a bit lower — articulation rooms are spared — and
 * every remaining room stays reachable. ~0.3 gives a pleasantly ragged outline.
 */
export const REMOVE_PROB = 0.3
/** How many food pellets to scatter in the playable region — kept sparse (5 max). */
export const FOOD_COUNT = 5
/** Side length of a (square) food pellet. */
export const FOOD = 40

/** Orange geo props shared by rooms and doorways, using the opaque "Fill — Fill"
 *  fill style (the schema value 'fill', set by the style panel's Fill—Fill button). */
export const ORANGE = { color: 'orange', fill: 'fill' } as const
/** Solid-green props for food — MUST stay green so the swim loop treats it as food. */
export const GREEN = { color: 'green', fill: 'solid' } as const

/** What KIND of rect this is — for tests/debugging; all three emit as `geo` rectangles. */
export type RectKind = 'room' | 'door' | 'food'

/**
 * A resolved rectangle/shape to emit, in page space. `id` comes from the caller's factory.
 * `x,y` is the shape's TOP-LEFT (tldraw rotates a shape about its top-left origin), `w,h`
 * the local box, `rotation` an optional angle in radians (default 0 / unrotated). When a
 * shape is rotated, `x,y` is still its un-rotated top-left; the chaos generator derives it
 * from the desired centre + rotation the same way the swim loop does.
 */
export type TankRect<Id> = { id: Id; kind: RectKind; x: number; y: number; w: number; h: number; rotation?: number; props: Record<string, unknown> }

/**
 * Half-extents of a `w×h` box rotated by θ — i.e. its axis-aligned bounding box. The swim
 * loop confines/clusters by this AABB (not the true rotated outline), so the chaos
 * generator computes doorway overlaps against THIS box. Mirrors confineToCluster's formula
 * in registerSwimming.ts: (|cosθ|·w + |sinθ|·h)/2 and (|sinθ|·w + |cosθ|·h)/2.
 */
export function rotatedHalfExtents(w: number, h: number, rotation: number): { hx: number; hy: number } {
	const c = Math.abs(Math.cos(rotation))
	const s = Math.abs(Math.sin(rotation))
	return { hx: (c * w + s * h) / 2, hy: (s * w + c * h) / 2 }
}

/**
 * Build every rectangle for a tank of `width × height` rooms, top-left room at page
 * (originX, originY). PURE given the seed (and a pure id factory) → deterministic and
 * testable. `newId` mints a fresh shape id per rect (the real createShapeId in prod, a
 * counter in tests).
 *
 * Doorways are emitted ONCE per door edge: we look only at each cell's N and W doors
 * (the neighbour's S/E is the same edge), so a passage isn't drawn twice. The collapse's
 * edge-agreement invariant guarantees an N door here implies an S door on the cell above,
 * so the single bridging rect is correct for both.
 */
export function buildTankRects<Id>(
	newId: () => Id,
	width: number,
	height: number,
	seed: number,
	originX: number,
	originY: number
): TankRect<Id>[] {
	// Collapse, then PRUNE a random fraction of rooms (so it isn't a perfect grid) and STITCH
	// the survivors into one component so every REMAINING room is reachable from every other.
	// `present[y][x]` says which cells survived; we emit rects only for present cells, and
	// pruneAndConnect already sealed any door that touched a removed cell — so doors read off
	// `grid` below only ever bridge two present rooms.
	const { grid, present } = pruneAndConnect(collapse(width, height, seed), seed, REMOVE_PROB)
	const rects: TankRect<Id>[] = []

	const roomX = (x: number) => originX + x * PITCH
	const roomY = (y: number) => originY + y * PITCH
	const geo = (w: number, h: number, extra: Record<string, unknown>) => ({ geo: 'rectangle', w, h, ...extra })

	// 1) ROOMS — one orange rect per PRESENT cell (pruned cells emit nothing).
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (!present[y][x]) continue
			rects.push({ id: newId(), kind: 'room', x: roomX(x), y: roomY(y), w: ROOM, h: ROOM, props: geo(ROOM, ROOM, ORANGE) })
		}
	}

	// 2) DOORWAYS — one orange rect per door edge, poking DOOR_OVERLAP into each room.
	const overlap = ROOM * DOOR_OVERLAP
	const mouth = ROOM * DOOR_MOUTH
	const addDoor = (x: number, y: number, dir: Dir) => {
		const ax = roomX(x)
		const ay = roomY(y)
		const nx = x + DELTA[dir].dx
		const ny = y + DELTA[dir].dy
		const bx = roomX(nx)
		const by = roomY(ny)
		if (dir === 'N') {
			// Vertical doorway spanning the gap above this room; poke `overlap` into both.
			const top = by + ROOM - overlap // into the room above (its bottom edge)
			const bottom = ay + overlap // into this room (its top edge)
			const cx = ax + ROOM / 2
			rects.push({ id: newId(), kind: 'door', x: cx - mouth / 2, y: top, w: mouth, h: bottom - top, props: geo(mouth, bottom - top, ORANGE) })
		} else {
			// dir === 'W': horizontal doorway spanning the gap to the left.
			const left = bx + ROOM - overlap // into the room to the left (its right edge)
			const right = ax + overlap // into this room (its left edge)
			const cy = ay + ROOM / 2
			rects.push({ id: newId(), kind: 'door', x: left, y: cy - mouth / 2, w: right - left, h: mouth, props: geo(right - left, mouth, ORANGE) })
		}
	}
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (!present[y][x]) continue // a pruned cell has no doorways
			// Both endpoints are present (sealing guaranteed it), so each door bridges two rooms.
			if (y > 0 && present[y - 1][x] && grid[y][x].edges.N === 'door') addDoor(x, y, 'N')
			if (x > 0 && present[y][x - 1] && grid[y][x].edges.W === 'door') addDoor(x, y, 'W')
		}
	}

	// 3) FOOD — green pellets centred in reachable (present) rooms.
	const region = largestComponent(grid, present)
	for (const cell of chooseFood(region, FOOD_COUNT)) {
		const cx = roomX(cell.x) + ROOM / 2
		const cy = roomY(cell.y) + ROOM / 2
		rects.push({ id: newId(), kind: 'food', x: cx - FOOD / 2, y: cy - FOOD / 2, w: FOOD, h: FOOD, props: geo(FOOD, FOOD, GREEN) })
	}

	return rects
}

/** Total page-space size of a `width × height` grid (rooms + gaps, no outer gap). */
export function tankExtent(width: number, height: number): { w: number; h: number } {
	return { w: width * PITCH - GAP, h: height * PITCH - GAP }
}
