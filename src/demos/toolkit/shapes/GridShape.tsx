/**
 * GRID OVERLAY SHAPE  (SPEC §5.6)
 * ===============================
 * NOT a game piece — a snapping surface + a visual. It holds no game state, has
 * no referee involvement; it renders cell lines behind the pieces and tells the
 * snap behaviour (client/grid/registerSnapping.ts) how to clamp dropped pieces.
 *
 * The grid math lives in client/grid/geometry.ts (pure, tested). This file is
 * just the tldraw shape: bounds, a render, and the props the snapper reads.
 */
import type {
	Geometry2d,
	RecordProps,
	TLBaseShape,
	TLResizeInfo} from 'tldraw';
import {
	HTMLContainer,
	Rectangle2d,
	ShapeUtil,
	resizeBox,
} from 'tldraw'
import { gridShapeValidators } from 'shared/shape-schemas'
import type { GridType } from '../grid/geometry'

export type GridSnap = 'strict' | 'loose' | 'none'

export type GridShapeProps = {
	w: number
	h: number
	type: GridType
	cellSize: number
	snap: GridSnap
}

export type GridShape = TLBaseShape<'grid', GridShapeProps>

declare module 'tldraw' {
	interface TLGlobalShapePropsMap {
		grid: GridShapeProps
	}
}

const gridShapeProps = gridShapeValidators as RecordProps<GridShape>

export class GridShapeUtil extends ShapeUtil<GridShape> {
	static override type = 'grid' as const
	static override props = gridShapeProps

	getDefaultProps(): GridShape['props'] {
		return { w: 400, h: 400, type: 'square', cellSize: 40, snap: 'strict' }
	}

	getGeometry(shape: GridShape): Geometry2d {
		// Filled so the snapper's getShapeAtPoint(hitInside) treats the whole grid
		// area as a snap surface. The grid renders with pointerEvents:none, so this
		// doesn't steal clicks from pieces on top.
		return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
	}

	override canResize() {
		return true
	}
	override onResize(shape: GridShape, info: TLResizeInfo<GridShape>) {
		return resizeBox(shape, info)
	}

	// A grid sits BEHIND the pieces and must never eat their pointer events.
	component(shape: GridShape) {
		const { w, h, type, cellSize } = shape.props
		return (
			<HTMLContainer style={{ width: w, height: h, pointerEvents: 'none' }}>
				<svg width={w} height={h} style={{ display: 'block' }}>
					{type === 'square'
						? squareLines(w, h, cellSize)
						: hexLines(w, h, cellSize, type === 'hexFlat')}
				</svg>
			</HTMLContainer>
		)
	}

	getIndicatorPath(shape: GridShape) {
		const path = new Path2D()
		path.rect(0, 0, shape.props.w, shape.props.h)
		return path
	}
}

const STROKE = '#ced4da'

function squareLines(w: number, h: number, size: number) {
	const lines = []
	for (let x = 0; x <= w; x += size) {
		lines.push(<line key={`v${x}`} x1={x} y1={0} x2={x} y2={h} stroke={STROKE} strokeWidth={1} />)
	}
	for (let y = 0; y <= h; y += size) {
		lines.push(<line key={`hz${y}`} x1={0} y1={y} x2={w} y2={y} stroke={STROKE} strokeWidth={1} />)
	}
	return lines
}

/** Draw hex outlines by stamping a polygon at each cell centre that's in bounds. */
function hexLines(w: number, h: number, size: number, flat: boolean) {
	const polys = []
	// Over-scan the axial range so partial edge hexes still draw.
	const span = Math.ceil(Math.max(w, h) / size) + 2
	for (let q = -span; q <= span; q++) {
		for (let r = -span; r <= span; r++) {
			const cx = flat ? size * 1.5 * q : size * Math.sqrt(3) * (q + r / 2)
			const cy = flat ? size * Math.sqrt(3) * (r + q / 2) : size * 1.5 * r
			if (cx < -size || cx > w + size || cy < -size || cy > h + size) continue
			polys.push(
				<polygon
					key={`${q},${r}`}
					points={hexCorners(cx, cy, size, flat)}
					fill="none"
					stroke={STROKE}
					strokeWidth={1}
				/>
			)
		}
	}
	return polys
}

function hexCorners(cx: number, cy: number, size: number, flat: boolean): string {
	const pts: string[] = []
	for (let i = 0; i < 6; i++) {
		const angle = (Math.PI / 180) * (flat ? 60 * i : 60 * i - 30)
		pts.push(`${cx + size * Math.cos(angle)},${cy + size * Math.sin(angle)}`)
	}
	return pts.join(' ')
}
