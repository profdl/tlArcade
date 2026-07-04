/**
 * GRID GEOMETRY  (SPEC §4.1)
 * ==========================
 * Pure math for square and hex grids. No editor, no React — unit-testable in
 * isolation. The Grid overlay shape and the snap behaviour both consume this.
 *
 * Hex math uses axial coordinates (Red Blob Games conventions). Flat-top and
 * pointy-top differ only in how axial coords map to/from pixels.
 *
 * Each provider exposes the minimum the snapper needs:
 *   snap(point)        → nearest cell centre (the position a piece locks to)
 *   cellCenter(coord)  → pixel centre of a cell (for rendering / placement)
 *   cellAt(point)      → which cell a pixel falls in
 */
export type GridType = 'square' | 'hexFlat' | 'hexPointy'

export interface Vec2 {
	x: number
	y: number
}

export interface GridGeometry {
	snap(p: Vec2): Vec2
	cellCenter(col: number, row: number): Vec2
}

/** Build the geometry provider for a grid of the given type and cell size. */
export function makeGrid(type: GridType, size: number): GridGeometry {
	switch (type) {
		case 'square':
			return new SquareGrid(size)
		case 'hexFlat':
			return new HexGrid(size, true)
		case 'hexPointy':
			return new HexGrid(size, false)
	}
}

class SquareGrid implements GridGeometry {
	private readonly size: number
	constructor(size: number) {
		this.size = size
	}
	cellCenter(col: number, row: number): Vec2 {
		return { x: (col + 0.5) * this.size, y: (row + 0.5) * this.size }
	}
	snap(p: Vec2): Vec2 {
		return this.cellCenter(Math.floor(p.x / this.size), Math.floor(p.y / this.size))
	}
}

/**
 * Hexagonal grid. `size` is the hex's circumradius (centre→corner). We snap by
 * converting the pixel to fractional axial coords, rounding via cube rounding,
 * and converting back.
 */
class HexGrid implements GridGeometry {
	private readonly size: number
	private readonly flat: boolean
	constructor(size: number, flat: boolean) {
		this.size = size
		this.flat = flat
	}

	cellCenter(q: number, r: number): Vec2 {
		const s = this.size
		if (this.flat) {
			return { x: s * (1.5 * q), y: s * (Math.sqrt(3) * (r + q / 2)) }
		}
		return { x: s * (Math.sqrt(3) * (q + r / 2)), y: s * (1.5 * r) }
	}

	snap(p: Vec2): Vec2 {
		const s = this.size
		let q: number, r: number
		if (this.flat) {
			q = ((2 / 3) * p.x) / s
			r = ((-1 / 3) * p.x + (Math.sqrt(3) / 3) * p.y) / s
		} else {
			q = ((Math.sqrt(3) / 3) * p.x - (1 / 3) * p.y) / s
			r = ((2 / 3) * p.y) / s
		}
		const [rq, rr] = axialRound(q, r)
		return this.cellCenter(rq, rr)
	}
}

/** Cube rounding for fractional axial coords → nearest hex (Red Blob Games). */
function axialRound(q: number, r: number): [number, number] {
	const x = q
	const z = r
	const y = -x - z
	let rx = Math.round(x)
	const ry = Math.round(y)
	let rz = Math.round(z)
	const dx = Math.abs(rx - x)
	const dy = Math.abs(ry - y)
	const dz = Math.abs(rz - z)
	if (dx > dy && dx > dz) rx = -ry - rz
	else if (dy > dz) {
		// ry would be recomputed here too, but only rx/rz feed the return value.
	} else rz = -rx - ry
	return [rx, rz]
}
