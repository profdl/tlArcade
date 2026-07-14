import { useCallback } from 'react'
import { useEditor, useValue } from 'tldraw'
import { JOINTS, rigModeJoints, setJoint, type JointKey } from '../rig/jointMarkers'
import { useDragGesture } from './useDragGesture'

const MARKER_RADIUS = 8 // px, screen-space

/**
 * The Mixamo-style rig-mode overlay: a labeled, draggable marker at each joint, plus
 * a live preview skeleton drawn between connected joints. The user drags each marker
 * onto their drawing; "Build rig" (in the toolbar) then reads these positions and
 * builds a fitted figure (buildFigureFromJoints).
 *
 * Screen-space overlay via InFrontOfTheCanvas, same pattern as IkHandlesOverlay:
 * `useValue` reads the joint atom + camera so markers track pan/zoom, the root is
 * pointer-events:none, and only the markers capture input.
 */
export function RigModeOverlay() {
	const editor = useEditor()

	// VIEWPORT positions of every joint (and the parent links for the preview lines).
	// This overlay renders inside the `tl-canvas__in-front` wrapper, whose origin is
	// the editor CONTAINER's top-left — i.e. viewport space, NOT screen space. So we
	// position with pageToViewport, not pageToScreen; using screen coords here would
	// shift every marker by the container's on-page offset (the top nav bar / left
	// panel), which is what made markers jump on grab and the built rig land off.
	// Reactive on both the joint atom and the camera.
	const view = useValue(
		'rig-mode-markers',
		() => {
			const joints = rigModeJoints.get()
			if (!joints) return null
			const vp = {} as Record<JointKey, { x: number; y: number }>
			for (const j of JOINTS) {
				const v = editor.pageToViewport(joints[j.key])
				vp[j.key] = { x: v.x, y: v.y }
			}
			const links = JOINTS.filter((j) => j.parent).map((j) => ({
				key: j.key,
				a: vp[j.key],
				b: vp[j.parent as JointKey],
			}))
			return { markers: vp, links }
		},
		[editor]
	)

	const startDragGesture = useDragGesture()
	const startDrag = useCallback(
		(key: JointKey) =>
			startDragGesture((ev) => {
				const p = editor.screenToPage({ x: ev.clientX, y: ev.clientY })
				setJoint(key, p.x, p.y)
			}),
		[editor, startDragGesture]
	)

	if (!view) return null

	return (
		<>
			{/* preview skeleton: a line per bone, behind the markers, non-interactive */}
			<svg
				style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
			>
				{view.links.map((l) => (
					<line
						key={l.key}
						x1={l.a.x}
						y1={l.a.y}
						x2={l.b.x}
						y2={l.b.y}
						stroke="var(--color-selected, #4f46e5)"
						strokeWidth={2}
						strokeLinecap="round"
						opacity={0.6}
					/>
				))}
			</svg>
			{JOINTS.map((j) => {
				const p = view.markers[j.key]
				return (
					<div
						key={j.key}
						onPointerDown={startDrag(j.key)}
						title={j.label}
						style={{
							position: 'absolute',
							left: p.x - MARKER_RADIUS,
							top: p.y - MARKER_RADIUS,
							width: MARKER_RADIUS * 2,
							height: MARKER_RADIUS * 2,
							borderRadius: MARKER_RADIUS,
							background: 'white',
							border: '2px solid var(--color-selected, #4f46e5)',
							boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
							cursor: 'grab',
							pointerEvents: 'all',
							touchAction: 'none',
						}}
					/>
				)
			})}
		</>
	)
}
