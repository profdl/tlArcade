/**
 * MAP GEOMETRY — the PURE rectangle layout for one level of Scale Portals.
 * =========================================================================
 * Turns a WFC room grid (../wfc/collapse.ts) into the list of rectangles to emit.
 * NO tldraw import — takes an id-factory instead of calling createShapeId — so this
 * geometry is unit-testable without an editor (see __tests__/mapGeometry.test.ts).
 *
 * Two ROLES:
 *   • 'parent' — a big map of blue rooms. Some rooms (a checkerboard, so they
 *     ALTERNATE with plain rooms) are PORTALS: each holds a whole nested child map.
 *     A portal room looks like any other blue room — the tiny map sitting inside it
 *     is what marks it — so there's no border to distinguish it.
 *   • 'child' — a smaller map nested inside a portal room. It's a PASS-THROUGH: it
 *     has an ENTRANCE (where the player appears, on the edge facing one parent
 *     tunnel) and an EXIT marker (on the edge facing another), so you walk in one
 *     side and out the other.
 *
 * Both `roomSize` and `gap` are parameters (not fixed constants) so the SAME
 * function builds a parent map and a smaller child map that nests exactly inside
 * one parent room — the caller (gameLoop) scales both by the same factor.
 */
import { collapse, type TileGrid } from '../wfc/collapse.ts'
import { pruneAndConnect, type Present } from '../wfc/connectivity.ts'
import { DELTA, DIRS, opposite, type Dir } from '../wfc/tiles.ts'

/** How far (fraction of the room) a doorway pokes into each room it connects. */
export const DOOR_OVERLAP = 0.1
/** The doorway's mouth width, as a fraction of the room side. */
export const DOOR_MOUTH = 0.34

export const ROOM_PROPS = { geo: 'rectangle', color: 'blue', fill: 'fill' } as const
export const CHILD_ROOM_PROPS = { geo: 'rectangle', color: 'light-green', fill: 'fill' } as const
/** A child map's entrance/exit rooms — orange, so they read as "in/out of this map". */
export const PORTAL_ROOM_PROPS = { geo: 'rectangle', color: 'orange', fill: 'fill' } as const

/** 'portal' = a parent room hosting a child map. 'entrance'/'exit' = a child's two
 *  orange in/out rooms (both let you leave the child). */
export type RoomRectKind = 'room' | 'door' | 'portal' | 'entrance' | 'exit'

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

/** A parent room that hosts a nested child map, plus the tunnel sides it connects on. */
export type PortalInfo = { cell: GridCell; rect: PageRect; doorDirs: Dir[] }

export type MapLayout<Id> = {
	rects: RoomRect<Id>[]
	extent: { w: number; h: number }
	/** Where the player appears in this map. For a child, this is its entrance room. */
	spawnCell: GridCell
	spawnRect: PageRect
	/** Parent maps: the rooms that hold nested child maps. Empty for a child map. */
	portals: PortalInfo[]
	/** Child maps: the two orange in/out rooms. The entrance is also the spawn
	 *  (spawnCell/spawnRect); the exit is the far one. Both let you leave the child.
	 *  Undefined for a parent map. */
	exitCell?: GridCell
	exitRect?: PageRect
}

/** Total page-space size of a `width x height` grid at the given room size/gap. */
export function roomExtent(width: number, height: number, roomSize: number, gap: number): { w: number; h: number } {
	const pitch = roomSize + gap
	return { w: width * pitch - gap, h: height * pitch - gap }
}

function firstPresentCell(present: Present, width: number, height: number): GridCell {
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (present[y][x]) return { x, y }
		}
	}
	throw new Error('buildMapLayout: grid has no present cells')
}

/**
 * The present cell on grid `edge`, nearest the centre of that edge. Used to place a
 * child map's entrance/exit on the side facing a parent tunnel, so it lines up with
 * the tunnel mouth. Falls back to the nearest present cell if that edge was pruned away.
 */
function cellOnEdge(present: Present, width: number, height: number, edge: Dir): GridCell {
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
	const onEdge = line.filter((c) => present[c.y][c.x]).sort((a, b) => Math.abs(axis(a) - centre) - Math.abs(axis(b) - centre))
	return onEdge[0] ?? firstPresentCell(present, width, height)
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

export type BuildMapLayoutOptions = {
	/** Fraction of rooms to randomly remove (kept 4-connected) — see pruneAndConnect. */
	removeProb?: number
	/** 'parent': mark a checkerboard of rooms as portals. 'child': a pass-through map. */
	role: 'parent' | 'child'
	/** Child only: grid edge to place the entrance/spawn on (faces the tunnel you enter from). */
	entranceEdge?: Dir
	/** Child only: grid edge to place the exit marker on (faces the onward tunnel). */
	exitEdge?: Dir
	/** Room fill/color for normal rooms + doorways at this depth. Defaults to ROOM_PROPS. */
	roomProps?: Record<string, unknown>
}

/**
 * Build every rectangle for one level: a `width x height` room grid, top-left room
 * at page `(originX, originY)`, each room `roomSize` square with `gap` between
 * neighbours. Deterministic for a given seed + id factory.
 */
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
	const { grid, present } = pruneAndConnect(collapse(width, height, seed), seed, opts.removeProb ?? 0)
	const roomProps = opts.roomProps ?? ROOM_PROPS
	const rects: RoomRect<Id>[] = []

	const pitch = roomSize + gap
	const roomX = (x: number) => originX + x * pitch
	const roomY = (y: number) => originY + y * pitch
	const cellRect = (cell: GridCell): PageRect => ({ x: roomX(cell.x), y: roomY(cell.y), w: roomSize, h: roomSize })
	const isCell = (c: GridCell, x: number, y: number) => c.x === x && c.y === y

	const spawnCell =
		opts.role === 'child' && opts.entranceEdge
			? cellOnEdge(present, width, height, opts.entranceEdge)
			: firstPresentCell(present, width, height)

	// PARENT: mark a checkerboard of present rooms (excluding spawn) as portals, so
	// portal rooms ALTERNATE with plain blue rooms. CHILD: pick the exit marker room.
	const portals: PortalInfo[] = []
	let exitCell: GridCell | undefined
	if (opts.role === 'parent') {
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				if (!present[y][x] || isCell(spawnCell, x, y)) continue
				if ((x + y) % 2 !== 1) continue // checkerboard: only "odd" cells host maps
				portals.push({ cell: { x, y }, rect: cellRect({ x, y }), doorDirs: doorDirsOf(grid, present, width, height, x, y) })
			}
		}
	} else {
		exitCell = opts.exitEdge ? cellOnEdge(present, width, height, opts.exitEdge) : firstPresentCell(present, width, height)
	}
	const isPortal = (x: number, y: number) => portals.some((p) => isCell(p.cell, x, y))

	// 1) ROOMS — one rect per present cell. Parent portal rooms look like normal blue
	//    rooms (no border — the nested map inside marks them). A child's entrance and
	//    exit rooms are BOTH orange (the two in/out portals); other child rooms are green.
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (!present[y][x]) continue
			const portal = isPortal(x, y)
			const entrance = opts.role === 'child' && isCell(spawnCell, x, y)
			const exit = exitCell != null && isCell(exitCell, x, y)
			const kind: RoomRectKind = portal ? 'portal' : entrance ? 'entrance' : exit ? 'exit' : 'room'
			const props = entrance || exit ? PORTAL_ROOM_PROPS : roomProps
			rects.push({ id: newId(), kind, x: roomX(x), y: roomY(y), w: roomSize, h: roomSize, props })
		}
	}

	// 2) DOORWAYS — one rect per door edge, poking DOOR_OVERLAP into each room.
	const overlap = roomSize * DOOR_OVERLAP
	const mouth = roomSize * DOOR_MOUTH
	const addDoor = (x: number, y: number, dir: Dir) => {
		const ax = roomX(x)
		const ay = roomY(y)
		const nx = x + DELTA[dir].dx
		const ny = y + DELTA[dir].dy
		const bx = roomX(nx)
		const by = roomY(ny)
		if (dir === 'N') {
			const top = by + roomSize - overlap
			const bottom = ay + overlap
			const cx = ax + roomSize / 2
			rects.push({ id: newId(), kind: 'door', x: cx - mouth / 2, y: top, w: mouth, h: bottom - top, props: roomProps })
		} else {
			// dir === 'W'
			const left = bx + roomSize - overlap
			const right = ax + overlap
			const cy = ay + roomSize / 2
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
		portals,
		exitCell,
		exitRect: exitCell ? cellRect(exitCell) : undefined,
	}
}

/** Choose the two edges a child map's entrance and exit sit on, from a portal room's
 *  tunnel sides. Entrance faces the first tunnel; exit faces the second (or the
 *  opposite edge when the portal only has one tunnel), so the child is a pass-through. */
export function entranceExitEdges(doorDirs: Dir[]): { entrance: Dir; exit: Dir } {
	const entrance = doorDirs[0] ?? 'W'
	const exit = doorDirs[1] ?? opposite(entrance)
	return { entrance, exit }
}
