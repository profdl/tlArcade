import { Rectangle2d, ShapeUtil, SVGContainer, type Geometry2d } from 'tldraw'
import { boneShapeProps, type BoneShape } from './boneShape'

/**
 * Renders a bone as a horizontal capsule from the head (local origin) to the
 * tail (local `length, 0`), plus a small hub circle at each joint so the
 * articulation reads visually. Selection/hit-testing uses a stadium the length
 * of the bone, so you can grab anywhere along the limb.
 */
export class BoneShapeUtil extends ShapeUtil<BoneShape> {
	static override type = 'poser-bone' as const
	static override props = boneShapeProps

	override getDefaultProps(): BoneShape['props'] {
		return { length: 80, thickness: 18, color: '#5b6472', name: 'bone' }
	}

	// Bones are posed, not freely edited: no resize handles, no rotation handle
	// (you pose by dragging the tail — see the rig binding), no aspect lock UI.
	override canResize() {
		return false
	}
	override hideResizeHandles() {
		return true
	}
	override hideRotateHandle() {
		return true
	}

	override getGeometry(shape: BoneShape): Geometry2d {
		const { length, thickness } = shape.props
		// Hit area is the bone's rectangular span from head (0,0) to tail (length,0),
		// centered on the limb's centerline. Rectangle2d supports the x/y offset the
		// capsule needs; the visual rounding is done in the SVG render.
		return new Rectangle2d({
			x: 0,
			y: -thickness / 2,
			width: length,
			height: thickness,
			isFilled: true,
		})
	}

	override component(shape: BoneShape) {
		const { length, thickness, color } = shape.props
		const r = thickness / 2
		const hub = Math.max(3, thickness * 0.28)
		return (
			<SVGContainer>
				{/* capsule body */}
				<line x1={0} y1={0} x2={length} y2={0} stroke={color} strokeWidth={thickness} strokeLinecap="round" />
				{/* joint hubs — brighter dots so the articulation points are legible */}
				<circle cx={0} cy={0} r={hub} fill="#fff" stroke={color} strokeWidth={2} />
				<circle cx={length} cy={0} r={hub * 0.8} fill="#fff" stroke={color} strokeWidth={2} />
				{/* faint centerline for a bit of dimensionality */}
				<line x1={0} y1={0} x2={length} y2={0} stroke="rgba(255,255,255,0.25)" strokeWidth={Math.max(1, r * 0.15)} />
			</SVGContainer>
		)
	}

	// v5 selection outline is a Path2D from getIndicatorPath (not a JSX indicator()).
	override getIndicatorPath(shape: BoneShape) {
		const { length, thickness } = shape.props
		const r = thickness / 2
		const path = new Path2D()
		path.roundRect(0, -r, length, thickness, r)
		return path
	}

	// Never actually invoked (canResize=false), but ShapeUtil requires the override.
	override onResize(shape: BoneShape): BoneShape {
		return shape
	}
}
