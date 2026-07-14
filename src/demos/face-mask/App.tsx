import { useCallback, useRef } from 'react'
import { Tldraw, createShapeId, type Editor } from 'tldraw'
import 'tldraw/tldraw.css'
import { addDefaultFaceFeatures } from './addDefaultFaceFeatures'
import { FaceFeatureBindingUtil } from './bindings/FaceFeatureBindingUtil'
import { dragSnapCandidateAtom } from './dragSnapPreview'
import { ArrowFaceFeatureShapeUtil } from './shapes/ArrowFaceFeatureShapeUtil'
import { FaceVideoShapeUtil } from './shapes/FaceVideoShapeUtil'
import { FaceVideoStylePanel } from './shapes/FaceVideoStylePanel'
import { FACE_VIDEO_DEFAULT_H, FACE_VIDEO_DEFAULT_W, type FaceVideoShape } from './shapes/faceVideoShape'
import {
	clearDragSnapPreview,
	setupDrawShapeSnapping,
	trySnapSelectedShapesToFace,
	updateDragSnapPreview,
} from './snapToFace'
import { TLDRAW_LICENSE_KEY } from '../licenseKey'

const shapeUtils = [FaceVideoShapeUtil, ArrowFaceFeatureShapeUtil]
const bindingUtils = [FaceFeatureBindingUtil]
const components = { StylePanel: FaceVideoStylePanel }

function addFaceVideo(editor: Editor) {
	const center = editor.getViewportPageBounds().center
	const faceShapeId = createShapeId()
	const x = center.x - FACE_VIDEO_DEFAULT_W / 2
	const y = center.y - FACE_VIDEO_DEFAULT_H / 2
	editor.createShape<FaceVideoShape>({ id: faceShapeId, type: 'face-video', x, y, props: { color: 'orange' } })
	addDefaultFaceFeatures(editor, faceShapeId, x, y)
}

export default function App() {
	const editorRef = useRef<Editor | null>(null)

	const handleMount = useCallback((editor: Editor) => {
		editorRef.current = editor
		editor.on('event', (info) => {
			if (info.name === 'pointer_move' && editor.inputs.getIsDragging()) {
				updateDragSnapPreview(editor)
			}
			if (info.name === 'pointer_up') {
				clearDragSnapPreview()
				trySnapSelectedShapesToFace(editor)
			}
		})
		setupDrawShapeSnapping(editor)
		// Guard against React StrictMode's double-invoked mount effect creating two.
		if (editor.getCurrentPageShapes().every((s) => s.type !== 'face-video')) {
			addFaceVideo(editor)
		}
		if (import.meta.env.DEV) {
			;(window as any).__editor = editor
			;(window as any).__snapToFace = () => trySnapSelectedShapesToFace(editor)
			;(window as any).__updateDragSnapPreview = () => updateDragSnapPreview(editor)
			;(window as any).__dragSnapCandidate = dragSnapCandidateAtom
		}
	}, [])

	return (
		<div style={{ position: 'fixed', inset: 0 }}>
			<Tldraw licenseKey={TLDRAW_LICENSE_KEY} shapeUtils={shapeUtils} bindingUtils={bindingUtils} components={components} onMount={handleMount} />
			<button
				style={{
					position: 'absolute',
					bottom: 44,
					right: 8,
					zIndex: 400,
					padding: '8px 12px',
					borderRadius: 8,
					border: '1px solid var(--tl-color-panel-contrast, #d3d3d3)',
					background: 'var(--tl-color-panel, white)',
					boxShadow: 'var(--tl-shadow-2)',
					cursor: 'pointer',
					font: 'inherit',
				}}
				onClick={() => {
					if (editorRef.current) addFaceVideo(editorRef.current)
				}}
			>
				Add face video
			</button>
		</div>
	)
}
