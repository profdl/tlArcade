import { useEffect, useRef } from 'react'
import { useEditor, toDomPrecision } from 'tldraw'
import { PLAYER_SHAPE_ID } from './player.ts'
import { SnailArt, SNAIL_CENTER_OFFSET, SNAIL_LEN } from './SnailArt.tsx'

/**
 * PLAYER SNAIL — the player's graphic (the line-rider snail instead of a red dot).
 * ================================================================================
 * The real player is a locked, INVISIBLE geo ellipse (player.ts) that owns
 * position + collision; this overlay just paints the snail on top of it.
 *
 * Mounted via components.InFrontOfTheCanvas (App.tsx). A rAF loop maps the
 * player's page-space center to viewport coords via editor.pageToViewport every
 * frame, so the snail stays glued to the shape under WASD movement AND the
 * animated dive zoom — no per-frame React render (we write the SVG transform
 * imperatively, the same pattern as line-rider's Rider). pageToViewport (not
 * pageToScreen) because the overlay lives in the editor CONTAINER, so we want
 * container-relative coords.
 */
export function PlayerSnail() {
	const editor = useEditor()
	const snailRef = useRef<SVGGElement | null>(null)

	useEffect(() => {
		let raf = 0
		// Facing is held between frames so a stationary snail keeps its last heading
		// (+1 = art's native right, -1 = mirrored to face left). Movement is read by
		// diffing the player's page center frame-to-frame — self-contained, no need to
		// reach into the key state.
		let facingX = 1
		let prev: { x: number; y: number } | null = null
		const tick = () => {
			const snail = snailRef.current
			const shape = editor.getShape(PLAYER_SHAPE_ID)
			const bounds = shape ? editor.getShapePageBounds(shape.id) : null
			if (snail && bounds) {
				const center = editor.pageToViewport(bounds.center)
				const zoom = editor.getZoomLevel()
				// Scale the art (natural width SNAIL_LEN) to fill the PLAYER BOX, then by
				// camera zoom. Keying off the box — not a fixed pixel size — is what keeps
				// the snail-to-room proportion CONSTANT at every zoom/submap depth: the box
				// is always roomSize * PLAYER_FRACTION (see playerSizeFor in gameLoop; it's
				// re-applied on every dive by setPlayerRect), so on screen the snail is
				// SNAIL_LEN*scale = bounds.width*zoom = roomSize*PLAYER_FRACTION*zoom, versus
				// a room of roomSize*zoom — a fixed PLAYER_FRACTION ratio, roomSize and zoom
				// both cancelling. Don't swap this for an absolute size or the invariant breaks.
				// SnailArt is belly-centered, so push it DOWN by SNAIL_CENTER_OFFSET to land
				// the snail's visual center on the box center.
				const scale = (bounds.width / SNAIL_LEN) * zoom

				// Movement this frame, in page space. A dive relocates the player far in
				// one frame; ignore jumps larger than the player's own size (teleports)
				// so a transition doesn't yank the facing/tilt.
				const p = bounds.center
				const dx = prev ? p.x - prev.x : 0
				const dy = prev ? p.y - prev.y : 0
				const teleport = Math.hypot(dx, dy) > bounds.width
				const eps = bounds.width * 0.001

				let rotateDeg = 0
				if (!teleport) {
					// Facing: horizontal wins; on pure vertical, up faces right / down faces left.
					if (dx > eps) facingX = 1
					else if (dx < -eps) facingX = -1
					else if (dy < -eps) facingX = 1
					else if (dy > eps) facingX = -1
					// Tilt: both up and down rotate 15° counter-clockwise (screen space,
					// -deg = ccw since y points down). Applied OUTSIDE the facing mirror below.
					if (dy < -eps || dy > eps) rotateDeg = -15
				}
				prev = p

				snail.setAttribute('opacity', '1')
				snail.setAttribute(
					'transform',
					`translate(${toDomPrecision(center.x)},${toDomPrecision(center.y)}) rotate(${toDomPrecision(rotateDeg)}) scale(${toDomPrecision(facingX * scale)},${toDomPrecision(scale)}) translate(0,${toDomPrecision(SNAIL_CENTER_OFFSET)})`
				)
			} else if (snail) {
				snail.setAttribute('opacity', '0')
			}
			raf = requestAnimationFrame(tick)
		}
		raf = requestAnimationFrame(tick)
		return () => cancelAnimationFrame(raf)
	}, [editor])

	// Full-container SVG overlay; the rAF loop writes the snail group's transform
	// in viewport coords each frame. Inline styles (no stylesheet) keep this demo
	// self-contained and sidestep the cross-demo CSS-collision risk noted in the
	// repo CLAUDE.md.
	return (
		<svg
			aria-hidden="true"
			style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}
		>
			<g ref={snailRef} opacity="0">
				<SnailArt />
			</g>
		</svg>
	)
}
