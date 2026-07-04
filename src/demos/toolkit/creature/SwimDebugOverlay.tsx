/**
 * SWIM DEBUG OVERLAY  (dev-only visualization of the food-attraction loop)
 * ========================================================================
 * Draws, on top of the canvas, what the swim loop (registerSwimming.ts) is "thinking"
 * for each creature, so you can SEE the behaviour working:
 *   • TANK CLUSTER — the connected geo-shape region the creature is confined to,
 *     outlined. Confirms cluster detection + which rooms count as one tank.
 *   • HEADING RAY — a short arrow from the creature's centre along its current travel
 *     direction. Confirms steering is alive and shows where it's aiming.
 *   • FOOD LINK — when a creature is attracted to a green shape, two cues:
 *       – a SOLID green line to the WAYPOINT it's actually steering toward (the next
 *         doorway on its path through the rooms, or the food itself when in the same
 *         room). This is the "pathfinding is working" readout — watch it aim at the
 *         opening, not straight through a wall.
 *       – a faint DASHED line + ring on the food's true centre (the ultimate goal).
 *
 * HOW IT GETS THE DATA (native-first, no extra rAF): the swim loop publishes a
 * per-tick snapshot into the `swimDebug` atom (only while the overlay is enabled, so
 * it's free otherwise). This component reads that atom with `useValue` and re-renders
 * reactively — the same atom→useValue path the creature body and the referee reveals
 * use. It also reads the camera so the SVG follows pan/zoom.
 *
 * COORDINATES: snapshots are in PAGE space; we map each point to VIEWPORT space with
 * `editor.pageToViewport`. InFrontOfTheCanvas renders inside the canvas container, so
 * viewport coords line up exactly with the shapes beneath.
 *
 * It's wired in via the `InFrontOfTheCanvas` component slot (see createGameComponents)
 * and gated on `swimDebugEnabled` — toggled from the DEV-only menu item. Returns null
 * (paints nothing) when disabled.
 */
import type { Vec } from 'tldraw';
import { useEditor, useValue } from 'tldraw'
import { swimDebug, swimDebugEnabled } from './registerSwimming'

/** Length of the heading arrow in PAGE px (scaled by zoom when drawn). */
const RAY_LEN = 40

export function SwimDebugOverlay() {
	const editor = useEditor()

	// Enabled? Read the atom reactively so flipping the menu toggle shows/hides at once.
	const enabled = useValue('swimDebugEnabled', () => swimDebugEnabled.get(), [])

	// The live per-creature snapshots (page space). Re-renders each tick the loop runs.
	const creatures = useValue('swimDebug', () => swimDebug.get(), [])

	// Track the camera so the overlay follows pan/zoom. We read the whole camera object
	// (x, y, z) so any change re-runs pageToViewport below.
	const camera = useValue('camera', () => editor.getCamera(), [editor])

	if (!enabled || creatures.length === 0) return null

	const zoom = camera.z // page px → viewport px scale (for line widths + ray length)
	const toView = (x: number, y: number): Vec => editor.pageToViewport({ x, y })

	return (
		<svg
			// Cover the viewport; let pointer events fall through to the canvas beneath.
			style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}
		>
			{creatures.map((c) => {
				const center = toView(c.center.x, c.center.y)
				// Heading ray: a fixed page length, so it scales naturally with zoom.
				const tip = toView(
					c.center.x + Math.cos(c.heading) * RAY_LEN,
					c.center.y + Math.sin(c.heading) * RAY_LEN
				)
				const food = c.food ? toView(c.food.x, c.food.y) : null
				const waypoint = c.waypoint ? toView(c.waypoint.x, c.waypoint.y) : null

				return (
					<g key={c.id}>
						{/* TANK CLUSTER outline — one rect per member box. */}
						{c.boxes.map((b, i) => {
							const tl = toView(b.x, b.y)
							return (
								<rect
									key={i}
									x={tl.x}
									y={tl.y}
									width={b.w * zoom}
									height={b.h * zoom}
									fill="none"
									stroke="#3b82f6"
									strokeWidth={1.5}
									strokeDasharray="6 4"
									opacity={0.6}
								/>
							)
						})}

						{/* FOOD GOAL — faint dashed line + ring on the food's true centre. */}
						{food && (
							<>
								<line
									x1={center.x}
									y1={center.y}
									x2={food.x}
									y2={food.y}
									stroke="#22c55e"
									strokeWidth={1.5}
									strokeDasharray="3 5"
									opacity={0.4}
								/>
								<circle cx={food.x} cy={food.y} r={10} fill="none" stroke="#22c55e" strokeWidth={2.5} />
							</>
						)}
						{/* WAYPOINT LINK — solid line to the point it's STEERING toward right now
						    (next doorway, or the food when same-room) + a small marker. */}
						{waypoint && (
							<>
								<line
									x1={center.x}
									y1={center.y}
									x2={waypoint.x}
									y2={waypoint.y}
									stroke="#22c55e"
									strokeWidth={2.5}
									opacity={0.95}
								/>
								<circle cx={waypoint.x} cy={waypoint.y} r={5} fill="#22c55e" opacity={0.9} />
							</>
						)}

						{/* HEADING RAY — direction the creature is travelling. */}
						<line x1={center.x} y1={center.y} x2={tip.x} y2={tip.y} stroke="#ef4444" strokeWidth={2.5} />
						{/* Centre dot. */}
						<circle cx={center.x} cy={center.y} r={3} fill="#ef4444" />
					</g>
				)
			})}
		</svg>
	)
}
