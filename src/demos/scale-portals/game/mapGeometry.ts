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
 * Role assignment is PLUGGABLE (opts.roleFor, default checkerboard parity), which is
 * the modularity seam: swap the function to get sparser submaps, all-rooms, etc.
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
 * A CHILD map (role 'child') is a plain all-rooms map plus GATES: one gate
 * room per requested edge — the edges being the host submap cell's door directions
 * — so every tunnel that reaches the slot has exactly one gate facing it (1–4
 * gates, straight or bent). Gates are symmetric: any gate both receives arrivals
 * from its tunnel and dives you back out toward it. There is no entrance/exit.
 *
 * Both `roomSize` and `gap` are parameters so the SAME function builds a parent
 * world and the smaller child maps nested in its slots.
 */
import { collapse, type TileGrid } from '../wfc/collapse.ts'
import { pruneAndConnect, type Present } from '../wfc/connectivity.ts'
import { DELTA, DIRS, type Dir } from '../wfc/tiles.ts'

/** How far (fraction of the room) a doorway pokes into a ROOM it connects. */
export const DOOR_OVERLAP = 0.1
/** The doorway's mouth width, as a fraction of the room side. */
export const DOOR_MOUTH = 0.34

export const ROOM_PROPS = { geo: 'rectangle', color: 'blue', fill: 'fill' } as const
export const CHILD_ROOM_PROPS = { geo: 'rectangle', color: 'light-green', fill: 'fill' } as const
/** A child map's gate rooms — same colour as its regular rooms (the gate's position
 *  at a tunnel mouth is what marks it, not a special colour). Kept as a separate
 *  const so gates can be re-tinted in one place. */
export const GATE_PROPS = { geo: 'rectangle', color: 'light-green', fill: 'fill' } as const

export type RoomRectKind = 'room' | 'door' | 'gate'

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
}

/** Total page-space size of a `width x height` grid at the given room size/gap. */
export function roomExtent(width: number, height: number, roomSize: number, gap: number): { w: number; h: number } {
	const pitch = roomSize + gap
	return { w: width * pitch - gap, h: height * pitch - gap }
}

/** A distinct child seed per submap cell, derived from the world seed, so ONE seed
 *  reproduces the entire world — the parent layout and every small-map. */
export function childSeedFor(worldSeed: number, cell: GridCell): number {
	return (worldSeed ^ 0x9e3779b9 ^ (cell.x * 73856093) ^ (cell.y * 19349663)) >>> 0
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
	/** 'parent': a world of rooms + submap slots. 'child': an all-rooms map with gates. */
	role: 'parent' | 'child'
	/**
	 * Parent only: which role each present cell plays. Defaults to checkerboard parity
	 * ((x+y) odd → submap), never the spawn cell. THE modularity seam — swap for
	 * sparser submaps, all-rooms, weighted random, etc.
	 */
	roleFor?: (cell: GridCell) => CellRole
	/** Parent only: slot side length (the square a child map fills), page px. */
	slotSize?: number
	/** Parent only: how far a tunnel pokes INTO a slot (so the dive trigger can fire). */
	slotPoke?: number
	/** Child only: edges to place one gate on (the host cell's door dirs). */
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
	if (opts.role === 'child' && opts.gateEdges && opts.gateEdges.length > 0) {
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

	// ── ROLES. Parent: rooms vs submap slots (pluggable; default checkerboard). ──
	const defaultRoleFor = (c: GridCell): CellRole =>
		(c.x + c.y) % 2 === 1 && !isCell(spawnCell, c.x, c.y) ? 'submap' : 'room'
	const roleFor = opts.role === 'parent' ? (opts.roleFor ?? defaultRoleFor) : () => 'room' as CellRole
	const roleAt = (x: number, y: number): CellRole => (isCell(spawnCell, x, y) ? 'room' : roleFor({ x, y }))

	const slotSize = opts.slotSize ?? roomSize
	const slotPoke = opts.slotPoke ?? 0
	const slotRect = (cell: GridCell): PageRect => {
		const inset = (roomSize - slotSize) / 2
		return { x: cellX(cell.x) + inset, y: cellY(cell.y) + inset, w: slotSize, h: slotSize }
	}

	const submaps: SubmapInfo[] = []
	if (opts.role === 'parent') {
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				if (!present[y][x] || roleAt(x, y) !== 'submap') continue
				submaps.push({ cell: { x, y }, slotRect: slotRect({ x, y }), doorDirs: doorDirsOf(grid, present, width, height, x, y) })
			}
		}
	}

	// ── GATES. Child: one gate per requested edge (distinct cells). ──────────────
	const gates: GateInfo[] =
		opts.role === 'child' && opts.gateEdges && opts.gateEdges.length > 0
			? assignGateCells(present, width, height, opts.gateEdges).map(({ edge, cell }) => ({ edge, cell, rect: cellRect(cell) }))
			: []
	const gateAt = (x: number, y: number) => gates.find((g) => isCell(g.cell, x, y))

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
				props: gate ? GATE_PROPS : roomProps,
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

	return {
		rects,
		extent: roomExtent(width, height, roomSize, gap),
		spawnCell,
		spawnRect: cellRect(spawnCell),
		submaps,
		gates,
	}
}
