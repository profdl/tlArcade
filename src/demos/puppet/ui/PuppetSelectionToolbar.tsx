import { stopEventPropagation, useEditor, useValue } from 'tldraw'
import { assignRole, clearRole, selectionRole } from '../rig/assign'
import { PUPPET_ROLES } from '../rig/roles'

/**
 * A floating **contextual toolbar** that appears just above the current selection
 * — the on-canvas counterpart to the right-click "Puppet role" submenu, for
 * discoverability. Renders in tldraw's `InFrontOfTheCanvas` slot, which is a
 * plain screen-space overlay (NOT camera-transformed), so we position ourselves
 * by converting the selection's page bounds to viewport coordinates and reacting
 * to both camera and selection changes.
 *
 * The control is a single `<select>`: it shows the selection's current role (or a
 * "— assign role —" placeholder) and writes through the same `rig/assign.ts`
 * helpers the context menu uses. Choosing "✕ remove" clears the rig tagging.
 */

const REMOVE_VALUE = '__remove__'
const PLACEHOLDER_VALUE = ''

export function PuppetSelectionToolbar() {
	const editor = useEditor()

	// Reactively track the selection's viewport-space bounds and its shared role.
	// pageToViewport depends on the camera, so reading the camera here keeps this
	// value recomputing as the user pans/zooms with a selection active.
	const anchor = useValue(
		'puppet-toolbar-anchor',
		() => {
			const bounds = editor.getSelectionRotatedPageBounds()
			if (!bounds) return null
			editor.getCamera() // subscribe to camera so the anchor tracks pan/zoom
			const topCenter = editor.pageToViewport({ x: bounds.x + bounds.width / 2, y: bounds.y })
			return { x: topCenter.x, y: topCenter.y }
		},
		[editor]
	)
	const currentRole = useValue('puppet-toolbar-role', () => selectionRole(editor, editor.getSelectedShapeIds()), [editor])

	// Only show while editing (select tool) with a real selection.
	const show = useValue('puppet-toolbar-show', () => editor.isIn('select') && editor.getSelectedShapeIds().length > 0, [editor])
	if (!show || !anchor) return null

	const value = currentRole ?? PLACEHOLDER_VALUE

	const onChange = (next: string) => {
		const ids = editor.getSelectedShapeIds()
		if (next === REMOVE_VALUE) clearRole(editor, ids)
		else if (next) assignRole(editor, ids, next)
	}

	return (
		<div
			// Screen-space overlay: sit centered above the selection's top edge, and
			// let pointer events through to us (the wrapper marks them handled so the
			// canvas doesn't also react).
			style={{
				position: 'absolute',
				left: anchor.x,
				top: anchor.y - 12,
				transform: 'translate(-50%, -100%)',
				pointerEvents: 'all',
			}}
			onPointerDown={stopEventPropagation}
		>
			<select
				value={value}
				onChange={(e) => onChange(e.currentTarget.value)}
				style={{
					font: '12px system-ui',
					padding: '4px 8px',
					borderRadius: 8,
					border: '1px solid var(--tl-color-muted-1, #0002)',
					background: 'var(--tl-color-panel, white)',
					boxShadow: 'var(--tl-shadow-2)',
					cursor: 'pointer',
					maxWidth: 180,
				}}
				title="Assign this shape a puppet role"
			>
				<option value={PLACEHOLDER_VALUE}>{currentRole ? `role: ${currentRole}` : '— assign puppet role —'}</option>
				{PUPPET_ROLES.map((role) => (
					<option key={role} value={role}>
						{role}
					</option>
				))}
				{currentRole && <option value={REMOVE_VALUE}>✕ remove from puppet</option>}
			</select>
		</div>
	)
}
