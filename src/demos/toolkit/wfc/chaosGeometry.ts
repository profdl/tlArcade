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
import { ROOM, GAP, PITCH, FOOD, ORANGE, rotatedHalfExtents, type TankRect } from './tankGeometry.ts'

// ── CHAOS KNOBS ──────────────────────────────────────────────────────────────────
/** A room's side is ROOM × a random factor in [MIN, MAX] — varied scales. */
export const SCALE_MIN = 0.55
export const SCALE_MAX = 1.35
/**
 * A few rooms become BIG LANDMARK chambers — picked at random and scaled up by a factor in
 * [BIG_ROOM_SCALE_MIN, BIG_ROOM_SCALE_MAX] (×3–4 the others). BIG_ROOM_COUNT of them per map.
 * Enlarging only grows a room's box around its UNCHANGED centre, so the centre-to-centre doors
 * still hit both centres and its bigger AABB only overlaps its doorways MORE — connectivity is
 * unaffected; it just adds dramatic scale variety.
 */
export const BIG_ROOM_COUNT = 3
export const BIG_ROOM_SCALE_MIN = 3
export const BIG_ROOM_SCALE_MAX = 4
/**
 * Doorway MOUTH (width across the opening). A doorway is computed as a fraction of the smaller
 * room's half-extent, but floored at DOOR_MOUTH_MIN so even a door off a tiny room is wide
 * enough for a fish. A creature's default body is 120×64, so its MINOR span is ~64px; the swim
 * loop confines a transiting fish to the doorway's bounding box, so the mouth must comfortably
 * exceed 64. DOOR_MOUTH_MIN = 96 (~1.5× the body's minor span) leaves margin for the body to
 * turn through the opening without pinning a wall.
 */
export const DOOR_MOUTH_FRAC = 0.7
export const DOOR_MOUTH_MIN = 96
/**
 * Max room-centre jitter as a fraction of GAP, per axis. CLAMPED below GAP/2 so two
 * adjacent room CENTRES can never cross (order preserved) and the gap between adjacent
 * AABBs stays in a bridgeable band — combined with the 50% doorway reach, every door is
 * provably a positive-area overlap. ~0.35·GAP keeps rooms clearly off the grid lines
 * without ever letting a 50% doorway fail to bridge.
 */
export const JITTER_FRAC = 0.35
/** How many food pellets to scatter — kept sparse so the map isn't carpeted in food. */
export const CHAOS_FOOD_COUNT = 5
/**
 * Max ROOM rotation, radians. Rooms can rotate freely (their rotated AABB just grows, which
 * only helps doorway overlap), so a generous ±0.5 rad (~29°) tilts shapes off-grid. The swim
 * loop confines to the rotated AABB, so a tilted shape reads as a bigger bounding box with
 * larger dead corners — purely cosmetic complication, navigation unchanged.
 */
export const ROOM_ROT_MAX = 0.5

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

/**
 * A room's resolved placement. `cx,cy` is the page-space CENTRE; `w,h` the LOCAL (un-rotated)
 * box; `rotation` its tilt. `hx,hy` are the half-extents of its ROTATED AABB — the box the
 * swim loop actually confines/clusters by, so every doorway overlap is computed against this,
 * NOT the raw w/2,h/2. (A rotated box's AABB grows, which only helps overlap.)
 */
type RoomBox = { cx: number; cy: number; w: number; h: number; rotation: number; hx: number; hy: number }

/** Top-left of a w×h box whose CENTRE is (cx,cy) when rotated by θ (tldraw rotates about the
 *  top-left origin, so the centre→top-left offset (w/2,h/2) is itself rotated by θ). */
function topLeftFor(cx: number, cy: number, w: number, h: number, rotation: number): { x: number; y: number } {
	const cos = Math.cos(rotation)
	const sin = Math.sin(rotation)
	const ox = w / 2
	const oy = h / 2
	return { x: cx - (ox * cos - oy * sin), y: cy - (ox * sin + oy * cos) }
}

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
			const rotation = (rng() * 2 - 1) * ROOM_ROT_MAX
			const { hx, hy } = rotatedHalfExtents(w, h, rotation)
			boxes.set(cellKey(x, y), { cx, cy, w, h, rotation, hx, hy })
		}
	}

	// 1b) Enlarge a few random rooms into BIG LANDMARK chambers (×3–4). We grow the box around
	//     its existing centre and recompute its rotated AABB; centre stays put, so doors (which
	//     run centre-to-centre) still connect and the bigger AABB only overlaps them more.
	const bigKeys = [...boxes.keys()]
	for (let i = bigKeys.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1))
		;[bigKeys[i], bigKeys[j]] = [bigKeys[j], bigKeys[i]]
	}
	for (const k of bigKeys.slice(0, Math.min(BIG_ROOM_COUNT, bigKeys.length))) {
		const b = boxes.get(k)!
		const factor = BIG_ROOM_SCALE_MIN + rng() * (BIG_ROOM_SCALE_MAX - BIG_ROOM_SCALE_MIN)
		const w = b.w * factor
		const h = b.h * factor
		const { hx, hy } = rotatedHalfExtents(w, h, b.rotation)
		boxes.set(k, { ...b, w, h, hx, hy })
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
			const tl = topLeftFor(b.cx, b.cy, b.w, b.h, b.rotation)
			rects.push({ id: newId(), kind: 'room', x: tl.x, y: tl.y, w: b.w, h: b.h, rotation: b.rotation, props: geo(shape, b.w, b.h, ORANGE) })
		}
	}

	// 3) DOORWAYS — one rectangle per door edge, spanning CENTRE-to-CENTRE between the two
	//    rooms. Reaching each room's CENTRE (not its AABB edge) is what makes the door visibly
	//    plunge INTO every shape: a non-rectangular or rotated shape's AABB extends past its
	//    painted outline, so a door that stopped at the box edge could end in an empty corner,
	//    detached from the shape (the gap seen in testing). Every geo shape contains its centre,
	//    so a centre-to-centre bar is always solidly inside both rooms — visually and for the
	//    swim loop's AABB clustering (it overlaps both AABBs by a wide margin).
	const emitDoor = (a: RoomBox, b: RoomBox) => {
		const cx = (a.cx + b.cx) / 2
		const cy = (a.cy + b.cy) / 2
		const len = Math.max(Math.hypot(b.cx - a.cx, b.cy - a.cy), 8)
		// Wide enough for a fish: a fraction of the smaller room's half-extent, but never below
		// DOOR_MOUTH_MIN so even a door off a tiny room admits a body. (See the knob's comment.)
		const mouth = Math.max(Math.min(Math.min(a.hx, a.hy), Math.min(b.hx, b.hy)) * DOOR_MOUTH_FRAC, DOOR_MOUTH_MIN)
		// Rotation IS the centre-to-centre angle (no extra tilt), so the bar's two ends land
		// exactly on the two room centres and it passes straight through both shapes.
		const rotation = Math.atan2(b.cy - a.cy, b.cx - a.cx)
		const tl = topLeftFor(cx, cy, len, mouth, rotation)
		rects.push({ id: newId(), kind: 'door', x: tl.x, y: tl.y, w: len, h: mouth, rotation, props: geo('rectangle', len, mouth, ORANGE) })
	}

	const addDoor = (x: number, y: number, dir: Dir) => {
		const a = boxes.get(cellKey(x, y))
		const b = boxes.get(cellKey(x + DELTA[dir].dx, y + DELTA[dir].dy))
		if (a && b) emitDoor(a, b)
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
