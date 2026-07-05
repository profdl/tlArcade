/**
 * ROOM TREE — the PURE geometry for Scale Rooms (no tldraw import; takes an id factory,
 * so it's unit-testable without an editor — see __tests__/roomTree.test.ts).
 * ============================================================================
 * The world is a TREE of square rooms. Each room's children are SMALLER rooms (side ×
 * SCALE_RATIO = 1/√2) drawn OVERLAPPING the parent's floor — no hallways, no grid, no
 * gap. A child is always placed fully INSIDE its parent's square, so the doorway between
 * them lands on parent-walkable floor. Every room is its own scale/level: dive into a
 * child and it fills the viewport, holding its own children, up to MAX_DEPTH deep.
 *
 * WALKABILITY. A level's walkable floor is exactly its own room square (levelManager's
 * walkableRects). Child rooms drawn inside are visual patches + dive triggers, not walls
 * and not holes — you walk freely over the whole square and step onto a doorway to dive.
 *
 * PORTAL-DOORWAYS pair a parent and one child. Each non-root room draws ONE orange leaf on
 * its `connEdge` (the edge facing the parent's centre — guaranteed to have parent floor
 * beyond it). That single leaf is the visible door at BOTH scales. The triggers are
 * decoupled from the leaf and live in the layout that USES them, sized to THAT level:
 *   • a child's OUT portal (in the child's own layout, child-scale) — walk onto it inside
 *     the child to dive OUT to the parent; also where you land on a dive-IN.
 *   • a parent's IN portal per child (in the parent's layout, parent-scale) — walk onto it
 *     on the parent floor to dive INTO that child; also where you land on a dive-OUT.
 * The two are paired by the child's origin key, so a dive always lands on the matching end.
 */
import { mulberry32 } from './rng.ts'
import { CHILDREN_MAX, colorForDepth, DOOR_HALF, DOOR_MOUTH, MAX_DEPTH, ROOM_BUDGET, roomAtDepth, SCALE_RATIO } from './constants.ts'
import type { PlacementMode, WorldStyle } from './styles.ts'

export type Dir = 'N' | 'S' | 'E' | 'W'
export type PageRect = { x: number; y: number; w: number; h: number }

export type RoomRectKind = 'room' | 'portal'
export type RoomRect<Id> = {
	id: Id
	kind: RoomRectKind
	x: number
	y: number
	w: number
	h: number
	props: Record<string, unknown>
}

/**
 * A portal-doorway, in the coordinate scale of the level that owns it. `hit` is the ORANGE
 * rect you see straddling the wall — and the dive trigger (the player overlaps it), so the
 * two always coincide. The two ends of one connection share the SAME `hit` geometry:
 *   • kind 'out' — inside a (non-root) room, on its connEdge: dive OUT to the parent.
 *   • kind 'in'  — the parent's view of a child's doorway: dive INTO that child.
 */
export type PortalInfo = {
	kind: 'in' | 'out'
	edge: Dir
	hit: PageRect
	/** 'in' only — the origin key of the child this doorway descends into. */
	childKey?: string
}

export type RoomLayout<Id> = {
	/** The walkable square (also the camera-fit bounds). */
	roomRect: PageRect
	extent: { w: number; h: number }
	/** DRAWN rects: the room square, optional decor tiles, and (non-root) the orange leaf. */
	rects: RoomRect<Id>[]
	/** Triggers used AT this level: one 'out' (non-root) + one 'in' per child. */
	portals: PortalInfo[]
}

/** One node of the nested world: a room, its scale/colour, the edge facing its parent,
 *  its built layout, and its child rooms. Root has `connEdge: null`. */
export type RoomNode<Id> = {
	depth: number
	roomSize: number
	rect: PageRect
	color: string
	/** The edge of THIS room facing its parent's centre (where its doorway sits). Null at root. */
	connEdge: Dir | null
	layout: RoomLayout<Id>
	children: RoomNode<Id>[]
	/** Stable identity — the room's rounded page origin, unique across the whole tree. */
	key: string
}

/** Stable key for a room, by its page origin (rounded to shrug off float drift). */
export function originKey(x: number, y: number): string {
	return `${Math.round(x)},${Math.round(y)}`
}

/** A distinct child seed per parent + child index, derived from the world seed, so ONE
 *  seed reproduces the entire tree. */
function childSeedFor(parentSeed: number, index: number): number {
	return (parentSeed ^ 0x9e3779b9 ^ ((index + 1) * 2654435761)) >>> 0
}

/** Fisher–Yates shuffle of `arr` using `rng` (returns a new array). */
function shuffle<T>(arr: readonly T[], rng: () => number): T[] {
	const out = arr.slice()
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1))
		;[out[i], out[j]] = [out[j], out[i]]
	}
	return out
}

/** The four corners as (fx, fy) fractions of the free range [0, parent − child]. Index order
 *  matters for `cornersAwayFrom` below: 0 TL, 1 TR, 2 BL, 3 BR. */
const CORNERS: ReadonlyArray<{ fx: number; fy: number }> = [
	{ fx: 0, fy: 0 }, // 0 top-left
	{ fx: 1, fy: 0 }, // 1 top-right
	{ fx: 0, fy: 1 }, // 2 bottom-left
	{ fx: 1, fy: 1 }, // 3 bottom-right
]

/**
 * The corner indices NOT adjacent to `edge` — where a room may place its children so they
 * never cover the room's OWN exit doorway (on `edge`, facing its parent). Keeps every level's
 * exit reachable. `null` (the root, no exit) allows all four corners.
 */
export function cornersAwayFrom(edge: Dir | null): number[] {
	if (edge === null) return [0, 1, 2, 3]
	if (edge === 'E') return [0, 2] // exit on the right → children on the left corners
	if (edge === 'W') return [1, 3]
	if (edge === 'N') return [2, 3]
	return [0, 1] // S
}

/** Unit normal pointing OUT of a room across `edge` (away from the room's interior). */
export function outwardNormal(edge: Dir): { x: number; y: number } {
	if (edge === 'E') return { x: 1, y: 0 }
	if (edge === 'W') return { x: -1, y: 0 }
	if (edge === 'N') return { x: 0, y: -1 }
	return { x: 0, y: 1 } // S
}

/**
 * The ONE orange doorway rect straddling `rect`'s `edge` — drawn AND the dive trigger, so the
 * visible door IS the collision. Reaches DOOR_HALF onto each side of the wall (sized to the
 * room's own side), with a DOOR_MOUTH-wide opening along the wall. Shared by both ends of a
 * connection (a child's OUT door and its parent's IN door), so they line up exactly.
 */
export function connectorDoor(rect: PageRect, edge: Dir, roomSize: number): PageRect {
	const half = roomSize * DOOR_HALF
	const mouth = roomSize * DOOR_MOUTH
	const cx = rect.x + rect.w / 2
	const cy = rect.y + rect.h / 2
	if (edge === 'W') return { x: rect.x - half, y: cy - mouth / 2, w: half * 2, h: mouth }
	if (edge === 'E') return { x: rect.x + rect.w - half, y: cy - mouth / 2, w: half * 2, h: mouth }
	if (edge === 'N') return { x: cx - mouth / 2, y: rect.y - half, w: mouth, h: half * 2 }
	return { x: cx - mouth / 2, y: rect.y + rect.h - half, w: mouth, h: half * 2 } // S
}

/** Which edge of child `c` faces parent `p`'s centre — the axis of larger displacement wins,
 *  ties go horizontal. That edge always has parent floor beyond it (c ⊂ p), so a dive-out
 *  lands clear. */
export function connectionEdge(p: PageRect, c: PageRect): Dir {
	const dx = c.x + c.w / 2 - (p.x + p.w / 2)
	const dy = c.y + c.h / 2 - (p.y + p.h / 2)
	if (Math.abs(dx) >= Math.abs(dy)) return dx <= 0 ? 'E' : 'W'
	return dy <= 0 ? 'S' : 'N'
}

/** Resolve a possibly-'mixed' placement mode to a concrete one via a seeded draw. */
function resolvePlacement(mode: WorldStyle['placement'], rng: () => number): PlacementMode {
	if (mode !== 'mixed') return mode
	const modes: PlacementMode[] = ['corner', 'center', 'offset']
	return modes[Math.floor(rng() * modes.length)]
}

/** Child top-left within parent `p`, given the child `side`, its assigned `corner`, and mode.
 *  Always keeps the child fully inside the parent (free range [0, p.w − side]). */
function placeChild(p: PageRect, side: number, corner: { fx: number; fy: number }, mode: PlacementMode, rng: () => number): { x: number; y: number } {
	const free = p.w - side // p is square; free ≥ 0 since side = p.w * SCALE_RATIO < p.w
	const centerF = 0.5
	let fx: number
	let fy: number
	if (mode === 'center') {
		fx = centerF
		fy = centerF
	} else if (mode === 'corner') {
		fx = corner.fx
		fy = corner.fy
	} else {
		// offset: from the assigned corner up to 70% toward centre, so children still spread.
		const t = rng() * 0.7
		fx = corner.fx * (1 - t) + centerF * t
		fy = corner.fy * (1 - t) + centerF * t
	}
	return { x: p.x + fx * free, y: p.y + fy * free }
}

const ROOM_PROPS = (color: string) => ({ geo: 'rectangle', color, fill: 'solid' }) as const
/** Portal leaves are always orange, at every depth (a marker over walkable floor). */
const PORTAL_PROPS = { geo: 'rectangle', color: 'orange', fill: 'fill' } as const

/**
 * Build one room's layout: its drawn rects (the coloured square + its own orange leaf) and
 * the triggers used when standing in it (one 'out' to the parent, one 'in' per child). The
 * 'out' doorway is sized to THIS room; each 'in' doorway is sized to the CHILD it opens onto
 * (a localized opening on that small solid room's edge), so no door swamps the floor.
 */
function buildLayout<Id>(newId: () => Id, node: Omit<RoomNode<Id>, 'layout'>): RoomLayout<Id> {
	const { rect, roomSize, color, connEdge, children } = node
	const rects: RoomRect<Id>[] = [{ id: newId(), kind: 'room', x: rect.x, y: rect.y, w: rect.w, h: rect.h, props: ROOM_PROPS(color) }]

	const portals: PortalInfo[] = []

	// OUT — this room's own doorway back to its parent (non-root). The straddle door on connEdge
	// is BOTH drawn (orange) and the dive trigger, so the visible door is exactly the collision.
	if (connEdge) {
		const door = connectorDoor(rect, connEdge, roomSize)
		rects.push({ id: newId(), kind: 'portal', x: door.x, y: door.y, w: door.w, h: door.h, props: PORTAL_PROPS })
		portals.push({ kind: 'out', edge: connEdge, hit: door })
	}

	// IN — one per child: the SAME straddle door on the child's connEdge (sized to the child, so
	// it's a localized opening on that small solid room, not a slab scaled to this whole room).
	// Not drawn here — the child draws it as its own OUT door, so the two ends coincide exactly.
	for (const child of children) {
		const edge = child.connEdge! // children always face their parent
		const door = connectorDoor(child.rect, edge, child.roomSize)
		portals.push({ kind: 'in', edge, hit: door, childKey: child.key })
	}

	return { roomRect: rect, extent: { w: rect.w, h: rect.h }, rects, portals }
}

/**
 * Grow the whole nested world from one seed and style. A frontier of unexpanded rooms is
 * repeatedly popped (biased toward the deepest, so a spine reaches deep while the rest stays
 * bushy) and given 1–CHILDREN_MAX children, until ROOM_BUDGET rooms exist or every room is
 * at MAX_DEPTH. Rooms never expanded become LEAVES, so branch depths vary (2..16). Fully
 * seeded: child placement, count, and corners all derive from the world seed.
 * Returns the root, plus the total room count (for the budget log / tests).
 */
export function generateWorld<Id>(
	newId: () => Id,
	worldSeed: number,
	style: WorldStyle,
	opts?: { budget?: number; maxDepth?: number }
): { root: RoomNode<Id>; count: number } {
	const budget = opts?.budget ?? ROOM_BUDGET
	const maxDepth = opts?.maxDepth ?? MAX_DEPTH
	const rng = mulberry32(worldSeed)

	const rootSide = roomAtDepth(0)
	// Two-phase: build the geometry tree (mutable, no layouts yet), then attach layouts.
	type Draft = Omit<RoomNode<Id>, 'layout' | 'children'> & { children: Draft[]; seed: number }
	const root: Draft = {
		depth: 0,
		roomSize: rootSide,
		rect: { x: 0, y: 0, w: rootSide, h: rootSide },
		color: colorForDepth(0),
		connEdge: null,
		children: [],
		key: originKey(0, 0),
		seed: worldSeed,
	}

	let count = 1
	const frontier: Draft[] = [root]
	while (frontier.length > 0 && count < budget) {
		// Bias toward the deepest frontier node most of the time (drive a deep spine), else a
		// random one (keep the tree bushy) — the mix gives varied branch depths.
		let idx: number
		if (rng() < 0.6) {
			idx = 0
			for (let i = 1; i < frontier.length; i++) if (frontier[i].depth > frontier[idx].depth) idx = i
		} else {
			idx = Math.floor(rng() * frontier.length)
		}
		const parent = frontier.splice(idx, 1)[0]
		if (parent.depth >= maxDepth) continue

		const childRng = mulberry32(parent.seed)
		// Children go in the corners AWAY from this room's own exit edge, so a child can never
		// cover the exit doorway — every level stays escapable. (Root has no exit: all corners.)
		const anchors = cornersAwayFrom(parent.connEdge).map((ci) => CORNERS[ci])
		// Biased toward a single child (so the world reads as a corner-spiral, not a bush).
		const want = childRng() < 0.65 ? 1 : CHILDREN_MAX
		const k = Math.min(want, budget - count, CHILDREN_MAX, anchors.length)
		const corners = shuffle(anchors, childRng).slice(0, k)
		const childSide = parent.roomSize * SCALE_RATIO
		for (let i = 0; i < k; i++) {
			const seed = childSeedFor(parent.seed, i)
			const cRng = mulberry32(seed)
			const mode = resolvePlacement(style.placement, cRng)
			const { x, y } = placeChild(parent.rect, childSide, corners[i], mode, cRng)
			const cRect = { x, y, w: childSide, h: childSide }
			const child: Draft = {
				depth: parent.depth + 1,
				roomSize: childSide,
				rect: cRect,
				color: colorForDepth(parent.depth + 1),
				connEdge: connectionEdge(parent.rect, cRect),
				children: [],
				key: originKey(x, y),
				seed,
			}
			parent.children.push(child)
			frontier.push(child)
			count++
		}
	}

	// Attach layouts bottom-up (a layout needs its children's rects/connEdges for IN doors).
	const finalize = (d: Draft): RoomNode<Id> => {
		const children = d.children.map(finalize)
		const node: Omit<RoomNode<Id>, 'layout'> = {
			depth: d.depth,
			roomSize: d.roomSize,
			rect: d.rect,
			color: d.color,
			connEdge: d.connEdge,
			children,
			key: d.key,
		}
		return { ...node, layout: buildLayout(newId, node) }
	}

	return { root: finalize(root), count }
}
