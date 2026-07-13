import { useCallback } from 'react'
import { useEditor, useValue } from 'tldraw'
import { getIkChains } from './effectors'
import { rigVisible } from './rigVisibility'
import { effectorTipPage, solveTwoBoneIk } from './solveTwoBoneIk'
import { useDragGesture } from './useDragGesture'

const HANDLE_RADIUS = 9 // px, screen-space (constant regardless of zoom)

/**
 * A screen-space overlay of draggable IK handles at each hand/foot. Rendered via
 * the `InFrontOfTheCanvas` component slot. Dragging a handle solves that limb's
 * two-bone IK so the tip follows the pointer (solveTwoBoneIk), giving the natural
 * "grab the hand, the arm bends to follow" posing.
 *
 * The dots stay glued to the (moving) effector tips: `useValue` reads each tip's
 * page position and the camera, so it re-renders whenever a bone moves or the
 * view pans/zooms. The overlay root is pointer-events:none; only the dots capture
 * input, so the rest of the canvas stays fully interactive.
 */
export function IkHandlesOverlay() {
	const editor = useEditor()

	// Screen-space position of each limb's effector tip. Reactive: reads bone
	// transforms + camera via the editor, so it recomputes on any pose/camera change.
	const handles = useValue(
		'ik-handles',
		() => {
			if (!rigVisible.get()) return [] // hidden rig → no handles (art-only view)
			return getIkChains(editor)
				.map((chain) => {
					const tipPage = effectorTipPage(editor, chain.effectorBoneId)
					if (!tipPage) return null
					// Position in VIEWPORT space (container-relative), not screen space —
					// this overlay lives inside `tl-canvas__in-front`, whose origin is the
					// editor container. pageToScreen would offset the dots by the container's
					// on-page position (top bar / left panel).
					const s = editor.pageToViewport(tipPage)
					return { ...chain, sx: s.x, sy: s.y }
				})
				.filter((h): h is NonNullable<typeof h> => h !== null)
		},
		[editor]
	)

	const startDragGesture = useDragGesture()
	const startDrag = useCallback(
		(rootBoneId: (typeof handles)[number]['rootBoneId'], effectorBoneId: (typeof handles)[number]['effectorBoneId']) =>
			startDragGesture(
				(ev) => {
					const targetPage = editor.screenToPage({ x: ev.clientX, y: ev.clientY })
					solveTwoBoneIk(editor, rootBoneId, effectorBoneId, targetPage)
				},
				// One undo step for the whole drag gesture (the per-move solves use history:'ignore').
				{ onStart: () => editor.markHistoryStoppingPoint('ik-pose') }
			),
		[editor, startDragGesture]
	)

	return (
		<>
			{handles.map((h) => (
				<div
					key={`${h.figureId}:${h.label}`}
					onPointerDown={startDrag(h.rootBoneId, h.effectorBoneId)}
					title={h.label}
					style={{
						position: 'absolute',
						left: h.sx - HANDLE_RADIUS,
						top: h.sy - HANDLE_RADIUS,
						width: HANDLE_RADIUS * 2,
						height: HANDLE_RADIUS * 2,
						borderRadius: HANDLE_RADIUS,
						background: 'var(--color-selected, #4f46e5)',
						border: '2px solid white',
						boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
						cursor: 'grab',
						pointerEvents: 'all',
						touchAction: 'none',
					}}
				/>
			))}
		</>
	)
}
