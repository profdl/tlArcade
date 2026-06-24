/**
 * CUSTOM UI  (main menu + where future panels/menus go)
 * =====================================================
 * tldraw v5's entire UI is a set of swappable React components passed via the
 * `components` prop on <Tldraw>. You do NOT fork tldraw's menu — you COMPOSE
 * your items next to the defaults. This file is the worked example the CLAUDE.md
 * "add a main-menu item" recipe points to.
 *
 * To add a menu item: drop another <TldrawUiMenuItem> into the group below.
 */
import {
	createShapeId,
	DefaultMainMenu,
	DefaultMainMenuContent,
	Editor,
	TLComponents,
	TldrawUiMenuGroup,
	TldrawUiMenuItem,
	useEditor,
} from 'tldraw'

function GameMainMenu() {
	// `useEditor()` is how a UI component reaches the editor. Close over it in the
	// onSelect handlers below.
	const editor = useEditor()

	return (
		<DefaultMainMenu>
			{/* Our items live in their own group so they don't collide with tldraw's. */}
			<TldrawUiMenuGroup id="game-toolkit">
				<TldrawUiMenuItem
					id="add-token"
					label="Add token"
					icon="plus"
					readonlyOk={false}
					onSelect={() => addTokenAtCenter(editor)}
				/>
				<TldrawUiMenuItem
					id="reset-board"
					label="Clear board"
					icon="trash"
					readonlyOk={false}
					onSelect={() => clearBoard(editor)}
				/>
			</TldrawUiMenuGroup>

			{/* Keep everything tldraw normally shows. Remove this to REPLACE the menu. */}
			<DefaultMainMenuContent />
		</DefaultMainMenu>
	)
}

/** Drop a token in the middle of the current viewport. */
function addTokenAtCenter(editor: Editor) {
	const center = editor.getViewportPageBounds().center
	editor.createShape({
		id: createShapeId(),
		type: 'token',
		x: center.x - 24,
		y: center.y - 24,
		// props are optional — getDefaultProps() fills the rest.
	})
}

/** Delete every shape on the current page. */
function clearBoard(editor: Editor) {
	const ids = Array.from(editor.getCurrentPageShapeIds())
	if (ids.length) editor.deleteShapes(ids)
}

/**
 * The components map handed to <Tldraw components={gameComponents}>. Add more
 * keys (ContextMenu, Toolbar, StylePanel, ...) here to customize other UI.
 */
export const gameComponents: TLComponents = {
	MainMenu: GameMainMenu,
}
