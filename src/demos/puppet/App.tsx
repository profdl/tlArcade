import { useCallback, useState } from 'react'
import { Tldraw, type Editor, type TLComponents, type TLShape, type TLShapeId } from 'tldraw'
import 'tldraw/tldraw.css'
import { TLDRAW_LICENSE_KEY } from '../licenseKey'
import { PuppetStage } from './PuppetStage'
import { buildDefaultPuppet } from './rig/defaultPuppet'
import { getPuppetCenter, PUPPET_LAYOUT, setPuppetCenter } from './rig/layout'
import { PuppetGeoShapeUtil } from './rig/puppetShapeUtils'
import { getPuppetMeta } from './rig/roles'
import { PuppetContextMenu } from './ui/PuppetContextMenu'
import { PuppetPlaceholders } from './ui/PuppetPlaceholders'
import { PuppetSelectionToolbar } from './ui/PuppetSelectionToolbar'

/**
 * Puppet — a VTuber-style rig on the tldraw canvas. The puppet is ordinary
 * native shapes tagged with rig roles via `meta`; webcam face tracking drives
 * them through a shared PuppetDriver. On mount we drop a default puppet (built
 * from geo shapes) the user can redraw or restyle freely.
 */
// The right-click "Puppet role" submenu that assigns rig roles to selected art.
// Module-level constant so <Tldraw> doesn't see a fresh `components` prop each
// render.
// InFrontOfTheCanvas is a single screen-space slot, so compose our two overlays
// (the empty-slot placeholders behind, the selection toolbar in front) into one.
function PuppetOverlays() {
	return (
		<>
			<PuppetPlaceholders />
			<PuppetSelectionToolbar />
		</>
	)
}

const components: TLComponents = { ContextMenu: PuppetContextMenu, InFrontOfTheCanvas: PuppetOverlays }

// Replace the built-in geo util with one that forbids resizing a rig feature
// while tracking is live (same 'geo' type → overrides the default). Module-level
// so <Tldraw> sees a stable array reference.
const shapeUtils = [PuppetGeoShapeUtil]

/**
 * Recover the fixed-layout center of a puppet persisted before the placeholder
 * overlay existed: find any existing feature whose role is in the layout table
 * and invert `center = restTopLeft − layoutOffset`. Uses the immutable rest pose
 * (not the live, possibly-deformed transform) so the derived center is stable.
 */
function backfillPuppetCenter(editor: Editor, puppetShapes: readonly TLShape[]): void {
	for (const shape of puppetShapes) {
		const meta = getPuppetMeta(shape)
		const rest = meta?.rest
		if (!meta || !rest) continue
		const part = PUPPET_LAYOUT.find((p) => p.role === meta.puppetRole)
		if (!part) continue
		setPuppetCenter(editor, { x: rest.x - part.x, y: rest.y - part.y })
		return
	}
}

export default function App() {
	const [editor, setEditor] = useState<Editor | null>(null)

	const spawnPuppet = useCallback((editor: Editor) => {
		const center = editor.getViewportPageBounds().center
		// Persist the puppet center on the page so the fixed-layout placeholder
		// overlay knows where empty slots sit, even after reload.
		setPuppetCenter(editor, center)
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
			} else if (!getPuppetCenter(editor)) {
				// A puppet persisted from before the fixed-layout placeholder overlay
				// has no stored center. Back-fill it from an anchor role's rest pose
				// (its layout offset is known) so empty-slot placeholders line up.
				backfillPuppetCenter(editor, puppetShapes)
			}
			if (import.meta.env.DEV) (window as unknown as { __editor: Editor }).__editor = editor
		},
		[spawnPuppet, resetPuppet]
	)

	return (
		<div style={{ position: 'fixed', inset: 0 }}>
			<Tldraw licenseKey={TLDRAW_LICENSE_KEY} persistenceKey="puppet" onMount={handleMount} components={components} shapeUtils={shapeUtils} />
			<div
				style={{
					position: 'absolute',
					// Bottom-right, above the "Get a license" watermark. tldraw's top-right
					// StylePanel now grows DOWN from the top edge and our panel grows UP
					// from the bottom, so they share the right column without colliding at
					// normal viewport heights. The selection role-assign UI is the floating
					// toolbar above the shape (InFrontOfTheCanvas), not here.
					bottom: 56,
					right: 8,
					zIndex: 400,
					width: 260,
					maxHeight: 'calc(100vh - 64px)',
					borderRadius: 12,
					background: 'var(--tl-color-panel, white)',
					boxShadow: 'var(--tl-shadow-2)',
					overflow: 'hidden auto',
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
