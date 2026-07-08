// The ant-mover canvas overlay: draws the static maze walls, the exit zone, and
// the posed T-piece as SVG on top of the tldraw canvas.
//
// v5 idioms (from tlarcade-do-realtime-sim skill + repo gotchas):
//  - Rendered via the `InFrontOfTheCanvas` component slot (see App).
//  - Positioned with `editor.pageToViewport` (NOT pageToScreen — the overlay
//    mounts inside the editor container; pageToScreen drifts by the container
//    offset). Reads the camera so it follows pan/zoom.
//  - Reads the T pose from an atom via `useValue` — the same reactive path the
//    broadcast pose will use, so nothing here changes when the source flips from
//    local sim (step 2) to network (step 5).
//  - Pointer-events off so grabs (step 2) hit the canvas beneath.

import { useEditor, useValue } from 'tldraw'
import { MAZE_WALLS, EXIT, T_FIXTURES } from './geometry'
import { tPoseAtom } from './state'

export function Field() {
	const editor = useEditor()

	// Follow pan/zoom: read the whole camera so any change re-runs the mapping.
	const camera = useValue('am-camera', () => editor.getCamera(), [editor])
	// The T pose to draw (page space), reactively.
	const pose = useValue('am-tPose', () => tPoseAtom.get(), [])

	const zoom = camera.z
	// page point → viewport (container-relative) point.
	const toView = (x: number, y: number) => editor.pageToViewport({ x, y })

	return (
		<svg
			className="am-overlay"
			style={{
				position: 'absolute',
				inset: 0,
				width: '100%',
				height: '100%',
				pointerEvents: 'none',
				overflow: 'visible',
			}}
		>
			{/* Maze walls: axis-aligned page rects → viewport rects. */}
			{MAZE_WALLS.map((w, i) => {
				const tl = toView(w.cx - w.halfW, w.cy - w.halfH)
				return (
					<rect
						key={`wall-${i}`}
						x={tl.x}
						y={tl.y}
						width={w.halfW * 2 * zoom}
						height={w.halfH * 2 * zoom}
						className="am-wall"
					/>
				)
			})}

			{/* Exit zone. */}
			{(() => {
				const tl = toView(EXIT.cx - EXIT.halfW, EXIT.cy - EXIT.halfH)
				return (
					<rect
						x={tl.x}
						y={tl.y}
						width={EXIT.halfW * 2 * zoom}
						height={EXIT.halfH * 2 * zoom}
						className="am-exit"
					/>
				)
			})()}

			{/* The T: a group translated to the pose center + rotated by the pose
			    angle, with each fixture drawn as a rect in the body's local frame.
			    Rotation is in DEGREES for the SVG transform; page angle is cw-positive
			    which matches SVG's cw-positive rotate(), so no sign flip. */}
			{(() => {
				const c = toView(pose.x, pose.y)
				const deg = (pose.angle * 180) / Math.PI
				return (
					<g transform={`translate(${c.x} ${c.y}) rotate(${deg}) scale(${zoom})`}>
						{T_FIXTURES.map((f, i) => (
							<rect
								key={`t-${i}`}
								x={f.cx - f.halfW}
								y={f.cy - f.halfH}
								width={f.halfW * 2}
								height={f.halfH * 2}
								className="am-t"
							/>
						))}
					</g>
				)
			})()}
		</svg>
	)
}
