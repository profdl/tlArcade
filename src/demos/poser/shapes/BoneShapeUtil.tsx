import { Rectangle2d, ShapeUtil, type Geometry2d } from 'tldraw'
import { boneShapeMigrations } from '../migrations'
import { BoneBody } from './BoneBody'
import { boneShapeProps, boneThickness, type BoneShape } from './boneShape'

/**
 * Renders a bone as a horizontal capsule from the head (local origin) to the
 * tail (local `length, 0`), plus a small hub circle at each joint so the
 * articulation reads visually. Selection/hit-testing uses a rectangle the length
 * of the bone, so you can grab anywhere along the limb.
 *
 * Colors resolve through tldraw's theme (in BoneBody), so the rig follows the
 * palette and adapts to light/dark mode. Thickness comes from the native `size`
 * style. With `dash === 'draw'` the capsule renders as a hand-drawn outline.
 */
export class BoneShapeUtil extends ShapeUtil<BoneShape> {
	static override type = 'poser-bone' as const
	static override props = boneShapeProps
	static override migrations = boneShapeMigrations

	override getDefaultProps(): BoneShape['props'] {
		return { length: 80, color: 'grey', size: 'm', dash: 'solid', fill: 'solid', name: 'bone' }
	}

	// A bone participates only in the rig's own bindings: bone-joint (bone↔bone) and
	// bone-attachment (bone→artwork). Rejecting anything else documents the contract
	// and keeps a stray binding type (e.g. an arrow) from ever fastening to a bone.
	override canBind({ bindingType }: { bindingType: string }) {
		return bindingType === 'bone-joint' || bindingType === 'bone-attachment'
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
		const thickness = boneThickness(shape)
		// Hit area is the bone's rectangular span from head (0,0) to tail (length,0),
		// centered on the limb's centerline. Rectangle2d supports the x/y offset the
		// capsule needs; the visual rounding is done in the SVG render.
		return new Rectangle2d({
			x: 0,
			y: -thickness / 2,
			width: shape.props.length,
			height: thickness,
			isFilled: true,
		})
	}

	override component(shape: BoneShape) {
		return <BoneBody shape={shape} />
	}

	// v5 selection outline is a Path2D from getIndicatorPath (not a JSX indicator()).
	override getIndicatorPath(shape: BoneShape) {
		const thickness = boneThickness(shape)
		const r = thickness / 2
		const path = new Path2D()
		path.roundRect(0, -r, shape.props.length, thickness, r)
		return path
	}

	// Never actually invoked (canResize=false), but ShapeUtil requires the override.
	override onResize(shape: BoneShape): BoneShape {
		return shape
	}
}
