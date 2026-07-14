import { b64Vecs } from '@tldraw/tlschema'
import { useCallback, useRef } from 'react'
import { Tldraw, useValue, type Editor, type TLComponents } from 'tldraw'
import 'tldraw/tldraw.css'
import './App.css'
import { TLDRAW_LICENSE_KEY } from '../licenseKey'
import { BoneAttachmentBindingUtil } from './bindings/BoneAttachmentBindingUtil'
import { BoneJointBindingUtil } from './bindings/BoneJointBindingUtil'
import { IkHandlesOverlay } from './pose/IkHandlesOverlay'
import { PoseToolbar } from './pose/PoseToolbar'
import { RigModeOverlay } from './pose/RigModeOverlay'
import { resetRigVisibility, rigVisible, toggleRig } from './pose/rigVisibility'
import { attachDrawing } from './poses/attachDrawing'
import { buildFigure } from './rig/buildFigure'
import { buildFigureFromJoints } from './rig/buildFigureFromJoints'
import { resetPlaybackState } from './pose/posePlayer'
import { enterRigMode, exitRigMode, rigModeJoints, snapJointsToDrawing } from './rig/jointMarkers'
import { BoneShapeUtil } from './shapes/BoneShapeUtil'

const shapeUtils = [BoneShapeUtil]
const bindingUtils = [BoneJointBindingUtil, BoneAttachmentBindingUtil]

// All canvas overlays share the one InFrontOfTheCanvas slot: the IK hand/foot
// handles, the per-figure pose picker, and (when active) the rig-mode joint markers.
function InFrontOfTheCanvas() {
	return (
		<>
			<IkHandlesOverlay />
			<PoseToolbar />
			<RigModeOverlay />
		</>
	)
}
const components: TLComponents = { InFrontOfTheCanvas }

// Drop the pelvis this far above the viewport center so the whole standing figure
// (which extends downward from the pelvis) is framed rather than centered on its hips.
const SPAWN_PELVIS_OFFSET_Y = 120

function addFigure(editor: Editor) {
	const center = editor.getViewportPageBounds().center
	buildFigure(editor, { x: center.x, y: center.y - SPAWN_PELVIS_OFFSET_Y })
}

/**
 * A persistent "Show rig" button in the bottom toolbar, visible only while the rig
 * is hidden. Without it, hiding the rig and then deselecting would leave no way to
 * bring the bones back (the context toolbar needs a selection to appear).
 */
function ShowRigButton() {
	const shown = useValue('rigVisible', () => rigVisible.get(), [])
	if (shown) return null
	return (
		<button className="poser-btn" onClick={toggleRig}>
			Show rig
		</button>
	)
}

/**
 * Rig-mode controls: "Rig a drawing" seeds a joint-marker layout the user drags onto
 * their art; then "Build rig" constructs a fitted figure from those markers (so the
 * rig matches the drawing's proportions), or "Cancel" bails. Reads the rig-mode atom
 * so it swaps between the two states reactively.
 */
function RigModeControls({ editor }: { editor: () => Editor | null }) {
	const inRigMode = useValue('inRigMode', () => rigModeJoints.get() != null, [])

	if (!inRigMode) {
		return (
			<button
				className="poser-btn"
				title="Place joints on your drawing, then build a rig that fits it"
				onClick={() => {
					const e = editor()
					if (e) enterRigMode(e, e.getViewportPageBounds().center)
				}}
			>
				Rig a drawing
			</button>
		)
	}
	return (
		<>
			<button
				className="poser-btn"
				title="Snap the joints toward the drawing's limbs"
				onClick={() => {
					const e = editor()
					if (e) snapJointsToDrawing(e)
				}}
			>
				Snap to drawing
			</button>
			<button
				className="poser-btn"
				title="Build the rig from these joints and attach the drawing to it"
				onClick={() => {
					const e = editor()
					const joints = rigModeJoints.get()
					if (e && joints) {
						// One click: build the fitted figure from the placed joints, then attach
						// the drawing (strokes cut at joints, other shapes rigid) to those bones.
						e.run(() => {
							const figure = buildFigureFromJoints(e, joints)
							if (figure) attachDrawing(e, figure)
						})
						exitRigMode()
					}
				}}
			>
				Apply rig
			</button>
			<button className="poser-btn" onClick={() => exitRigMode()}>
				Cancel
			</button>
		</>
	)
}

export default function App() {
	const editorRef = useRef<Editor | null>(null)

	const handleMount = useCallback((editor: Editor) => {
		editorRef.current = editor
		// Guard against StrictMode's double-invoked mount effect building two figures.
		if (editor.getCurrentPageShapes().every((s) => s.type !== 'poser-bone')) {
			addFigure(editor)
			editor.zoomToFit({ animation: { duration: 0 } })
		}
		if (import.meta.env.DEV) {
			;(window as unknown as { __editor: Editor }).__editor = editor
			// Test hooks for the headless-browser verification of rig mode + stroke cutting.
			;(window as unknown as { __rig: unknown }).__rig = { rigModeJoints, enterRigMode, exitRigMode, b64Vecs }
		}
		// On unmount, reset all module-level state so a remount in the switcher starts
		// clean: cancel in-flight rAF loops, clear per-figure playback state (which is
		// keyed by ids that won't recur), restore the rig-shown default, and leave
		// rig mode. These atoms/maps outlive the component, so without this a remount
		// inherits stale state.
		return () => {
			resetPlaybackState()
			resetRigVisibility()
			exitRigMode()
		}
	}, [])

	return (
		<div className="poser-root">
			<Tldraw
				licenseKey={TLDRAW_LICENSE_KEY}
				persistenceKey="poser"
				shapeUtils={shapeUtils}
				bindingUtils={bindingUtils}
				components={components}
				onMount={handleMount}
			/>
			<div className="poser-toolbar">
				<ShowRigButton />
				<RigModeControls editor={() => editorRef.current} />
				<button
					className="poser-btn"
					onClick={() => {
						if (editorRef.current) addFigure(editorRef.current)
					}}
				>
					Add figure
				</button>
			</div>
		</div>
	)
}
