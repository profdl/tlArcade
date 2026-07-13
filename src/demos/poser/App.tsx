import { useCallback, useRef } from 'react'
import { Tldraw, type Editor, type TLComponents } from 'tldraw'
import 'tldraw/tldraw.css'
import './App.css'
import { BoneJointBindingUtil } from './bindings/BoneJointBindingUtil'
import { IkHandlesOverlay } from './pose/IkHandlesOverlay'
import { applyPose, POSES } from './poses/applyPose'
import { buildFigure } from './rig/buildFigure'
import { BoneShapeUtil } from './shapes/BoneShapeUtil'

const shapeUtils = [BoneShapeUtil]
const bindingUtils = [BoneJointBindingUtil]
// Draggable IK handles at the hands/feet, rendered above the canvas.
const components: TLComponents = { InFrontOfTheCanvas: IkHandlesOverlay }

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
				<select
					className="poser-select"
					defaultValue=""
					onChange={(e) => {
						const pose = POSES[Number(e.target.value)]
						if (pose && editorRef.current) applyPose(editorRef.current, pose)
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
