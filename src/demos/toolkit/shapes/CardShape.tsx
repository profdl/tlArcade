/**
 * CARD SHAPE  (SPEC §5.2) — the secret-bearing shape
 * ==================================================
 * A card has three render states, and WHERE its value lives differs in each.
 * This is the toolkit's worked example of the redaction boundary (SPEC §2):
 *
 *   1. faceUp (public)      → value is in `revealedValue` (everyone sees it).
 *   2. faceDown on table    → value held SERVER-SIDE under `secretRef`; props
 *                             carry only the handle. No client has the value.
 *   3. faceDown, owner-only  → as (2), but the referee ALSO pushes the value
 *                             privately to the owner (see client/referee/
 *                             privateReveals.ts). The owner renders it locally;
 *                             it is NEVER written to the synced store.
 *
 * The golden rule: a hidden value never appears in props. Flipping/revealing is
 * a REFEREE action, because revealing a secret requires the holder of the secret.
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
	useValue,
} from 'tldraw'
import { cardShapeValidators } from 'shared/shape-schemas'
import { getPrivateReveal } from '../referee/privateReveals'

export type CardAspect = 'poker' | 'square' | 'tarot'

export type CardShapeProps = {
	w: number
	h: number
	aspect: CardAspect
	state: 'faceUp' | 'faceDown'
	backColor: string
	revealedValue: string | null
	secretRef: string | null
	owner: string | null
}

export type CardShape = TLBaseShape<'card', CardShapeProps>

declare module 'tldraw' {
	interface TLGlobalShapePropsMap {
		card: CardShapeProps
	}
}

const cardShapeProps = cardShapeValidators as RecordProps<CardShape>

/** Width:height ratios per aspect (used for default sizing). */
export const CARD_RATIOS: Record<CardAspect, number> = {
	poker: 2.5 / 3.5,
	square: 1,
	tarot: 2.75 / 4.75,
}

export class CardShapeUtil extends ShapeUtil<CardShape> {
	static override type = 'card' as const
	static override props = cardShapeProps

	getDefaultProps(): CardShape['props'] {
		return {
			w: 120,
			h: 168, // poker ratio
			aspect: 'poker',
			state: 'faceDown',
			backColor: '#324a5f',
			revealedValue: null,
			secretRef: null,
			owner: null,
		}
	}

	getGeometry(shape: CardShape): Geometry2d {
		return new Rectangle2d({ width: shape.props.w, height: shape.props.h, isFilled: true })
	}

	override canResize() {
		return true
	}
	override onResize(shape: CardShape, info: TLResizeInfo<CardShape>) {
		return resizeBox(shape, info)
	}

	component(shape: CardShape) {
		return <CardBody shape={shape} />
	}

	getIndicatorPath(shape: CardShape) {
		const path = new Path2D()
		path.roundRect(0, 0, shape.props.w, shape.props.h, 8)
		return path
	}
}

function CardBody({ shape }: { shape: CardShape }) {
	const { w, h, state, backColor, revealedValue } = shape.props

	// If this client is the owner, the referee may have pushed the value privately.
	// useValue keeps the component reactive; the value is read from module state,
	// never from the synced store.
	const privateValue = useValue('cardPrivateReveal', () => getPrivateReveal(shape.id) as string | null, [
		shape.id,
	])

	// What text (if any) can THIS client legitimately see on the face?
	const visibleFace = state === 'faceUp' ? revealedValue : privateValue

	const faceUpAppearance = state === 'faceUp' || privateValue != null

	return (
		<HTMLContainer style={{ width: w, height: h, pointerEvents: 'all' }}>
			<div
				style={{
					width: '100%',
					height: '100%',
					borderRadius: 8,
					border: '1px solid rgba(0,0,0,0.3)',
					boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					background: faceUpAppearance ? '#fff' : backColor,
					backgroundImage: faceUpAppearance
						? undefined
						: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.08) 0 6px, transparent 6px 12px)',
					color: '#1e1e1e',
					fontWeight: 700,
					fontSize: Math.min(w, h) * 0.22,
					userSelect: 'none',
				}}
			>
				{faceUpAppearance ? visibleFace ?? '' : ''}
				{privateValue != null && state === 'faceDown' && (
					<div style={privateBadge}>only you</div>
				)}
			</div>
		</HTMLContainer>
	)
}

const privateBadge: React.CSSProperties = {
	position: 'absolute',
	bottom: 6,
	left: 0,
	right: 0,
	textAlign: 'center',
	fontSize: 10,
	fontWeight: 600,
	color: '#868e96',
}
