/**
 * MAP GEOMETRY — the PURE rectangle layout for one level of Scale Portals.
 * =========================================================================
 * Turns a WFC room grid (../wfc/collapse.ts) into the list of rectangles to emit.
 * NO tldraw import — takes an id-factory instead of calling createShapeId — so this
 * geometry is unit-testable without an editor (see __tests__/mapGeometry.test.ts).
 *
 * THE CELL-ROLE MODEL. A world is a WFC grid whose present cells each have a role:
 *   • 'room'   — a plain blue room rect (the walkable floor).
 *   • 'submap' — NO room rect. Instead a SLOT (a smaller square centred in the cell
 *     footprint) that hosts a whole nested child map. Tunnels from neighbouring
 *     rooms run right up to the slot edge; reaching one is how you dive in.
 * Role assignment is PLUGGABLE (opts.roleFor, default a SEEDED per-cell coin flip —
 * any present cell can independently be a room or a submap), which is the modularity
 * seam: swap the function, or just tune opts.submapProb, to get sparser submaps,
 * all-rooms, etc. The coin flip is seeded from the map's own seed, so one world seed
 * still reproduces the whole nested world exactly.
 *
 * DOORS ARE PORT-TO-PORT. Each side of a door edge attaches to that cell's "port":
 * a room's port is its edge (poking DOOR_OVERLAP into the room, as always); a
 * submap's port is its SLOT edge, poking SLOT_POKE px INTO the slot — required
 * because the dive trigger (aabbOverlaps in collision.ts) is strict, so a player
 * flush against the slot boundary would never trigger; the poke lets them advance
 * a few px "onto" the slot while still standing in the walkable tunnel. The port
 * abstraction means room↔room, room↔submap, and submap↔submap edges all just work,
 * whatever the role pattern.
 *
 * SLOTS AND GATES ARE INDEPENDENT — the same map can have BOTH. `hasSlots` makes
 * a level a HOST (it offers submap slots to nest deeper maps); a non-empty
 * `gateEdges` makes it a GUEST (it carries one gate room per requested edge — the
 * edges being its own host cell's door directions — so every tunnel that reaches
 * its slot has exactly one gate facing it, 1–4 gates, straight or bent). A ROOT
 * map is host-only (slots, no gates); an INTERMEDIATE map is both (slots + gates)
 * so nesting can continue past depth 1; a LEAF map is guest-only (gates, no slots).
 * Gates are symmetric: any gate both receives arrivals from its tunnel and dives
 * you back out toward it. There is no entrance/exit.
 *
 * Both `roomSize` and `gap` are parameters so the SAME function builds the root
 * world and the smaller maps nested in its slots, at any depth.
 */
import { collapse, mulberry32, type TileGrid } from '../wfc/collapse.ts'
import { pruneAndConnect, type Present } from '../wfc/connectivity.ts'
import { DELTA, DIRS, type Dir } from '../wfc/tiles.ts'

/** How far (fraction of the room) a doorway pokes into a ROOM it connects. */
export const DOOR_OVERLAP = 0.1
/** The doorway's mouth width, as a fraction of the room side. */
export const DOOR_MOUTH = 0.34

/**
 * PORTAL-DOORWAYS. The dive trigger is NOT the whole slot/gate any more — it's a small
 * orange rect drawn like a door in a FLOORPLAN: a narrow opening set in the wall on the
 * boundary between a submap and its hallway. Each doorway is sized to its OWN map's room
 * (a host 'in' door to the parent room, a guest 'out' door to the child room), so it
 * reads as a proper door at that scale, and — crucially — its CENTRE lands on that map's
 * walkable floor, since that centre is exactly where a dive drops the arriving player.
 *
 * Geometry, all fractions of the owning map's room:
 *   • MOUTH — the door opening, across the tunnel. Narrow (< DOOR_MOUTH), like a real
 *     doorway rather than a wall-wide band.
 *   • REACH — how far the door reaches into the owning map's walkable INTERIOR.
 *   • CROSS — how far it overhangs ACROSS the boundary onto the far side, so it reads as
 *     sitting on the wall line.
 * A dive lands the player on the doorway's CENTRE, which sits (REACH − CROSS)/2 inside the
 * boundary. For the whole player (half-width PLAYER_FRACTION/2 = 0.06) to land clear of the
 * non-walkable boundary AND have slack to step off the doorway (needed to re-arm the exit
 * trigger — see gameLoop), that centre must clear the wall by a player half-width:
 *   (REACH − CROSS)/2 > PLAYER_FRACTION/2  ⟺  REACH − CROSS > PLAYER_FRACTION (0.12).
 * Keep MOUTH long relative to (REACH + CROSS) so the leaf reads as a thin floorplan door
 * along the wall, not a square block.
 *
 * DRAWN LEAF vs HIT RECT ARE DECOUPLED. The clearance bound pins how deep the LANDING rect
 * must reach — but that would force the drawn leaf to look like a chunky block. So each
 * doorway carries two rects (see PortalInfo): a thin VISUAL leaf that sits on the wall line
 * (what you see), and a deeper HIT rect (the dive trigger + landing point, never drawn).
 * The visual leaf is free to be a shallow floorplan door; only the hit rect owes the
 * REACH − CROSS > PLAYER_FRACTION clearance.
 *
 * TWO SIZES, by which side the doorway sits on:
 *   • OUT (a guest gate room, inside a submap) — you land here on a dive-IN and must walk
 *     clear to exit; the roomy wide-mouth door, with visual == hit (it already reads well).
 *   • IN (a host hallway, straddling a slot edge) — a marker in the parent tunnel (also the
 *     dive-OUT landing spot). Its VISUAL leaf is a thin door barely poking into the hallway;
 *     its HIT rect reaches deeper to keep the landing walkable.
 * (Kept as bare fractions, not imported from constants.ts, so this module stays
 * constants-free and unit-testable.)
 */
// Door MOUTHS are INSET from the tunnel walls (< DOOR_MOUTH = 0.34), leaving a jamb on
// either side so the leaf reads as an opening WITHIN the wall, not a wall-wide band.
// OUT doorway — visual and hit are the same roomy door.
export const PORTAL_OUT_MOUTH = 0.3
export const PORTAL_OUT_REACH = 0.16
export const PORTAL_OUT_CROSS = 0.02
// IN doorway HIT rect — deep enough to land on (REACH − CROSS > PLAYER_FRACTION), and kept
// wide (near the tunnel width) so the dive trigger is easy to walk onto.
export const PORTAL_IN_HIT_MOUTH = 0.3
export const PORTAL_IN_REACH = 0.145
export const PORTAL_IN_CROSS = 0.02
// IN doorway VISUAL leaf — a thin floorplan door inset within the wall, drawn only. Its
// REACH/CROSS need NOT clear the landing bound; it's never a landing target.
export const PORTAL_IN_VIS_MOUTH = 0.14
export const PORTAL_IN_VIS_REACH = 0.05
export const PORTAL_IN_VIS_CROSS = 0.04

export const ROOM_PROPS = { geo: 'rectangle', color: 'blue', fill: 'fill' } as const
export const CHILD_ROOM_PROPS = { geo: 'rectangle', color: 'light-green', fill: 'fill' } as const
/** Portal-doorways are always orange (a marker over walkable floor), at every depth. */
export const PORTAL_PROPS = { geo: 'rectangle', color: 'orange', fill: 'fill' } as const

/**
 * ONE COLOUR PER ZOOM LEVEL, so you can tell at a glance how deep you are. Depth 0
 * (the root, biggest) is blue; each dive shifts hue; the SMALLEST scale (the leaf,
 * === maxDepth) is always light-red. Colours are anchored to BOTH ends: depth 0 and
 * the leaf are pinned, the middle depths fill in from an ordered palette, so the
 * scheme still reads right if MAX_DEPTH changes. tldraw palette names only. */
const DEPTH_COLORS = ['blue', 'light-green', 'violet', 'orange', 'yellow'] as const
const SMALLEST_COLOR = 'light-red'

/** The room/door fill colour for a map at `depth`, given the deepest depth in the world.
 *  Leaf (depth === maxDepth) → light-red; otherwise the depth-th palette colour. */
export function colorForDepth(depth: number, maxDepth: number): string {
	if (depth >= maxDepth) return SMALLEST_COLOR
	return DEPTH_COLORS[Math.min(depth, DEPTH_COLORS.length - 1)]
}

/** Room props (geo/fill) for a map at `depth` — same shape as ROOM_PROPS, per-depth colour. */
export function roomPropsForDepth(depth: number, maxDepth: number): Record<string, unknown> {
	return { geo: 'rectangle', color: colorForDepth(depth, maxDepth), fill: 'fill' }
}

export type RoomRectKind = 'room' | 'door' | 'gate' | 'portal'

export type RoomRect<Id> = {
	id: Id
	kind: RoomRectKind
	x: number
	y: number
	w: number
	h: number
	props: Record<string, unknown>
}

export type GridCell = { x: number; y: number }
export type PageRect = { x: number; y: number; w: number; h: number }

export type CellRole = 'room' | 'submap'

/** A submap cell in a parent world: where its slot sits and which sides have tunnels. */
export type SubmapInfo = { cell: GridCell; slotRect: PageRect; doorDirs: Dir[] }

/** A child map's in/out room: which edge it faces (= the tunnel it pairs with). */
export type GateInfo = { edge: Dir; cell: GridCell; rect: PageRect }

/**
 * A portal-doorway: the small orange rect that triggers a dive (and marks where you
 * land). `dir` is the tunnel direction that pairs the two ends of one connection.
 *   • kind 'in'  — on a HOST map, at a submap's tunnel mouth (dive IN here; also the
 *     landing spot when you dive OUT of that submap). Carries the `submap` to descend into.
 *   • kind 'out' — on a GUEST map, at a gate (dive OUT here; also the landing spot when
 *     you dive IN to this map through the matching tunnel).
 */
export type PortalInfo = {
	kind: 'in' | 'out'
	dir: Dir
	/** The DRAWN orange leaf on the boundary — a thin floorplan door (visual only). */
	rect: PageRect
	/** The dive TRIGGER + LANDING rect (never drawn). Its CENTRE is the walkable point a dive
	 *  drops the arriving player onto, so it reaches deep enough to clear the boundary. For
	 *  OUT doorways this equals `rect`; for IN doorways it reaches farther than the thin leaf. */
	hit: PageRect
	submap?: SubmapInfo
}

export type MapLayout<Id> = {
	rects: RoomRect<Id>[]
	extent: { w: number; h: number }
	/** Where the player appears in this map (parent worlds; a room cell). */
	spawnCell: GridCell
	spawnRect: PageRect
	/** Parent worlds: the submap cells (each hosts a nested child map). */
	submaps: SubmapInfo[]
	/** Child maps: one gate per host-cell door direction. Empty for parents. */
	gates: GateInfo[]
	/** Portal-doorways: 'in' at each submap tunnel mouth (hosts), 'out' at each gate (guests). */
	portals: PortalInfo[]
}

/** Total page-space size of a `width x height` grid at the given room size/gap. */
export function roomExtent(width: number, height: number, roomSize: number, gap: number): { w: number; h: number } {
	const pitch = roomSize + gap
	return { w: width * pitch - gap, h: height * pitch - gap }
}

/** A distinct child seed per submap cell AND depth, derived from the world seed, so ONE
 *  seed reproduces the entire nested world. Depth is mixed in so two submaps at the same
 *  grid cell but different depths (e.g. cell (1,0) at depth 1 and at depth 2) don't clone
 *  the same map. Defaults depth to 1 for callers that predate nesting. */
export function childSeedFor(worldSeed: number, cell: GridCell, depth = 1): number {
	return (worldSeed ^ 0x9e3779b9 ^ (cell.x * 73856093) ^ (cell.y * 19349663) ^ (depth * 83492791)) >>> 0
}

function firstPresentCell(present: Present, width: number, height: number): GridCell {
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (present[y][x]) return { x, y }
		}
	}
	throw new Error('buildMapLayout: grid has no present cells')
}

/** The present cell farthest (Manhattan distance) from `from`, ties broken by scan order. */
function farthestPresentCell(present: Present, width: number, height: number, from: GridCell): GridCell {
	let best: GridCell = from
	let bestDist = -1
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (!present[y][x]) continue
			const dist = Math.abs(x - from.x) + Math.abs(y - from.y)
			if (dist > bestDist) {
				bestDist = dist
				best = { x, y }
			}
		}
	}
	return best
}

/**
 * Present cells on grid `edge`, sorted nearest-the-edge-centre first. Used to place a
 * child map's gates on the side facing each tunnel, so they line up with the tunnel
 * mouths. May be empty if the whole edge was pruned away.
 */
function cellsOnEdge(present: Present, width: number, height: number, edge: Dir): GridCell[] {
	const line: GridCell[] =
		edge === 'W'
			? Array.from({ length: height }, (_, y) => ({ x: 0, y }))
			: edge === 'E'
				? Array.from({ length: height }, (_, y) => ({ x: width - 1, y }))
				: edge === 'N'
					? Array.from({ length: width }, (_, x) => ({ x, y: 0 }))
					: Array.from({ length: width }, (_, x) => ({ x, y: height - 1 }))
	const centre = edge === 'W' || edge === 'E' ? (height - 1) / 2 : (width - 1) / 2
	const axis = (c: GridCell) => (edge === 'W' || edge === 'E' ? c.y : c.x)
	return line.filter((c) => present[c.y][c.x]).sort((a, b) => Math.abs(axis(a) - centre) - Math.abs(axis(b) - centre))
}

/** The directions in which cell `(cx,cy)` has a door to a PRESENT in-grid neighbour. */
function doorDirsOf(grid: TileGrid, present: Present, width: number, height: number, cx: number, cy: number): Dir[] {
	return DIRS.filter((dir) => {
		if (grid[cy][cx].edges[dir] !== 'door') return false
		const nx = cx + DELTA[dir].dx
		const ny = cy + DELTA[dir].dy
		return nx >= 0 && nx < width && ny >= 0 && ny < height && present[ny][nx]
	})
}

/**
 * Assign one DISTINCT gate cell per requested edge. Greedy: each edge takes its
 * nearest-to-centre unused edge cell; if an edge has no unused present cell
 * (heavy pruning), fall back to the present cell farthest from the already-used
 * ones' first pick. On a full 3x3 the four edge-middles are distinct, so the
 * fallback only matters under pruning.
 */
function assignGateCells(present: Present, width: number, height: number, edges: Dir[]): { edge: Dir; cell: GridCell }[] {
	const used = new Set<string>()
	const key = (c: GridCell) => `${c.x},${c.y}`
	const out: { edge: Dir; cell: GridCell }[] = []
	for (const edge of edges) {
		const candidate = cellsOnEdge(present, width, height, edge).find((c) => !used.has(key(c)))
		const cell =
			candidate ??
			(() => {
				// Whole edge pruned/taken: farthest present cell from the first gate (or spawn corner).
				const from = out[0]?.cell ?? firstPresentCell(present, width, height)
				const far = farthestPresentCell(present, width, height, from)
				return used.has(key(far)) ? firstPresentCell(present, width, height) : far
			})()
		used.add(key(cell))
		out.push({ edge, cell })
	}
	return out
}

export type BuildMapLayoutOptions = {
	/** Fraction of rooms to randomly remove (kept 4-connected) — see pruneAndConnect. */
	removeProb?: number
	/**
	 * HOST flag: does this level offer submap slots to nest deeper maps into? A root
	 * or intermediate map sets this true; a leaf map (deepest scale) sets it false.
	 * Independent of `gateEdges` — a map can have both slots (host) and gates (guest).
	 */
	hasSlots: boolean
	/**
	 * Host only: which role each present cell plays. Defaults to a SEEDED per-cell coin
	 * flip — any present cell can independently be a room or a submap (probability
	 * `submapProb`), never the spawn cell. THE modularity seam — swap for a checkerboard,
	 * sparser submaps, all-rooms, etc. Ignored when `hasSlots` false.
	 */
	roleFor?: (cell: GridCell) => CellRole
	/**
	 * Host only: probability a given present cell becomes a submap under the DEFAULT
	 * role function (the seeded coin flip). Ignored if `roleFor` is supplied. Default 0.5.
	 */
	submapProb?: number
	/** Host only: slot side length (the square a child map fills), page px. */
	slotSize?: number
	/** Host only: how far a tunnel pokes INTO a slot (so the dive trigger can fire). */
	slotPoke?: number
	/** Guest only: edges to place one gate on (this map's host cell's door dirs). */
	gateEdges?: Dir[]
	/** Room fill/color for normal rooms + doorways at this depth. Defaults to ROOM_PROPS. */
	roomProps?: Record<string, unknown>
}

/**
 * Build every rectangle for one level: a `width x height` room grid, top-left cell
 * at page `(originX, originY)`, each cell `roomSize` square with `gap` between
 * neighbours. Deterministic for a given seed + id factory.
 */
/** The middle cell of a grid edge — where a parent tunnel's centreline meets the child
 *  map, since tunnels run on cell centrelines and the child fills the slot exactly. */
export function edgeMiddleCell(width: number, height: number, edge: Dir): GridCell {
	const midX = Math.floor((width - 1) / 2)
	const midY = Math.floor((height - 1) / 2)
	if (edge === 'W') return { x: 0, y: midY }
	if (edge === 'E') return { x: width - 1, y: midY }
	if (edge === 'N') return { x: midX, y: 0 }
	return { x: midX, y: height - 1 }
}

export function buildMapLayout<Id>(
	newId: () => Id,
	width: number,
	height: number,
	seed: number,
	originX: number,
	originY: number,
	roomSize: number,
	gap: number,
	opts: BuildMapLayoutOptions
): MapLayout<Id> {
	// A child's GATE cells (the edge-middles facing each parent tunnel) are protected
	// from pruning — a pruned gate cell would make the gate slide along its edge, off
	// the tunnel's centreline, visually disconnecting portal from tunnel.
	let keep: Present | undefined
	if (opts.gateEdges && opts.gateEdges.length > 0) {
		keep = Array.from({ length: height }, () => Array.from({ length: width }, () => false))
		for (const edge of opts.gateEdges) {
			const cell = edgeMiddleCell(width, height, edge)
			keep[cell.y][cell.x] = true
		}
	}
	const { grid, present } = pruneAndConnect(collapse(width, height, seed), seed, opts.removeProb ?? 0, undefined, keep)
	const roomProps = opts.roomProps ?? ROOM_PROPS
	const rects: RoomRect<Id>[] = []

	const pitch = roomSize + gap
	const cellX = (x: number) => originX + x * pitch
	const cellY = (y: number) => originY + y * pitch
	const cellRect = (cell: GridCell): PageRect => ({ x: cellX(cell.x), y: cellY(cell.y), w: roomSize, h: roomSize })
	const isCell = (c: GridCell, x: number, y: number) => c.x === x && c.y === y

	const spawnCell = firstPresentCell(present, width, height)

	// ── GATES. Guest maps: one gate per requested edge (distinct cells). Computed FIRST
	//    because a gate is where a tunnel from the level above ARRIVES — it must be a
	//    solid walkable room, so gate cells force role 'room' below (they can never be
	//    submap slots, which would leave the arriving tunnel facing empty space). ──────
	const gates: GateInfo[] =
		opts.gateEdges && opts.gateEdges.length > 0
			? assignGateCells(present, width, height, opts.gateEdges).map(({ edge, cell }) => ({ edge, cell, rect: cellRect(cell) }))
			: []
	const gateAt = (x: number, y: number) => gates.find((g) => isCell(g.cell, x, y))

	// ── ROLES. Host: rooms vs submap slots (pluggable; default a SEEDED per-cell coin
	//    flip, so ANY present cell can independently be a room or a submap). The spawn
	//    cell and every gate cell are pinned to 'room' — you must be able to stand where
	//    you arrive, so neither can be a slot. This is what lets an INTERMEDIATE map be
	//    both host (slots) and guest (gates): gates simply override the coin flip there. ─
	//    Each eligible cell draws one value from a stream seeded by (this map's seed,
	//    cell), so roles are scan-order-independent and one world seed reproduces them
	//    all. GUARANTEE: a host map always ends up with ≥1 submap (else the scale would
	//    be a dead end with no dive-in) — if every flip came up 'room' we promote the
	//    single cell that flipped closest to submap. `submapProb` 0 opts out (all-rooms).
	const submapProb = opts.submapProb ?? 0.5
	const cellKey = (c: GridCell) => `${c.x},${c.y}`
	const flipFor = (c: GridCell): number => mulberry32((seed ^ (c.x * 73856093) ^ (c.y * 19349663) ^ 0x5f356495) >>> 0)()
	const eligible: { cell: GridCell; roll: number }[] = []
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (!present[y][x] || isCell(spawnCell, x, y) || gateAt(x, y)) continue
			eligible.push({ cell: { x, y }, roll: flipFor({ x, y }) })
		}
	}
	const submapCells = new Set(eligible.filter((e) => e.roll < submapProb).map((e) => cellKey(e.cell)))
	if (submapCells.size === 0 && submapProb > 0 && eligible.length > 0) {
		const promoted = eligible.reduce((a, b) => (b.roll < a.roll ? b : a))
		submapCells.add(cellKey(promoted.cell))
	}
	const defaultRoleFor = (c: GridCell): CellRole => (submapCells.has(cellKey(c)) ? 'submap' : 'room')
	const roleFor = opts.hasSlots ? (opts.roleFor ?? defaultRoleFor) : () => 'room' as CellRole
	const roleAt = (x: number, y: number): CellRole =>
		isCell(spawnCell, x, y) || gateAt(x, y) ? 'room' : roleFor({ x, y })

	const slotSize = opts.slotSize ?? roomSize
	const slotPoke = opts.slotPoke ?? 0
	const slotRect = (cell: GridCell): PageRect => {
		const inset = (roomSize - slotSize) / 2
		return { x: cellX(cell.x) + inset, y: cellY(cell.y) + inset, w: slotSize, h: slotSize }
	}

	const submaps: SubmapInfo[] = []
	if (opts.hasSlots) {
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				if (!present[y][x] || roleAt(x, y) !== 'submap') continue
				submaps.push({ cell: { x, y }, slotRect: slotRect({ x, y }), doorDirs: doorDirsOf(grid, present, width, height, x, y) })
			}
		}
	}

	// 1) ROOMS — one rect per present ROOM cell (submap cells emit nothing here; the
	//    nested child map occupies their slot).
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (!present[y][x] || roleAt(x, y) !== 'room') continue
			const gate = gateAt(x, y)
			rects.push({
				id: newId(),
				kind: gate ? 'gate' : 'room',
				x: cellX(x),
				y: cellY(y),
				w: roomSize,
				h: roomSize,
				// Gates take the map's own depth colour — their POSITION at a tunnel mouth
				// marks them, not a special tint — so each whole map reads as one colour.
				props: roomProps,
			})
		}
	}

	// 2) DOORWAYS — one rect per door edge, PORT to PORT. A room's port pokes
	//    DOOR_OVERLAP into the room; a submap's port pokes `slotPoke` into its slot.
	//    Doors are walkable floor; slots are NOT — reaching a slot ends in a dive.
	const overlap = roomSize * DOOR_OVERLAP
	const mouth = roomSize * DOOR_MOUTH
	/** How far this cell's port extends toward/into the cell, from the cell's outer
	 *  edge along `dir` (the axis the door travels). Positive = into the cell. */
	const portDepth = (x: number, y: number): number =>
		roleAt(x, y) === 'submap' ? (roomSize - slotSize) / 2 + slotPoke : overlap
	const addDoor = (x: number, y: number, dir: Dir) => {
		// The door bridges from inside cell (x,y) across the gap into its `dir` neighbour.
		const nx = x + DELTA[dir].dx
		const ny = y + DELTA[dir].dy
		if (dir === 'N') {
			// From inside (x,y)'s top edge up into (x,y-1)'s bottom edge.
			const top = cellY(ny) + roomSize - portDepth(nx, ny)
			const bottom = cellY(y) + portDepth(x, y)
			const cx = cellX(x) + roomSize / 2
			rects.push({ id: newId(), kind: 'door', x: cx - mouth / 2, y: top, w: mouth, h: bottom - top, props: roomProps })
		} else {
			// dir === 'W': from inside (x,y)'s left edge across into (x-1,y)'s right edge.
			const left = cellX(nx) + roomSize - portDepth(nx, ny)
			const right = cellX(x) + portDepth(x, y)
			const cy = cellY(y) + roomSize / 2
			rects.push({ id: newId(), kind: 'door', x: left, y: cy - mouth / 2, w: right - left, h: mouth, props: roomProps })
		}
	}
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (!present[y][x]) continue
			if (y > 0 && present[y - 1][x] && grid[y][x].edges.N === 'door') addDoor(x, y, 'N')
			if (x > 0 && present[y][x - 1] && grid[y][x].edges.W === 'door') addDoor(x, y, 'W')
		}
	}

	// 3) PORTAL-DOORWAYS — the small orange rects that trigger a dive and mark where you
	//    land. A HOST emits one 'in' doorway per submap tunnel, straddling the slot edge
	//    but reaching into the hallway (parent-walkable); a GUEST emits one 'out' doorway
	//    per gate, straddling the child edge but reaching into the gate room (child-
	//    walkable). Both are drawn (added to `rects`) but excluded from collision
	//    (walkableRects skips kind 'portal') — pure markers over existing floor. Each
	//    rect's CENTRE is where the arriving player is placed, so it must land on walkable
	//    floor: REACH exceeds CROSS by > the player half-width, keeping the centre inside.
	/** A doorway rect straddling `box`'s `edge`, sized by explicit fractions-in-px. Reaches
	 *  `reach` into the OWNING interior and overhangs `cross` across the boundary onto the far
	 *  side, with a `mouth`-wide opening along the wall. `outward` true → the interior is
	 *  OUTSIDE the box (host slot → hallway); false → INSIDE the box (guest gate room). */
	const doorway = (box: PageRect, edge: Dir, outward: boolean, reach: number, cross: number, mouth: number): PageRect => {
		const thick = reach + cross
		const cx = box.x + box.w / 2
		const cy = box.y + box.h / 2
		if (edge === 'W') return { x: (outward ? box.x - reach : box.x - cross), y: cy - mouth / 2, w: thick, h: mouth }
		if (edge === 'E') return { x: (outward ? box.x + box.w - cross : box.x + box.w - reach), y: cy - mouth / 2, w: thick, h: mouth }
		if (edge === 'N') return { x: cx - mouth / 2, y: (outward ? box.y - reach : box.y - cross), w: mouth, h: thick }
		return { x: cx - mouth / 2, y: (outward ? box.y + box.h - cross : box.y + box.h - reach), w: mouth, h: thick }
	}
	// OUT (guest gate room): visual == hit — one roomy wide-mouth door you land on and exit.
	const outRect = (box: PageRect, edge: Dir) =>
		doorway(box, edge, false, roomSize * PORTAL_OUT_REACH, roomSize * PORTAL_OUT_CROSS, roomSize * PORTAL_OUT_MOUTH)
	// IN (host hallway): a THIN visual leaf on the wall, but a DEEPER hit rect (dive trigger +
	// dive-out landing) so the arriving player still lands on walkable hallway floor.
	const inVisual = (box: PageRect, edge: Dir) =>
		doorway(box, edge, true, roomSize * PORTAL_IN_VIS_REACH, roomSize * PORTAL_IN_VIS_CROSS, roomSize * PORTAL_IN_VIS_MOUTH)
	const inHit = (box: PageRect, edge: Dir) =>
		doorway(box, edge, true, roomSize * PORTAL_IN_REACH, roomSize * PORTAL_IN_CROSS, roomSize * PORTAL_IN_HIT_MOUTH)
	const portals: PortalInfo[] = []
	for (const submap of submaps) {
		for (const dir of submap.doorDirs)
			portals.push({ kind: 'in', dir, rect: inVisual(submap.slotRect, dir), hit: inHit(submap.slotRect, dir), submap })
	}
	for (const gate of gates) {
		const r = outRect(cellRect(gate.cell), gate.edge)
		portals.push({ kind: 'out', dir: gate.edge, rect: r, hit: r })
	}
	for (const p of portals) rects.push({ id: newId(), kind: 'portal', x: p.rect.x, y: p.rect.y, w: p.rect.w, h: p.rect.h, props: PORTAL_PROPS })

	return {
		rects,
		extent: roomExtent(width, height, roomSize, gap),
		spawnCell,
		spawnRect: cellRect(spawnCell),
		submaps,
		gates,
		portals,
	}
}
