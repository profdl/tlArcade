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
import type {
	Editor,
	TLComponents,
	TLUiStylePanelProps} from 'tldraw';
import {
	createShapeId,
	DefaultContextMenu,
	DefaultContextMenuContent,
	DefaultMainMenu,
	DefaultMainMenuContent,
	DefaultStylePanel,
	DefaultStylePanelContent,
	StylePanelDropdownPicker,
	TldrawUiMenuGroup,
	TldrawUiMenuItem,
	TldrawUiMenuSubmenu,
	useEditor,
	useRelevantStyles,
	useStylePanelContext,
	useValue,
} from 'tldraw'
import type { CardShape } from '../shapes/CardShape'
import type { ContainerShape } from '../shapes/ContainerShape'
import type { DieShape } from '../shapes/DieShape'
import { CreatureKindStyle, CREATURE_KINDS } from 'shared/shape-schemas'
import { creatureKindIcon } from '../creature/variants'
import { useReferee } from '../referee/useReferee'
import { runCreatureStressTest, runSwimOptStressTest } from '../creature/stressTest'
import { runShapeStressTest } from '../shapes/shapeStressTest'
import { SwimDebugOverlay } from '../creature/SwimDebugOverlay'
import { setSwimDebug, swimDebugEnabled } from '../creature/registerSwimming'
import { generateTank, generateChaosTank } from '../wfc/generateTank'

function GameMainMenu() {
	// `useEditor()` is how a UI component reaches the editor. Close over it in the
	// onSelect handlers below.
	const editor = useEditor()

	return (
		<DefaultMainMenu>
			{/* Our items live in their own group so they don't collide with tldraw's. */}
			<TldrawUiMenuGroup id="game-toolkit">
				{/* All shape-spawning actions live in one submenu so the top-level menu
				    stays short. Add a new shape's "Add X" item here. */}
				<TldrawUiMenuSubmenu id="add-shape" label="Add shape">
					<TldrawUiMenuGroup id="add-shape-items">
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
							id="add-bloom"
							label="Add bloom"
							icon="plus"
							readonlyOk={false}
							onSelect={() => addAtCenter(editor, 'bloom', 110)}
						/>
						<TldrawUiMenuItem
							id="add-hydra"
							label="Add hydra"
							icon="plus"
							readonlyOk={false}
							onSelect={() => addAtCenter(editor, 'hydra', 110)}
						/>
						<TldrawUiMenuItem
							id="add-frond"
							label="Add frond"
							icon="plus"
							readonlyOk={false}
							onSelect={() => addAtCenter(editor, 'frond', 110)}
						/>
						<TldrawUiMenuItem
							id="add-plume"
							label="Add plume"
							icon="plus"
							readonlyOk={false}
							onSelect={() => addAtCenter(editor, 'plume', 120, 150)}
						/>
						<TldrawUiMenuItem
							id="add-ribbon"
							label="Add ribbon"
							icon="plus"
							readonlyOk={false}
							onSelect={() => addAtCenter(editor, 'ribbon', 120)}
						/>
						<TldrawUiMenuItem
							id="add-canvas-snake"
							label="Add snake (roams the view)"
							icon="plus"
							readonlyOk={false}
							onSelect={() => addAtCenter(editor, 'canvasSnake', 130, 60)}
						/>
						<TldrawUiMenuItem
							id="add-line-fish"
							label="Add line fish (centreline per segment)"
							icon="plus"
							readonlyOk={false}
							onSelect={() => addAtCenter(editor, 'creature', 60, 32, { kind: 'lineFish' })}
						/>
						<TldrawUiMenuItem
							id="add-spider"
							label="Add spider"
							icon="plus"
							readonlyOk={false}
							onSelect={() => addAtCenter(editor, 'spider', 100)}
						/>
						<TldrawUiMenuItem
							id="add-spider-blobs"
							label="Add spider (blobs, 1-stroke)"
							icon="plus"
							readonlyOk={false}
							onSelect={() => addAtCenter(editor, 'spiderBlobs', 100)}
						/>
						<TldrawUiMenuItem
							id="add-spider-oval"
							label="Add spider (oval, 1-stroke)"
							icon="plus"
							readonlyOk={false}
							onSelect={() => addAtCenter(editor, 'spiderOval', 100)}
						/>
					</TldrawUiMenuGroup>
				</TldrawUiMenuSubmenu>
				{/* WFC FISHTANK GENERATOR: collapse a fresh grid of rooms joined by 10%-overlap
				    doorways (solid orange) with green food in the reachable region, written as
				    plain synced geo shapes — so every client sees it and can drop creatures in.
				    A new seed each click (Date.now()), so it's a different tank every time. */}
				<TldrawUiMenuItem
					id="generate-tank"
					label="Generate fish tank (WFC)"
					icon="plus"
					readonlyOk={false}
					onSelect={() => {
						generateTank(editor)
					}}
				/>
				{/* CHAOS variant: same reachable topology, but varied native geo shapes at random
				    scales/colours, jittered off-grid, with deep 50%-overlap doorways. */}
				<TldrawUiMenuItem
					id="generate-tank-chaos"
					label="Generate fish tank (chaos)"
					icon="plus"
					readonlyOk={false}
					onSelect={() => {
						generateChaosTank(editor)
					}}
				/>
				<TldrawUiMenuItem
					id="reset-board"
					label="Clear board"
					icon="trash"
					readonlyOk={false}
					onSelect={() => clearBoard(editor)}
				/>
				{/* DEV-only debug tooling (stress tests + swim overlay) collected in one
				    submenu so it stays out of the way. Each stress test ramps a shape and
				    logs real FPS to the console; remove these + the stressTest helpers
				    when done. */}
				{import.meta.env.DEV && (
					<TldrawUiMenuSubmenu id="debug-tools" label="Debug tools">
						<TldrawUiMenuGroup id="debug-tools-items">
							<TldrawUiMenuItem
								id="stress-creatures"
								label="Stress test (creature-fish in tank → console)"
								icon="dots-horizontal"
								readonlyOk={false}
								onSelect={() => void runCreatureStressTest(editor, 'fish')}
							/>
							<TldrawUiMenuItem
								id="stress-line-fish"
								label="Stress test (line-fish in tank → console)"
								icon="dots-horizontal"
								readonlyOk={false}
								onSelect={() => void runCreatureStressTest(editor, 'lineFish')}
							/>
							<TldrawUiMenuItem
								id="stress-ink-fish"
								label="Stress test (ink-fish in tank → console)"
								icon="dots-horizontal"
								readonlyOk={false}
								onSelect={() => void runCreatureStressTest(editor, 'inkFish')}
							/>
							<TldrawUiMenuItem
								id="stress-swim-opts"
								label="Stress test (swim opts A/B/C → console)"
								icon="dots-horizontal"
								readonlyOk={false}
								onSelect={() => void runSwimOptStressTest(editor, 'fish')}
							/>
							<TldrawUiMenuItem
								id="stress-blooms"
								label="Stress test (blooms → console)"
								icon="dots-horizontal"
								readonlyOk={false}
								onSelect={() => void runShapeStressTest(editor, 'bloom', [5, 10, 20, 40, 60, 100, 150, 250])}
							/>
							<TldrawUiMenuItem
								id="stress-hydras"
								label="Stress test (hydras → console)"
								icon="dots-horizontal"
								readonlyOk={false}
								onSelect={() => void runShapeStressTest(editor, 'hydra')}
							/>
							<TldrawUiMenuItem
								id="stress-fronds"
								label="Stress test (fronds → console)"
								icon="dots-horizontal"
								readonlyOk={false}
								onSelect={() => void runShapeStressTest(editor, 'frond')}
							/>
							<TldrawUiMenuItem
								id="stress-plumes"
								label="Stress test (plumes → console)"
								icon="dots-horizontal"
								readonlyOk={false}
								onSelect={() => void runShapeStressTest(editor, 'plume')}
							/>
							<TldrawUiMenuItem
								id="stress-ribbons"
								label="Stress test (ribbons → console)"
								icon="dots-horizontal"
								readonlyOk={false}
								onSelect={() => void runShapeStressTest(editor, 'ribbon')}
							/>
							{/* Three spider designs, same harness/tiers → directly comparable:
							    `spider` = one <path> ELEMENT, 10 sub-paths (baseline);
							    `spiderBlobs` = ONE continuous stroke, two blobs + retraced legs;
							    `spiderOval` = ONE continuous stroke, oval body + legs off the rim. */}
							<TldrawUiMenuItem
								id="stress-spiders"
								label="Stress test (spider: sub-paths → console)"
								icon="dots-horizontal"
								readonlyOk={false}
								onSelect={() => void runShapeStressTest(editor, 'spider')}
							/>
							<TldrawUiMenuItem
								id="stress-spider-blobs"
								label="Stress test (spider blobs: 1-stroke → console)"
								icon="dots-horizontal"
								readonlyOk={false}
								onSelect={() => void runShapeStressTest(editor, 'spiderBlobs')}
							/>
							<TldrawUiMenuItem
								id="stress-spider-oval"
								label="Stress test (spider oval: 1-stroke → console)"
								icon="dots-horizontal"
								readonlyOk={false}
								onSelect={() => void runShapeStressTest(editor, 'spiderOval')}
							/>
							<SwimDebugMenuItem />
						</TldrawUiMenuGroup>
					</TldrawUiMenuSubmenu>
				)}
			</TldrawUiMenuGroup>

			{/* Keep everything tldraw normally shows. Remove this to REPLACE the menu. */}
			<DefaultMainMenuContent />
		</DefaultMainMenu>
	)
}

/**
 * DEV menu item that toggles the swim debug overlay. Reads swimDebugEnabled
 * reactively so its label reflects the current state (and stays in sync if the
 * overlay is flipped from the console via window.__SWIM_DEBUG → setSwimDebug).
 */
function SwimDebugMenuItem() {
	const on = useValue('swimDebugEnabled', () => swimDebugEnabled.get(), [])
	return (
		<TldrawUiMenuItem
			id="swim-debug"
			label={on ? 'Swim debug: ON' : 'Swim debug: off'}
			icon={on ? 'toggle-on' : 'toggle-off'}
			readonlyOk
			onSelect={() => setSwimDebug(!swimDebugEnabled.get())}
		/>
	)
}

/** Drop a shape of `type` centred in the viewport (props default via getDefaultProps). */
function addAtCenter(
	editor: Editor,
	type: 'token' | 'container' | 'grid' | 'creature' | 'bloom' | 'hydra' | 'frond' | 'plume' | 'ribbon' | 'spider' | 'spiderBlobs' | 'spiderOval' | 'canvasSnake',
	halfW: number,
	halfH = halfW,
	props?: Record<string, unknown>
) {
	const center = editor.getViewportPageBounds().center
	const id = createShapeId()
	editor.createShape({ id, type, x: center.x - halfW, y: center.y - halfH, props })
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
		// DEV food-attraction visualization; renders nothing unless toggled on.
		InFrontOfTheCanvas: SwimDebugOverlay,
	}
}
