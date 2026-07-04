/**
 * TRACKER / SPINNER SHAPE  (SPEC §5.4)
 * ====================================
 * A value display: health bar, victory-point track, or dial. PUBLIC state only,
 * no referee — except a "spinner" used as a randomizer, which would route a roll
 * through the referee like the Die (left as a follow-up; see SPEC §5.4).
 *
 * The interesting bit here is CLAMP MATH: `value` is always kept inside
 * [min, max] and rounded to the nearest `step`. See `clampToStep`.
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
import { trackerShapeValidators } from '../../shared/shape-schemas'

export type TrackerKind = 'linearTrack' | 'circularDial' | 'spinnerArrow'

export type TrackerShapeProps = {
	w: number
	h: number
	kind: TrackerKind
	min: number
	max: number
	step: number
	value: number
}

export type TrackerShape = TLBaseShape<'tracker', TrackerShapeProps>

// Register the type with tldraw (see TokenShape.tsx for why this is required).
declare module 'tldraw' {
	interface TLGlobalShapePropsMap {
		tracker: TrackerShapeProps
	}
}

const trackerShapeProps = trackerShapeValidators as RecordProps<TrackerShape>

/** Round `value` to the nearest `step` and clamp into [min, max]. */
export function clampToStep(value: number, min: number, max: number, step: number): number {
	const clamped = Math.max(min, Math.min(max, value))
	if (step <= 0) return clamped
	const snapped = min + Math.round((clamped - min) / step) * step
	return Math.max(min, Math.min(max, snapped))
}

export class TrackerShapeUtil extends ShapeUtil<TrackerShape> {
	static override type = 'tracker' as const
	static override props = trackerShapeProps

	getDefaultProps(): TrackerShape['props'] {
		return { w: 160, h: 36, kind: 'linearTrack', min: 0, max: 10, step: 1, value: 5 }
	}

	getGeometry(shape: TrackerShape): Geometry2d {
		return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
	}

	override canResize() {
		return true
	}
	override onResize(shape: TrackerShape, info: TLResizeInfo<TrackerShape>) {
		return resizeBox(shape, info)
	}

	component(shape: TrackerShape) {
		const { w, h, kind, min, max, value } = shape.props
		const pct = max > min ? (value - min) / (max - min) : 0

		return (
			<HTMLContainer style={{ width: w, height: h, pointerEvents: 'all' }}>
				{kind === 'linearTrack' && (
					<div style={{ width: w, height: h, position: 'relative' }}>
						<div style={trackBg} />
						<div style={{ ...trackFill, width: `${pct * 100}%` }} />
						<div style={trackLabel}>
							{value} / {max}
						</div>
					</div>
				)}
				{(kind === 'circularDial' || kind === 'spinnerArrow') && (
					<Dial w={w} h={h} pct={pct} arrow={kind === 'spinnerArrow'} value={value} />
				)}
			</HTMLContainer>
		)
	}

	getIndicatorPath(shape: TrackerShape) {
		const path = new Path2D()
		path.roundRect(0, 0, shape.props.w, shape.props.h, 6)
		return path
	}
}

function Dial({ w, h, pct, arrow, value }: { w: number; h: number; pct: number; arrow: boolean; value: number }) {
	const size = Math.min(w, h)
	const cx = w / 2
	const cy = h / 2
	const r = size / 2 - 4
	// Sweep from -135° to +135° (270° usable arc).
	const angle = (-135 + pct * 270) * (Math.PI / 180)
	const px = cx + Math.cos(angle) * r
	const py = cy + Math.sin(angle) * r
	return (
		<svg width={w} height={h} style={{ overflow: 'visible' }}>
			<circle cx={cx} cy={cy} r={r} fill="#f1f3f5" stroke="#ced4da" strokeWidth={2} />
			{arrow ? (
				<line x1={cx} y1={cy} x2={px} y2={py} stroke="#1971c2" strokeWidth={3} strokeLinecap="round" />
			) : (
				<circle cx={px} cy={py} r={4} fill="#1971c2" />
			)}
			<text x={cx} y={cy + size * 0.32} textAnchor="middle" fontSize={12} fontWeight={700} fill="#1e1e1e">
				{value}
			</text>
		</svg>
	)
}

const trackBg: React.CSSProperties = {
	position: 'absolute',
	inset: 0,
	borderRadius: 6,
	background: '#e9ecef',
	border: '1px solid #ced4da',
}
const trackFill: React.CSSProperties = {
	position: 'absolute',
	left: 0,
	top: 0,
	bottom: 0,
	borderRadius: 6,
	background: '#2f9e44',
}
const trackLabel: React.CSSProperties = {
	position: 'absolute',
	inset: 0,
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'center',
	fontSize: 13,
	fontWeight: 700,
	color: '#1e1e1e',
	pointerEvents: 'none',
}
