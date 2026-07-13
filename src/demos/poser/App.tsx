import { useCallback, useRef } from 'react'
import { Tldraw, type Editor, type TLComponents } from 'tldraw'
import 'tldraw/tldraw.css'
import './App.css'
import { BoneJointBindingUtil } from './bindings/BoneJointBindingUtil'
import { IkHandlesOverlay } from './pose/IkHandlesOverlay'
import { PoseToolbar } from './pose/PoseToolbar'
import { buildFigure } from './rig/buildFigure'
import { BoneShapeUtil } from './shapes/BoneShapeUtil'

const shapeUtils = [BoneShapeUtil]
const bindingUtils = [BoneJointBindingUtil]

// Both canvas overlays share the one InFrontOfTheCanvas slot: the IK hand/foot
// handles, and the per-figure pose picker that floats above a selected figure.
function InFrontOfTheCanvas() {
	return (
		<>
			<IkHandlesOverlay />
			<PoseToolbar />
		</>
	)
}
const components: TLComponents = { InFrontOfTheCanvas }

function addFigure(editor: Editor) {
	const center = editor.getViewportPageBounds().center
	// Place the pelvis a bit below center so the standing figure is framed.
	buildFigure(editor, { x: center.x, y: center.y - 120 })
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
		}
	}, [])

	return (
		<div className="poser-root">
			<Tldraw
				persistenceKey="poser"
				shapeUtils={shapeUtils}
				bindingUtils={bindingUtils}
				components={components}
				onMount={handleMount}
			/>
			<div className="poser-toolbar">
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
