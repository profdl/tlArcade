import { useCallback, useState } from 'react'
import { Tldraw, type Editor, type TLShapeId } from 'tldraw'
import 'tldraw/tldraw.css'
import { PuppetStage } from './PuppetStage'
import { buildDefaultPuppet } from './rig/defaultPuppet'
import { getPuppetMeta } from './rig/roles'

/**
 * Puppet — a VTuber-style rig on the tldraw canvas. The puppet is ordinary
 * native shapes tagged with rig roles via `meta`; webcam face tracking drives
 * them through a shared PuppetDriver. On mount we drop a default puppet (built
 * from geo shapes) the user can redraw or restyle freely.
 */
export default function App() {
	const [editor, setEditor] = useState<Editor | null>(null)

	const spawnPuppet = useCallback((editor: Editor) => {
		const center = editor.getViewportPageBounds().center
		const ids = buildDefaultPuppet(editor, center.x, center.y)
		editor.zoomToBounds(editor.getShapePageBounds(ids[0])!, { inset: 220, animation: { duration: 300 } })
		return ids
	}, [])

	const resetPuppet = useCallback(
		(editor: Editor) => {
			const existing = editor.getCurrentPageShapes().filter((s) => getPuppetMeta(s))
			if (existing.length) editor.deleteShapes(existing.map((s) => s.id as TLShapeId))
			spawnPuppet(editor)
		},
		[spawnPuppet]
	)

	const handleMount = useCallback(
		(editor: Editor) => {
			setEditor(editor)
			const puppetShapes = editor.getCurrentPageShapes().filter((s) => getPuppetMeta(s))
			// Fresh doc → spawn. A persisted puppet from before the rest-in-meta fix
			// has no meta.rest and would deform from a stale/mangled pose; rebuild it.
			const needsRebuild = puppetShapes.length > 0 && puppetShapes.some((s) => !getPuppetMeta(s)!.rest)
			if (puppetShapes.length === 0) {
				spawnPuppet(editor)
			} else if (needsRebuild) {
				resetPuppet(editor)
			}
			if (import.meta.env.DEV) (window as unknown as { __editor: Editor }).__editor = editor
		},
		[spawnPuppet, resetPuppet]
	)

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
				{editor && (
					<button
						onClick={() => resetPuppet(editor)}
						style={{ width: '100%', padding: '8px', font: '12px system-ui', cursor: 'pointer', border: 'none', borderTop: '1px solid #0001' }}
					>
						Reset puppet
					</button>
				)}
			</div>
		</div>
	)
}
