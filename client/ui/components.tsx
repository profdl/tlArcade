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
	DefaultStylePanel,
	DefaultStylePanelContent,
	Editor,
	StylePanelDropdownPicker,
	TLComponents,
	TLUiStylePanelProps,
	TldrawUiMenuGroup,
	TldrawUiMenuItem,
	useEditor,
	useRelevantStyles,
	useStylePanelContext,
	useValue,
} from 'tldraw'
import { CardShape } from '../shapes/CardShape'
import { ContainerShape } from '../shapes/ContainerShape'
import { DieShape } from '../shapes/DieShape'
import { CreatureKindStyle, CREATURE_KINDS } from '../../shared/shape-schemas'
import { creatureKindIcon } from '../creature/variants'
import { useReferee } from '../referee/useReferee'
import { runCreatureStressTest } from '../creature/stressTest'

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
					onSelect={() => addAtCenter(editor, 'token', 24)}
				/>
				<TldrawUiMenuItem
					id="add-container"
					label="Add container"
					icon="plus"
					readonlyOk={false}
					onSelect={() => addAtCenter(editor, 'container', 130, 80)}
				/>
				<TldrawUiMenuItem
					id="add-grid"
					label="Add grid"
					icon="plus"
					readonlyOk={false}
					onSelect={() => addAtCenter(editor, 'grid', 200)}
				/>
				<TldrawUiMenuItem
					id="add-creature"
					label="Add creature"
					icon="plus"
					readonlyOk={false}
					onSelect={() => addAtCenter(editor, 'creature', 60, 32)}
				/>
				<TldrawUiMenuItem
					id="reset-board"
					label="Clear board"
					icon="trash"
					readonlyOk={false}
					onSelect={() => clearBoard(editor)}
				/>
				{/* TEMP dev-only: ramps creatures and logs real FPS to the console.
				    Remove this item + client/creature/stressTest.ts when done. */}
				{import.meta.env.DEV && (
					<TldrawUiMenuItem
						id="stress-creatures"
						label="Stress test (creatures → console)"
						icon="dots-horizontal"
						readonlyOk={false}
						onSelect={() => void runCreatureStressTest(editor)}
					/>
				)}
			</TldrawUiMenuGroup>

			{/* Keep everything tldraw normally shows. Remove this to REPLACE the menu. */}
			<DefaultMainMenuContent />
		</DefaultMainMenu>
	)
}

/** Drop a shape of `type` centred in the viewport (props default via getDefaultProps). */
function addAtCenter(editor: Editor, type: 'token' | 'container' | 'grid' | 'creature', halfW: number, halfH = halfW) {
	const center = editor.getViewportPageBounds().center
	const id = createShapeId()
	editor.createShape({ id, type, x: center.x - halfW, y: center.y - halfH })
	// A grid is a backdrop — keep it beneath the pieces.
	if (type === 'grid') editor.sendToBack([id])
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
		const selectedContainer = selected?.type === 'container' ? (selected as ContainerShape) : null
		const deck = selectedContainer && selectedContainer.props.count > 0 ? selectedContainer : null

		return (
			<DefaultContextMenu>
				{(selectedDie || selectedCard || deck) && (
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
						{deck && (
							<>
								<TldrawUiMenuItem
									id="shuffle-deck"
									label="Shuffle"
									icon="undo"
									readonlyOk={false}
									onSelect={() => {
										void sendToReferee({ action: 'shuffle', containerId: deck.id })
									}}
								/>
								<TldrawUiMenuItem
									id="draw-card"
									label="Draw to table"
									icon="external-link"
									readonlyOk={false}
									onSelect={() => drawFromDeck(editor, deck, sendToReferee)}
								/>
							</>
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
 * Draw the top card from a deck to the table. The CLIENT creates the empty card
 * (it owns placement/indexes); the REFEREE decides which hidden value lands on
 * it (and decrements the deck's public count). See SPEC §5.5.
 */
async function drawFromDeck(
	editor: Editor,
	deck: ContainerShape,
	sendToReferee: ReturnType<typeof useReferee>
) {
	const bounds = editor.getShapePageBounds(deck.id)
	const cardId = createShapeId()
	editor.createShape<CardShape>({
		id: cardId,
		type: 'card',
		x: (bounds?.maxX ?? deck.x) + 16,
		y: bounds?.y ?? deck.y,
	})
	const res = await sendToReferee({
		action: 'draw',
		containerId: deck.id,
		cardId,
		to: 'table',
	})
	// If the deck was empty / the draw failed, remove the placeholder card.
	if (!res.ok) editor.deleteShape(cardId)
}

// ── STYLE PANEL: a creature-kind picker, reusing tldraw's own geo-shape picker ──
// tldraw's built-in geo shape shows a grid-of-icons popover ("Shape") in the style
// panel to switch rectangle↔ellipse↔… We reuse the EXACT same control for creatures:
// StylePanelDropdownPicker driven by our CreatureKindStyle StyleProp, with one icon
// per kind. It reads the selected styles from the panel context and auto-hides when
// no creature is selected (returns null) — identical to StylePanelGeoShapePicker.
function StylePanelCreatureKindPicker() {
	const { styles } = useStylePanelContext()
	const kind = styles.get(CreatureKindStyle)
	if (kind === undefined) return null // no creature selected → nothing to show
	const items = CREATURE_KINDS.map((value) => ({ value, icon: creatureKindIcon(value) }))
	return (
		<StylePanelDropdownPicker
			id="creature-kind"
			label="Creature"
			type="menu"
			uiType="creature-kind"
			stylePanelType="creature-kind"
			style={CreatureKindStyle}
			items={items}
			value={kind}
		/>
	)
}

// The full style panel: tldraw's default content + our creature picker appended.
// Passing children to DefaultStylePanel renders them inside its style context
// provider (so the picker's useStylePanelContext works), in place of the default.
function GameStylePanel(props: TLUiStylePanelProps) {
	const styles = useRelevantStyles()
	return (
		<DefaultStylePanel {...props} styles={styles}>
			<DefaultStylePanelContent />
			<StylePanelCreatureKindPicker />
		</DefaultStylePanel>
	)
}

/**
 * Build the components map handed to <Tldraw components={...}>. A factory because
 * referee-backed actions need the roomId. Add more keys (Toolbar, ...) here to
 * customize other UI.
 */
export function createGameComponents(roomId: string | undefined): TLComponents {
	return {
		MainMenu: GameMainMenu,
		ContextMenu: makeGameContextMenu(roomId),
		StylePanel: GameStylePanel,
	}
}
