import { useEditor, useValue } from 'tldraw'
import { getPuppetCenter, unassignedParts } from '../rig/layout'

/**
 * A subtle **empty-slot overlay**: for every rig role that currently has NO
 * shape assigned, draw a faint dashed outline at exactly the spot the default
 * puppet would have placed that part (from the shared {@link unassignedParts}
 * table + the persisted puppet center). It's a visual hint of what's missing —
 * "draw something here and assign it this role" — without asserting any art.
 *
 * Rendered in tldraw's `InFrontOfTheCanvas` slot, a plain screen-space overlay
 * (NOT camera-transformed), so each slot's page rect is converted to viewport
 * coordinates and the whole thing recomputes on pan/zoom and on shape edits (a
 * role becoming assigned/unassigned). Ellipse parts get a rounded (pill)
 * outline, rectangles a lightly-rounded box — close enough to read as the slot
 * without dragging in real geometry.
 */
export function PuppetPlaceholders() {
	const editor = useEditor()

	const slots = useValue(
		'puppet-placeholder-slots',
		() => {
			const center = getPuppetCenter(editor)
			if (!center) return []
			editor.getCamera() // subscribe: re-place on pan/zoom
			const parts = unassignedParts(editor) // subscribes to shape changes via getCurrentPageShapes
			const z = editor.getZoomLevel()
			return parts.map((part) => {
				const topLeft = editor.pageToViewport({ x: center.x + part.x, y: center.y + part.y })
				return {
					role: part.role,
					left: topLeft.x,
					top: topLeft.y,
					width: part.w * z,
					height: part.h * z,
					rounded: part.geo === 'ellipse',
				}
			})
		},
		[editor]
	)

	if (slots.length === 0) return null

	return (
		<>
			{slots.map((s) => (
				<div
					key={s.role}
					aria-hidden
					style={{
						position: 'absolute',
						left: s.left,
						top: s.top,
						width: s.width,
						height: s.height,
						// Ellipse slots read as a pill; rects get a small radius.
						borderRadius: s.rounded ? '50%' : Math.min(8, s.width / 4, s.height / 4),
						border: '1.5px dashed var(--tl-color-text-3, #9ca3af)',
						opacity: 0.35,
						boxSizing: 'border-box',
						// Purely decorative — never intercept canvas interaction.
						pointerEvents: 'none',
					}}
				/>
			))}
		</>
	)
}
