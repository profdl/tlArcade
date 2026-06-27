/**
 * CHAOS TANK GEOMETRY — a wild, off-grid variant of the WFC fishtank.
 * ==================================================================
 * Same proven topology as tankGeometry.ts (collapse → pruneAndConnect, so every
 * surviving room is reachable from every other), but the rooms are DECORATED hard:
 *   • every room is a RANDOM native geo shape (rectangle / ellipse / triangle /
 *     hexagon / star / diamond / …) at a RANDOM scale,
 *   • colour/fill stay the original uniform light-orange Fill—Fill (ORANGE) — only the
 *     SHAPE and SIZE vary, so the map reads as the same palette as the tidy generator,
 *   • room centres are JITTERED off the grid lines so the silhouette is ragged, not a
 *     tidy lattice,
 *   • doorways overlap DEEPLY (50%) into each room they connect, computed from the
 *     rooms' ACTUAL jittered bounding boxes — so the positive-area overlap the swim
 *     nav requires is guaranteed no matter how the jitter/scale landed.
 *
 * WHY IT STILL SWIMS (the constraints from registerSwimming.ts):
 *   • Tanks are `type:'geo'` only — every shape we emit is a geo shape, so all qualify.
 *   • The swim loop confines + clusters by each shape's AXIS-ALIGNED BOUNDING BOX, not
 *     its true outline. So a triangle/star room is navigated as its bounding rectangle
 *     (its pointy corners are "dead" zones the fish avoid) — fine, and reads as variety.
 *   • Clustering + doorways are AABB overlap tests, so all of this composes: we just have
 *     to make each doorway a positive-area overlap with both rooms' AABBs, which the deep
 *     50% reach + jitter clamp below guarantees.
 *
 * PURE (no tldraw import — takes an id factory) so the geometry is unit-tested under
 * `yarn test`, exactly like tankGeometry.ts. generateChaosTank() is the impure wrapper.
 */
import { collapse, mulberry32 } from './collapse.ts'
import { pruneAndConnect, largestComponent, chooseFood } from './connectivity.ts'
import { buildRegionMask } from './regionMask.ts'
import { DELTA, type Dir } from './tiles.ts'
import { ROOM, GAP, PITCH, FOOD, ORANGE, type TankRect } from './tankGeometry.ts'

// ── CHAOS KNOBS ──────────────────────────────────────────────────────────────────
/**
 * How deeply a doorway pokes INTO each room, as a fraction of that room's size. Set to
 * 0.5 (half-way to the room centre) so the doorway↔room overlap is a big, unmistakably
 * positive AREA on BOTH ends — bulletproof connection even when jitter/scale shrink a
 * room or push a pair apart. (The tidy generator uses 0.1; chaos trades a fatter-connector
 * look for guaranteed reachability under randomness.)
 */
export const CHAOS_DOOR_OVERLAP = 0.5
/** A room's side is ROOM × a random factor in [MIN, MAX] — varied scales. */
export const SCALE_MIN = 0.55
export const SCALE_MAX = 1.35
/**
 * Max room-centre jitter as a fraction of GAP, per axis. CLAMPED below GAP/2 so two
 * adjacent room CENTRES can never cross (order preserved) and the gap between adjacent
 * AABBs stays in a bridgeable band — combined with the 50% doorway reach, every door is
 * provably a positive-area overlap. ~0.35·GAP keeps rooms clearly off the grid lines
 * without ever letting a 50% doorway fail to bridge.
 */
export const JITTER_FRAC = 0.35
/** How many food pellets to scatter (more, for a bigger wilder map). */
export const CHAOS_FOOD_COUNT = 30

/**
 * The native geo shapes a room may be. All are valid `geo` enum values (checked against
 * @tldraw/tlschema). The swim loop confines to each one's bounding box, so the pointier
 * ones just have dead corners — visually varied, still swimmable.
 */
export const ROOM_SHAPES = [
	'rectangle',
	'ellipse',
	'triangle',
	'diamond',
	'pentagon',
	'hexagon',
	'octagon',
	'star',
	'rhombus',
	'trapezoid',
	'oval',
	'cloud',
] as const

/** A room's resolved page-space AABB (from jittered centre + random size), kept so the
 *  doorway builder can overlap into the ACTUAL boxes, not nominal grid cells. */
type RoomBox = { cx: number; cy: number; w: number; h: number }

/** Pick a random element of `arr` using rng ∈ [0,1). */
function pick<T>(arr: readonly T[], rng: () => number): T {
	return arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))]
}

/**
 * Build every rectangle/shape for a chaos tank of `width × height` cells, top-left cell
 * centred near (originX, originY). PURE given the seed + id factory → deterministic and
 * testable. Rooms are varied geo shapes; doorways overlap 50% into each room's real AABB.
 */
export function buildChaosTankRects<Id>(
	newId: () => Id,
	width: number,
	height: number,
	seed: number,
	originX: number,
	originY: number
): TankRect<Id>[] {
	// Carve the square grid into an irregular ORGANIC BLOB (regionMask) so the map's overall
	// outline is ragged, not square — then prune lightly WITHIN the blob and stitch into one
	// reachable component. The blob removes ~half the cells; a light interior prune (0.15)
	// adds a little extra raggedness without over-thinning the lobes.
	const mask = buildRegionMask(width, height, seed, 0.5)
	const { grid, present } = pruneAndConnect(collapse(width, height, seed), seed, 0.15, mask)
	const rng = mulberry32((seed ^ 0x5bd1e995) >>> 0) // distinct stream from the topology's

	// Clamp jitter so adjacent AABBs always stay bridgeable (see JITTER_FRAC).
	const jitterMax = GAP * JITTER_FRAC

	// 1) Resolve every PRESENT cell's room box (jittered centre + random size), keyed by
	//    cell so the doorway builder can read both endpoints' real boxes.
	const boxes = new Map<string, RoomBox>()
	const cellKey = (x: number, y: number) => `${x},${y}`
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (!present[y][x]) continue
			const cx = originX + x * PITCH + ROOM / 2 + (rng() * 2 - 1) * jitterMax
			const cy = originY + y * PITCH + ROOM / 2 + (rng() * 2 - 1) * jitterMax
			const w = ROOM * (SCALE_MIN + rng() * (SCALE_MAX - SCALE_MIN))
			const h = ROOM * (SCALE_MIN + rng() * (SCALE_MAX - SCALE_MIN))
			boxes.set(cellKey(x, y), { cx, cy, w, h })
		}
	}

	const rects: TankRect<Id>[] = []
	const geo = (shape: string, w: number, h: number, extra: Record<string, unknown>) => ({ geo: shape, w, h, ...extra })

	// 2) ROOMS — one random-shape, random-scale geo per present cell. Colour/fill are the
	//    same light-orange Fill—Fill as the tidy generator (ORANGE), so the map keeps its
	//    original uniform look; only the SHAPE and SIZE vary.
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const b = boxes.get(cellKey(x, y))
			if (!b) continue
			const shape = pick(ROOM_SHAPES, rng)
			rects.push({ id: newId(), kind: 'room', x: b.cx - b.w / 2, y: b.cy - b.h / 2, w: b.w, h: b.h, props: geo(shape, b.w, b.h, ORANGE) })
		}
	}

	// 3) DOORWAYS — one orange rect per door edge, overlapping CHAOS_DOOR_OVERLAP into each
	//    room's ACTUAL box. Computed from the two real boxes so deep overlap is guaranteed.
	const addDoor = (x: number, y: number, dir: Dir) => {
		const a = boxes.get(cellKey(x, y))
		const b = boxes.get(cellKey(x + DELTA[dir].dx, y + DELTA[dir].dy))
		if (!a || !b) return
		if (dir === 'N') {
			// b is ABOVE a. Doorway runs vertically from CHAOS_DOOR_OVERLAP deep in b down to
			// CHAOS_DOOR_OVERLAP deep in a, centred on the average of their x-centres.
			const top = b.cy - b.h / 2 + b.h * (1 - CHAOS_DOOR_OVERLAP) // 50% down into b from its top
			const bottom = a.cy + a.h / 2 - a.h * (1 - CHAOS_DOOR_OVERLAP) // 50% up into a from its bottom
			const cx = (a.cx + b.cx) / 2
			// Mouth = a fraction of the narrower room's width, so the door fits both.
			const mouth = Math.min(a.w, b.w) * 0.34
			const yTop = Math.min(top, bottom)
			const hgt = Math.max(Math.abs(bottom - top), 8) // ≥8px so it's never a sliver
			rects.push({ id: newId(), kind: 'door', x: cx - mouth / 2, y: yTop, w: mouth, h: hgt, props: geo('rectangle', mouth, hgt, ORANGE) })
		} else {
			// dir 'W': b is to the LEFT of a. Doorway runs horizontally between their centres.
			const left = b.cx - b.w / 2 + b.w * (1 - CHAOS_DOOR_OVERLAP)
			const right = a.cx + a.w / 2 - a.w * (1 - CHAOS_DOOR_OVERLAP)
			const cy = (a.cy + b.cy) / 2
			const mouth = Math.min(a.h, b.h) * 0.34
			const xLeft = Math.min(left, right)
			const wid = Math.max(Math.abs(right - left), 8)
			rects.push({ id: newId(), kind: 'door', x: xLeft, y: cy - mouth / 2, w: wid, h: mouth, props: geo('rectangle', wid, mouth, ORANGE) })
		}
	}
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (!present[y][x]) continue
			if (y > 0 && present[y - 1][x] && grid[y][x].edges.N === 'door') addDoor(x, y, 'N')
			if (x > 0 && present[y][x - 1] && grid[y][x].edges.W === 'door') addDoor(x, y, 'W')
		}
	}

	// 4) FOOD — green pellets centred in reachable rooms' real boxes.
	const region = largestComponent(grid, present)
	for (const cell of chooseFood(region, CHAOS_FOOD_COUNT)) {
		const b = boxes.get(cellKey(cell.x, cell.y))
		if (!b) continue
		rects.push({ id: newId(), kind: 'food', x: b.cx - FOOD / 2, y: b.cy - FOOD / 2, w: FOOD, h: FOOD, props: geo('ellipse', FOOD, FOOD, { color: 'green', fill: 'solid' }) })
	}

	return rects
}
