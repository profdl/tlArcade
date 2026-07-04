/**
 * DIE SHAPE  (SPEC §5.3)
 * ======================
 * A randomizer. The roll is SERVER-AUTHORITATIVE: the client never picks the
 * value (it could otherwise re-roll until happy). The referee owns the RNG and
 * writes the result back into the store via `updateStore`, so every player sees
 * the same outcome. The "Roll" action lives in the context menu (client/ui).
 *
 * `value` is a 0-based index into the faces:
 *   • numeric die  → faces are 1..faceCount, shown as `value + 1`
 *   • custom die   → faces are `customFaces`, shown as `customFaces[value]`
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
import { dieShapeValidators } from '../../shared/shape-schemas'

export type DieShapeProps = {
	w: number
	h: number
	faceCount: number
	customFaces: string[]
	value: number
	rolling: boolean
}

export type DieShape = TLBaseShape<'die', DieShapeProps>

declare module 'tldraw' {
	interface TLGlobalShapePropsMap {
		die: DieShapeProps
	}
}

const dieShapeProps = dieShapeValidators as RecordProps<DieShape>

/** The label shown on the current face. */
export function dieFaceLabel(props: DieShapeProps): string {
	if (props.customFaces.length > 0) return props.customFaces[props.value] ?? '?'
	return String(props.value + 1)
}

export class DieShapeUtil extends ShapeUtil<DieShape> {
	static override type = 'die' as const
	static override props = dieShapeProps

	getDefaultProps(): DieShape['props'] {
		return { w: 56, h: 56, faceCount: 6, customFaces: [], value: 0, rolling: false }
	}

	getGeometry(shape: DieShape): Geometry2d {
		return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
	}

	override canResize() {
		return true
	}
	override onResize(shape: DieShape, info: TLResizeInfo<DieShape>) {
		return resizeBox(shape, info)
	}

	component(shape: DieShape) {
		const { w, h, rolling } = shape.props
		return (
			<HTMLContainer style={{ width: w, height: h, pointerEvents: 'all' }}>
				<div
					style={{
						width: '100%',
						height: '100%',
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						borderRadius: 10,
						background: '#fff',
						border: '2px solid #1e1e1e',
						boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
						fontWeight: 800,
						fontSize: Math.min(w, h) * 0.45,
						color: '#1e1e1e',
						animation: rolling ? 'die-spin 0.4s linear infinite' : undefined,
					}}
				>
					{rolling ? '…' : dieFaceLabel(shape.props)}
				</div>
			</HTMLContainer>
		)
	}

	getIndicatorPath(shape: DieShape) {
		const path = new Path2D()
		path.roundRect(0, 0, shape.props.w, shape.props.h, 10)
		return path
	}
}
