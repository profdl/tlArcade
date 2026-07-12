import {
	DefaultContextMenu,
	DefaultContextMenuContent,
	TldrawUiMenuGroup,
	TldrawUiMenuItem,
	TldrawUiMenuSubmenu,
	useEditor,
	useValue,
	type TLUiContextMenuProps,
} from 'tldraw'
import { assignRole, clearRole, reanchorRole, selectionRole } from '../rig/assign'
import { PUPPET_ROLES } from '../rig/roles'

/**
 * A right-click **Puppet** submenu that assigns rig roles to whatever shapes are
 * selected — the "bring your own art" authoring flow. It reuses tldraw's
 * `DefaultContextMenu` shell (all the trigger/portal/touch-long-press logic) and
 * only overrides its *content*: the full default menu, plus our own group when a
 * selection exists. The submenu shows the built-in role vocabulary with a check on
 * the selection's current role, plus "Re-anchor rest pose" and "Remove from puppet".
 *
 * All rig state is plain `meta` written by `rig/assign.ts`; this component is pure
 * UI. The driver's store listener re-scans on the resulting document change, so an
 * assigned feature joins the rig on the next frame with no extra wiring.
 */
export function PuppetContextMenu(props: TLUiContextMenuProps) {
	const editor = useEditor()

	// Reactively track the selection so the menu enables/checks the right items.
	const hasSelection = useValue('puppet-has-selection', () => editor.getSelectedShapeIds().length > 0, [editor])
	const currentRole = useValue('puppet-role', () => selectionRole(editor, editor.getSelectedShapeIds()), [editor])
	const isTagged = currentRole !== null

	return (
		<DefaultContextMenu {...props}>
			<DefaultContextMenuContent />
			{hasSelection && (
				<TldrawUiMenuGroup id="puppet">
					<TldrawUiMenuSubmenu id="puppet-role" label={currentRole ? `Puppet role: ${currentRole}` : 'Assign puppet role…'}>
						<TldrawUiMenuGroup id="puppet-roles">
							{PUPPET_ROLES.map((role) => (
								<TldrawUiMenuItem
									key={role}
									id={`puppet-role-${role}`}
									label={role}
									isSelected={currentRole === role}
									onSelect={() => {
										assignRole(editor, editor.getSelectedShapeIds(), role)
									}}
								/>
							))}
						</TldrawUiMenuGroup>
						<TldrawUiMenuGroup id="puppet-role-actions">
							<TldrawUiMenuItem
								id="puppet-reanchor"
								label="Re-anchor rest pose"
								disabled={!isTagged}
								onSelect={() => {
									reanchorRole(editor, editor.getSelectedShapeIds())
								}}
							/>
							<TldrawUiMenuItem
								id="puppet-clear"
								label="Remove from puppet"
								disabled={!isTagged}
								onSelect={() => {
									clearRole(editor, editor.getSelectedShapeIds())
								}}
							/>
						</TldrawUiMenuGroup>
					</TldrawUiMenuSubmenu>
				</TldrawUiMenuGroup>
			)}
		</DefaultContextMenu>
	)
}
