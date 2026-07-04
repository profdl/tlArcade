/**
 * MAP GEOMETRY — the PURE rectangle layout for one level of Scale Portals.
 * =========================================================================
 * Turns a WFC room grid (../wfc/collapse.ts) into the list of rectangles to emit:
 * room rects, doorway rects, and exactly one special marker rect (a `portal` in a
 * parent-style map, an `exit` in a child-style map). NO tldraw import — takes an
 * id-factory instead of calling createShapeId — so this geometry is unit-testable
 * without an editor (see __tests__/mapGeometry.test.ts).
 *
 * Both `roomSize` and `gap` are parameters (not fixed constants) so the SAME
 * function builds a parent map and a smaller child map that nests exactly inside
 * one of the parent's rooms — the caller (levelManager/gameLoop) is responsible
 * for scaling both by the same factor, since scaling only `roomSize` would leave
 * the child map's doorway gaps too wide to fit the parent room's footprint.
 */
import { collapse } from '../wfc/collapse.ts'
import { pruneAndConnect, type Present } from '../wfc/connectivity.ts'
import { DELTA, type Dir } from '../wfc/tiles.ts'

/** How far (fraction of the room) a doorway pokes into each room it connects. */
export const DOOR_OVERLAP = 0.1
/** The doorway's mouth width, as a fraction of the room side. */
export const DOOR_MOUTH = 0.34

export const ROOM_PROPS = { geo: 'rectangle', color: 'blue', fill: 'fill' } as const
export const CHILD_ROOM_PROPS = { geo: 'rectangle', color: 'light-green', fill: 'fill' } as const
/** Outline only (no fill) so a nested child map's tiny rects stay visible inside it. */
export const PORTAL_PROPS = { geo: 'rectangle', color: 'violet', fill: 'none' } as const
export const EXIT_PROPS = { geo: 'rectangle', color: 'orange', fill: 'fill' } as const

export type RoomRectKind = 'room' | 'door' | 'portal' | 'exit'

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

export type MapLayout<Id> = {
	rects: RoomRect<Id>[]
	extent: { w: number; h: number }
	spawnCell: GridCell
	spawnRect: PageRect
	/** The special marker cell/rect — a portal (parent maps) or an exit (child maps). */
	special: 'portal' | 'exit'
	specialCell: GridCell
	specialRect: PageRect
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

export type BuildMapLayoutOptions = {
	/** Fraction of rooms to randomly remove (kept 4-connected) — see pruneAndConnect. */
	removeProb?: number
	/** 'portal': mark the cell farthest from spawn. 'exit': mark the spawn cell itself. */
	special: 'portal' | 'exit'
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

	const spawnCell = firstPresentCell(present, width, height)
	const specialCell =
		opts.special === 'exit' ? spawnCell : farthestPresentCell(present, width, height, spawnCell)

	const cellRect = (cell: GridCell): PageRect => ({ x: roomX(cell.x), y: roomY(cell.y), w: roomSize, h: roomSize })

	// 1) ROOMS — one rect per present cell; the special cell gets portal/exit props instead.
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (!present[y][x]) continue
			const isSpecial = x === specialCell.x && y === specialCell.y
			const kind: RoomRectKind = isSpecial ? opts.special : 'room'
			const props = isSpecial ? (opts.special === 'portal' ? PORTAL_PROPS : EXIT_PROPS) : roomProps
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
		special: opts.special,
		specialCell,
		specialRect: cellRect(specialCell),
	}
}
