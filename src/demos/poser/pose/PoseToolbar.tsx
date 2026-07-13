import { useCallback } from 'react'
import { Box, stopEventPropagation, TldrawUiContextualToolbar, useEditor, useValue } from 'tldraw'
import { applyPose, POSES } from '../poses/applyPose'
import { attachDrawing } from '../poses/attachDrawing'
import { bonesByName, figureId } from '../rig/buildFigure'
import { rigVisible, toggleRig } from './rigVisibility'

/**
 * A floating pose picker that appears above a figure's HEAD when one or more of its
 * bones is selected. Built on tldraw's `TldrawUiContextualToolbar`, which handles
 * centering, camera-tracking, screen-clamping, and show/hide.
 *
 * Two anchoring/UX choices specific to this rig:
 * - The toolbar tracks the figure's **head**, not the raw selection bounds, so it
 *   sits above the figure no matter which limb is selected (selecting a foot still
 *   floats the menu over the head).
 * - A **Move** handle drags the whole figure. Since a figure's id IS its pelvis
 *   (root) shape id, moving the figure is just translating that one shape — every
 *   other bone is pinned to it and follows via the bone-joint bindings.
 *
 * The pose applies to the figure that owns the selection (resolved via
 * `meta.figureId`), so each figure on the canvas is posed independently.
 */
export function PoseToolbar() {
	const editor = useEditor()

	// The figure owning the current selection: the figureId shared by the selected
	// bones. Reactive. Null when nothing (or a non-bone) is selected, or when the
	// selection spans two figures.
	const selectedFigure = useValue(
		'selected-figure',
		() => {
			const ids = editor.getSelectedShapeIds()
			if (ids.length === 0) return null
			const figs = new Set(ids.map((id) => figureId(editor, id)).filter(Boolean))
			return figs.size === 1 ? ([...figs][0] ?? null) : null
		},
		[editor]
	)

	// Screen-space bounds of the figure's HEAD bone — what the toolbar positions
	// itself above. Anchoring to the head (rather than the selection) keeps the menu
	// over the figure regardless of which bone the user grabbed. Undefined → hide.
	const getSelectionBounds = useCallback(() => {
		if (!selectedFigure) return undefined
		const headId = bonesByName(editor, selectedFigure).get('head')
		const headPage = headId ? editor.getShapePageBounds(headId) : undefined
		if (!headPage) return undefined
		// Convert the head's page box to a screen-space Box (the toolbar expects screen).
		const tl = editor.pageToScreen({ x: headPage.minX, y: headPage.minY })
		const br = editor.pageToScreen({ x: headPage.maxX, y: headPage.maxY })
		return new Box(tl.x, tl.y, br.x - tl.x, br.y - tl.y)
	}, [editor, selectedFigure])

	// Drag the Move handle → translate the whole figure by moving its pelvis (= the
	// figureId shape). We track pointer deltas in page space so the move is 1:1 with
	// the cursor at any zoom, and wrap the gesture in one undo step.
	const startMove = useCallback(
		(e: React.PointerEvent) => {
			if (!selectedFigure) return
			stopEventPropagation(e)
			;(e.target as Element).setPointerCapture(e.pointerId)
			editor.markHistoryStoppingPoint('move-figure')

			const startPage = editor.screenToPage({ x: e.clientX, y: e.clientY })
			const pelvis = editor.getShape(selectedFigure)
			if (!pelvis) return
			const originX = pelvis.x
			const originY = pelvis.y

			const onMove = (ev: PointerEvent) => {
				const p = editor.screenToPage({ x: ev.clientX, y: ev.clientY })
				editor.updateShape({
					id: selectedFigure,
					type: 'poser-bone',
					x: originX + (p.x - startPage.x),
					y: originY + (p.y - startPage.y),
				})
			}
			const onUp = () => {
				window.removeEventListener('pointermove', onMove)
				window.removeEventListener('pointerup', onUp)
			}
			window.addEventListener('pointermove', onMove)
			window.addEventListener('pointerup', onUp)
		},
		[editor, selectedFigure]
	)

	// Whether the rig is currently shown (drives the Show/Hide button label).
	const shown = useValue('rigVisible', () => rigVisible.get(), [])

	if (!selectedFigure) return null

	return (
		<TldrawUiContextualToolbar getSelectionBounds={getSelectionBounds} label="Pose">
			<div className="poser-ctx" onPointerDown={(e) => e.stopPropagation()}>
				<select
					className="poser-select"
					defaultValue=""
					onChange={(e) => {
						const pose = POSES[Number(e.target.value)]
						if (pose) applyPose(editor, selectedFigure, pose)
						e.target.value = '' // reset so re-picking the same pose fires again
					}}
				>
					<option value="" disabled>
						Choose a pose…
					</option>
					{POSES.map((pose, i) => (
						<option key={i} value={i}>
							{pose.name}
						</option>
					))}
				</select>
				<button className="poser-move" title="Drag to move the whole figure" onPointerDown={startMove}>
					✥ Move
				</button>
				<button
					className="poser-btn2"
					title="Attach nearby drawn shapes to this figure's bones so they pose with the rig"
					onClick={() => attachDrawing(editor, selectedFigure)}
				>
					Apply rig
				</button>
				<button
					className="poser-btn2"
					title="Show or hide the bones (attached artwork keeps posing either way)"
					onClick={toggleRig}
				>
					{shown ? 'Hide rig' : 'Show rig'}
				</button>
			</div>
		</TldrawUiContextualToolbar>
	)
}
