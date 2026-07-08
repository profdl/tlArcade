// The ant-mover canvas overlay: draws the POSED object body and the grab ropes as
// SVG on top of the tldraw canvas WHILE PLAYING. The maze walls and the object's
// authored resting shape are now REAL tldraw shapes (step 3a native-first), so
// tldraw renders those itself — this overlay only draws what the sim owns: the
// object at its live simulated pose (the authored shape is hidden during play)
// plus each puller's rope.
//
// v5 idioms (tlarcade-do-realtime-sim skill + repo gotchas):
//  - Rendered via the `InFrontOfTheCanvas` component slot (see App).
//  - Positioned with `editor.pageToViewport` (NOT pageToScreen — the overlay
//    mounts inside the editor container; pageToScreen drifts by the container
//    offset). Reads the camera so it follows pan/zoom.
//  - Reads pose/shape/ropes from atoms via `useValue` — the same reactive path
//    the network broadcast will use, so nothing here changes when the source
//    flips from local sim (step 3a) to network (step 5).
//  - Pointer-events off so grabs hit the canvas beneath.

import { useEditor, useValue } from 'tldraw'
import { objPoseAtom, ropesAtom, objShapeAtom } from './state'

export function Field() {
	const editor = useEditor()

	// Follow pan/zoom: read the whole camera so any change re-runs the mapping.
	const camera = useValue('am-camera', () => editor.getCamera(), [editor])
	const pose = useValue('am-objPose', () => objPoseAtom.get(), [])
	const shape = useValue('am-objShape', () => objShapeAtom.get(), [])
	const ropes = useValue('am-ropes', () => ropesAtom.get(), [])

	const zoom = camera.z
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
			{/* The posed object: a group translated to the pose center + rotated by the
			    pose angle, with each convex piece drawn as a polygon in the body's local
			    frame (page px, +y down — matches SVG). Page angle is cw-positive which
			    matches SVG's cw-positive rotate(), so no sign flip. */}
			{shape &&
				(() => {
					const c = toView(pose.x, pose.y)
					const deg = (pose.angle * 180) / Math.PI
					return (
						<g transform={`translate(${c.x} ${c.y}) rotate(${deg}) scale(${zoom})`}>
							{shape.pieces.map((piece, i) => (
								<polygon
									key={`obj-${i}`}
									points={piece.map((p) => `${p.x},${p.y}`).join(' ')}
									className="am-obj"
								/>
							))}
						</g>
					)
				})()}

			{/* Grab ropes: a line from the grabbed point ON the object to the puller's
			    cursor, with a knot at the grab end and a ring at the cursor. The human's
			    own rope is styled distinctly. Both endpoints are page → viewport; the
			    object-end tracks the rotating piece. */}
			{ropes.map((r, i) => {
				const a = toView(r.anchor.x, r.anchor.y)
				const c = toView(r.cursor.x, r.cursor.y)
				const cls = r.human ? 'am-rope am-rope-human' : 'am-rope'
				return (
					<g key={`rope-${i}`}>
						<line x1={a.x} y1={a.y} x2={c.x} y2={c.y} className={cls} />
						<circle cx={a.x} cy={a.y} r={4} className={`${cls} am-rope-knot`} />
						<circle cx={c.x} cy={c.y} r={5} className={`${cls} am-rope-hand`} />
					</g>
				)
			})}
		</svg>
	)
}
