/**
 * PLAYER — the one shape the human drives (thin editor wrapper).
 * ==============================================================
 * A single locked `geo` ellipse with a FIXED id, so re-mounts (StrictMode / route
 * switches) address the same shape instead of stacking duplicates, and tldraw's own
 * select/drag/nudge can't grab it. All writes go through editor.run with
 * `history: 'ignore'` (no undo spam) and `ignoreShapeLock: true` (locked shape).
 *
 * The shape is INVISIBLE (opacity 0): it owns position + collision only. The
 * player's graphic — the line-rider snail — is painted over it by the PlayerSnail
 * overlay (see PlayerSnail.tsx), which reads this shape's page bounds each frame.
 */
import { createShapeId, type Editor, type TLShapeId } from 'tldraw'
import type { AABB } from './collision.ts'

/** Fixed so every mount reuses one player shape rather than minting a new one. */
export const PLAYER_SHAPE_ID: TLShapeId = createShapeId('scale-portals-player')

const PLAYER_PROPS = { geo: 'ellipse', color: 'red', fill: 'fill' } as const

/** Create the player (or reset an existing one) centred on `(cx, cy)` at `size` square. */
export function createPlayer(editor: Editor, cx: number, cy: number, size: number): void {
	const exists = editor.getShape(PLAYER_SHAPE_ID) != null
	editor.run(
		() => {
			if (exists) editor.deleteShape(PLAYER_SHAPE_ID)
			editor.createShape({
				id: PLAYER_SHAPE_ID,
				type: 'geo',
				x: cx - size / 2,
				y: cy - size / 2,
				isLocked: true,
				// Invisible: the snail overlay draws the visible player (see PlayerSnail.tsx).
				opacity: 0,
				props: { ...PLAYER_PROPS, w: size, h: size },
			})
			editor.bringToFront([PLAYER_SHAPE_ID])
		},
		{ history: 'ignore', ignoreShapeLock: true }
	)
}

/** Move the player's TOP-LEFT to `(x, y)` (used every tick during movement). */
export function setPlayerPosition(editor: Editor, x: number, y: number): void {
	editor.run(
		() => editor.updateShape({ id: PLAYER_SHAPE_ID, type: 'geo', x, y }),
		{ history: 'ignore', ignoreShapeLock: true }
	)
}

/** Reposition + resize the player in one write, centred on `(cx, cy)` (used on transitions). */
export function setPlayerRect(editor: Editor, cx: number, cy: number, size: number): void {
	editor.run(
		() =>
			editor.updateShape({
				id: PLAYER_SHAPE_ID,
				type: 'geo',
				x: cx - size / 2,
				y: cy - size / 2,
				props: { w: size, h: size },
			}),
		{ history: 'ignore', ignoreShapeLock: true }
	)
}

/** The player's current page-space AABB (top-left + w/h from the shape record). */
export function getPlayerAABB(editor: Editor): AABB {
	const shape = editor.getShape(PLAYER_SHAPE_ID)
	if (!shape) throw new Error('getPlayerAABB: player shape not created yet')
	const props = shape.props as { w: number; h: number }
	return { x: shape.x, y: shape.y, w: props.w, h: props.h }
}
