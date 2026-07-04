/**
 * TOKEN / MEEPLE SHAPE  (SPEC §5.1)
 * =================================
 * A game piece: a worker, resource cube, player pawn, or track marker.
 * This is the simplest shape in the toolkit — pure PUBLIC state, no secrets,
 * no server referee. It is the canonical example to copy when adding a new
 * shape. Read it top-to-bottom; every section is labelled.
 *
 * Stacking model (decided in SPEC): COUNT-ON-ONE-SHAPE.
 *   A stack of 5 tokens is ONE token shape with `count: 5` and a badge — not
 *   five overlapping shapes. Splitting spawns a new shape; merging deletes one.
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
import { tokenShapeValidators } from '../../shared/shape-schemas'

// ── 1. THE SHAPE TYPE ────────────────────────────────────────────────────────
// `props` is the public, synced state. Everything here is visible to every
// player in the room (this shape has no secrets — see CardShape for the pattern
// when something must be hidden).

export type TokenStyle = 'cube' | 'disc' | 'meeple' | 'cylinder' | 'ring'
export type TokenColor = 'red' | 'blue' | 'green' | 'yellow' | 'black' | 'white'

export type TokenShapeProps = {
	w: number
	h: number
	style: TokenStyle
	color: TokenColor
	/** Stack size. `count > 1` shows a number badge. */
	count: number
	/** A short label/icon overlaid on the token, e.g. "$" or "HP". */
	label: string
}

export type TokenShape = TLBaseShape<'token', TokenShapeProps>

// ── REGISTER THE TYPE WITH TLDRAW (REQUIRED) ─────────────────────────────────
// In tldraw v5, `TLShape` is a CLOSED union. A custom shape only "counts" as a
// real shape — so that `ShapeUtil<TokenShape>`, `editor.createShape<TokenShape>`,
// etc. type-check — once you augment `TLGlobalShapePropsMap`. This is the #1 v5
// gotcha. Every custom shape file must include a block like this.
declare module 'tldraw' {
	interface TLGlobalShapePropsMap {
		token: TokenShapeProps
	}
}

// ── 2. VALIDATORS ────────────────────────────────────────────────────────────
// tldraw validates every prop on load & sync. The validators live in
// `shared/shape-schemas.ts` so the SYNC SERVER uses the exact same ones (a
// mismatch would make synced shapes fail validation on other clients).
const tokenShapeProps = tokenShapeValidators as RecordProps<TokenShape>

// ── 3. RENDER COLORS ─────────────────────────────────────────────────────────
const COLOR_HEX: Record<TokenColor, string> = {
	red: '#e03131',
	blue: '#1971c2',
	green: '#2f9e44',
	yellow: '#f08c00',
	black: '#1e1e1e',
	white: '#f8f9fa',
}

// ── 4. THE SHAPE UTIL ────────────────────────────────────────────────────────
// We extend `ShapeUtil` and provide a rectangular `getGeometry`. (In v5,
// `BaseBoxShapeUtil` is reserved for shapes registered in tldraw's built-in box
// schema; custom game shapes use ShapeUtil + Rectangle2d directly.)

export class TokenShapeUtil extends ShapeUtil<TokenShape> {
	static override type = 'token' as const
	static override props = tokenShapeProps

	getDefaultProps(): TokenShape['props'] {
		return { w: 48, h: 48, style: 'disc', color: 'blue', count: 1, label: '' }
	}

	getGeometry(shape: TokenShape): Geometry2d {
		return new Rectangle2d({
			width: shape.props.w,
			height: shape.props.h,
			isFilled: true,
		})
	}

	// Visual chrome
	override canResize() {
		return true
	}
	override onResize(shape: TokenShape, info: TLResizeInfo<TokenShape>) {
		return resizeBox(shape, info)
	}

	// The on-canvas render. Plain React/SVG inside an HTMLContainer.
	component(shape: TokenShape) {
		const { w, h, style, color, count, label } = shape.props
		const fill = COLOR_HEX[color]
		const stroke = color === 'white' ? '#ced4da' : 'rgba(0,0,0,0.25)'

		return (
			<HTMLContainer
				style={{
					width: w,
					height: h,
					position: 'relative',
					pointerEvents: 'all',
				}}
			>
				<svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: 'visible' }}>
					{renderTokenBody(style, w, h, fill, stroke)}
				</svg>

				{label && (
					<div style={overlayLabelStyle(color)}>{label}</div>
				)}

				{count > 1 && <div style={badgeStyle}>{count}</div>}
			</HTMLContainer>
		)
	}

	// The selection outline. In v5 this returns a Path2D (not JSX).
	getIndicatorPath(shape: TokenShape) {
		const path = new Path2D()
		path.roundRect(0, 0, shape.props.w, shape.props.h, 6)
		return path
	}
}

// ── 5. STACK / SPLIT HELPERS ─────────────────────────────────────────────────
// These are exported so menu actions / the inspector can call them. They are
// plain editor operations — no referee, because counts are public state.
// (Wired into a context menu in a later step; exported now so they're testable.)

/** Split `amount` tokens off the top of a stack into a new adjacent shape. */
export function splitToken(
	editor: import('tldraw').Editor,
	shape: TokenShape,
	amount = 1
) {
	if (amount < 1 || amount >= shape.props.count) return
	editor.run(() => {
		editor.updateShape<TokenShape>({
			id: shape.id,
			type: 'token',
			props: { count: shape.props.count - amount },
		})
		editor.createShape<TokenShape>({
			type: 'token',
			x: shape.x + shape.props.w + 8,
			y: shape.y,
			props: { ...shape.props, count: amount },
		})
	})
}

/** Merge `source` into `target` when they share style+color. Deletes source. */
export function mergeTokens(
	editor: import('tldraw').Editor,
	source: TokenShape,
	target: TokenShape
) {
	if (source.props.style !== target.props.style) return
	if (source.props.color !== target.props.color) return
	editor.run(() => {
		editor.updateShape<TokenShape>({
			id: target.id,
			type: 'token',
			props: { count: target.props.count + source.props.count },
		})
		editor.deleteShape(source.id)
	})
}

// ── 6. RENDER INTERNALS ──────────────────────────────────────────────────────

function renderTokenBody(
	style: TokenStyle,
	w: number,
	h: number,
	fill: string,
	stroke: string
) {
	const cx = w / 2
	const cy = h / 2
	switch (style) {
		case 'cube':
			return <rect x={2} y={2} width={w - 4} height={h - 4} rx={6} fill={fill} stroke={stroke} strokeWidth={2} />
		case 'disc':
			return <circle cx={cx} cy={cy} r={Math.min(w, h) / 2 - 2} fill={fill} stroke={stroke} strokeWidth={2} />
		case 'ring':
			return (
				<circle
					cx={cx}
					cy={cy}
					r={Math.min(w, h) / 2 - 4}
					fill="none"
					stroke={fill}
					strokeWidth={Math.max(4, Math.min(w, h) / 6)}
				/>
			)
		case 'cylinder': {
			const ry = h / 6
			return (
				<g fill={fill} stroke={stroke} strokeWidth={2}>
					<rect x={4} y={ry} width={w - 8} height={h - ry * 2} />
					<ellipse cx={cx} cy={ry} rx={(w - 8) / 2} ry={ry} />
					<ellipse cx={cx} cy={h - ry} rx={(w - 8) / 2} ry={ry} />
				</g>
			)
		}
		case 'meeple':
			// A simple stylized meeple silhouette scaled into the box.
			return (
				<path
					transform={`translate(${w * 0.1}, ${h * 0.08}) scale(${(w * 0.8) / 100}, ${(h * 0.84) / 100})`}
					d="M50 0c-9 0-16 7-16 16 0 6 3 11 8 14L18 48c-6 3-10 9-10 16v6h28c-2 4-3 9-3 14v16h34V84c0-5-1-10-3-14h28v-6c0-7-4-13-10-16L58 30c5-3 8-8 8-14C66 7 59 0 50 0z"
					fill={fill}
					stroke={stroke}
					strokeWidth={2}
				/>
			)
	}
}

function overlayLabelStyle(color: TokenColor): React.CSSProperties {
	return {
		position: 'absolute',
		inset: 0,
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		fontWeight: 700,
		fontSize: 14,
		color: color === 'white' || color === 'yellow' ? '#1e1e1e' : '#fff',
		pointerEvents: 'none',
		userSelect: 'none',
	}
}

const badgeStyle: React.CSSProperties = {
	position: 'absolute',
	top: -6,
	right: -6,
	minWidth: 18,
	height: 18,
	padding: '0 4px',
	borderRadius: 9,
	background: '#1e1e1e',
	color: '#fff',
	fontSize: 11,
	fontWeight: 700,
	display: 'flex',
	alignItems: 'center',
	justifyContent: 'center',
	pointerEvents: 'none',
}
