import { useCallback, useState } from 'react'
import { Tldraw, type Editor } from 'tldraw'
import 'tldraw/tldraw.css'
import { PuppetStage } from './PuppetStage'
import { buildDefaultPuppet } from './rig/defaultPuppet'

/**
 * Puppet — a VTuber-style rig on the tldraw canvas. The puppet is ordinary
 * native shapes tagged with rig roles via `meta`; webcam face tracking drives
 * them through a shared PuppetDriver. On mount we drop a default puppet (built
 * from geo shapes) the user can redraw or restyle freely.
 */
export default function App() {
	const [editor, setEditor] = useState<Editor | null>(null)

	const handleMount = useCallback((editor: Editor) => {
		setEditor(editor)
		// Guard against StrictMode double-mount creating two puppets.
		const hasPuppet = editor.getCurrentPageShapes().some((s) => (s.meta as { puppetRole?: string })?.puppetRole)
		if (!hasPuppet) {
			const center = editor.getViewportPageBounds().center
			const ids = buildDefaultPuppet(editor, center.x, center.y)
			editor.zoomToBounds(editor.getShapePageBounds(ids[0])!, { inset: 220, animation: { duration: 300 } })
		}
		if (import.meta.env.DEV) (window as unknown as { __editor: Editor }).__editor = editor
	}, [])

	return (
		<div style={{ position: 'fixed', inset: 0 }}>
			<Tldraw persistenceKey="puppet" onMount={handleMount} />
			<div
				style={{
					position: 'absolute',
					top: 8,
					right: 8,
					zIndex: 400,
					width: 260,
					borderRadius: 12,
					background: 'var(--tl-color-panel, white)',
					boxShadow: 'var(--tl-shadow-2)',
					overflow: 'hidden',
				}}
			>
				{editor && <PuppetStage editor={editor} />}
			</div>
		</div>
	)
}
