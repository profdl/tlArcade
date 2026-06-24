/**
 * CONTAINER / BAG SHAPE  (SPEC §5.5) — Phase 4: public mode
 * =========================================================
 * A region that holds other game pieces: a hand, a deck, a resource bag. This
 * phase implements PUBLIC containment only — items dropped inside are bound to
 * the container (containment binding) and arranged by a layout engine. Everyone
 * sees the contents.
 *
 * Phase 5 adds the hard parts: `hidden`/`ownerOnly` visibility and the
 * referee-backed shuffle / draw / drawRandom actions. The props for those
 * (`visibility`, `owner`) already exist so the data model is stable.
 *
 * Containment itself is built in client/containment/ (a binding + a drag
 * side-effect), NOT native tldraw parenting — see SPEC §4.2.
 */
import {
	Geometry2d,
	HTMLContainer,
	Rectangle2d,
	RecordProps,
	ShapeUtil,
	TLBaseShape,
	TLResizeInfo,
	resizeBox,
} from 'tldraw'
import { containerShapeValidators } from '../../shared/shape-schemas'
import { LayoutKind } from '../containment/layout'

export type ContainerVisibility = 'public' | 'hidden' | 'ownerOnly'

export type ContainerShapeProps = {
	w: number
	h: number
	label: string
	visibility: ContainerVisibility
	owner: string | null
	layout: LayoutKind
	count: number
}

export type ContainerShape = TLBaseShape<'container', ContainerShapeProps>

declare module 'tldraw' {
	interface TLGlobalShapePropsMap {
		container: ContainerShapeProps
	}
}

const containerShapeProps = containerShapeValidators as RecordProps<ContainerShape>

export class ContainerShapeUtil extends ShapeUtil<ContainerShape> {
	static override type = 'container' as const
	static override props = containerShapeProps

	getDefaultProps(): ContainerShape['props'] {
		return { w: 260, h: 160, label: '', visibility: 'public', owner: null, layout: 'autoGrid', count: 0 }
	}

	getGeometry(shape: ContainerShape): Geometry2d {
		return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
	}

	override canResize() {
		return true
	}
	override onResize(shape: ContainerShape, info: TLResizeInfo<ContainerShape>) {
		return resizeBox(shape, info)
	}

	// Items render as their own shapes on top; the container is just the region +
	// a label. We keep pointer events off the body so pieces inside stay grabbable.
	component(shape: ContainerShape) {
		const { w, h, label, visibility, count } = shape.props
		// hidden / ownerOnly decks render as a solid (blacked-out) region; public
		// containers are a dashed drop-zone the pieces inside show through.
		const isSecret = visibility !== 'public'
		return (
			<HTMLContainer style={{ width: w, height: h, pointerEvents: 'none' }}>
				<div
					style={{
						width: '100%',
						height: '100%',
						borderRadius: 10,
						border: isSecret ? '2px solid #343a40' : '2px dashed #adb5bd',
						background: isSecret ? '#343a40' : 'rgba(173,181,189,0.08)',
						boxSizing: 'border-box',
					}}
				/>
				{label && <div style={{ ...labelStyle, color: isSecret ? '#ced4da' : '#868e96' }}>{label}</div>}
				{count > 0 && <div style={countStyle}>{count}</div>}
			</HTMLContainer>
		)
	}

	getIndicatorPath(shape: ContainerShape) {
		const path = new Path2D()
		path.roundRect(0, 0, shape.props.w, shape.props.h, 10)
		return path
	}
}

const labelStyle: React.CSSProperties = {
	position: 'absolute',
	top: 6,
	left: 10,
	fontSize: 12,
	fontWeight: 700,
	color: '#868e96',
	pointerEvents: 'none',
	userSelect: 'none',
}

const countStyle: React.CSSProperties = {
	position: 'absolute',
	inset: 0,
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'center',
	fontSize: 28,
	fontWeight: 800,
	color: '#ced4da',
	pointerEvents: 'none',
	userSelect: 'none',
}
