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
	DefaultContextMenu,
	DefaultContextMenuContent,
	DefaultMainMenu,
	DefaultMainMenuContent,
	Editor,
	TLComponents,
	TldrawUiMenuGroup,
	TldrawUiMenuItem,
	useEditor,
	useValue,
} from 'tldraw'
import { CardShape } from '../shapes/CardShape'
import { DieShape } from '../shapes/DieShape'
import { useReferee } from '../referee/useReferee'

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

// ── CONTEXT MENU: per-shape game actions (SPEC §6.2) ─────────────────────────
// Built as a factory because the referee call needs the roomId. The "Roll"
// action only appears when a single die is selected.
function makeGameContextMenu(roomId: string | undefined) {
	return function GameContextMenu() {
		const editor = useEditor()
		const sendToReferee = useReferee(roomId)

		// Reactively read the single selected game shape, if any.
		const selected = useValue(
			'selectedGameShape',
			() => editor.getOnlySelectedShape(),
			[editor]
		)
		const selectedDie = selected?.type === 'die' ? (selected as DieShape) : null
		const selectedCard = selected?.type === 'card' ? (selected as CardShape) : null

		return (
			<DefaultContextMenu>
				{(selectedDie || selectedCard) && (
					<TldrawUiMenuGroup id="game">
						{selectedDie && (
							<TldrawUiMenuItem
								id="roll-die"
								label="Roll"
								icon="undo"
								readonlyOk={false}
								onSelect={() => rollDie(editor, selectedDie, sendToReferee)}
							/>
						)}
						{selectedCard?.props.secretRef && (
							<TldrawUiMenuItem
								id="reveal-card"
								label="Reveal to table"
								icon="external-link"
								readonlyOk={false}
								onSelect={() => {
								void sendToReferee({ action: 'reveal', cardId: selectedCard.id, to: 'table' })
							}}
							/>
						)}
					</TldrawUiMenuGroup>
				)}
				<DefaultContextMenuContent />
			</DefaultContextMenu>
		)
	}
}

/** Optimistically spin, ask the referee for the authoritative value; the result
 *  lands via store sync (the referee writes value + rolling:false). */
async function rollDie(
	editor: Editor,
	die: DieShape,
	sendToReferee: ReturnType<typeof useReferee>
) {
	editor.updateShape<DieShape>({ id: die.id, type: 'die', props: { rolling: true } })
	const res = await sendToReferee({ action: 'roll', dieId: die.id })
	// On failure, clear the local spin (success arrives through sync).
	if (!res.ok) {
		editor.updateShape<DieShape>({ id: die.id, type: 'die', props: { rolling: false } })
	}
}

/**
 * Build the components map handed to <Tldraw components={...}>. A factory because
 * referee-backed actions need the roomId. Add more keys (Toolbar, StylePanel,
 * ...) here to customize other UI.
 */
export function createGameComponents(roomId: string | undefined): TLComponents {
	return {
		MainMenu: GameMainMenu,
		ContextMenu: makeGameContextMenu(roomId),
	}
}
