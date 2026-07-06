/**
 * Engine — the "Set as Player" contextual toolbar.
 *
 * Adapted from tldraw's official "Contextual toolbar" example: a
 * `TldrawUiContextualToolbar` (mounted via components.InFrontOfTheCanvas) that
 * floats above the current selection and positions itself from the selection's
 * screen bounds. It shows a single action — make the selected shapes the player
 * (groups them if >1, marks the group; see game/player.ts → markAsPlayer).
 *
 * It appears only when the editor is idle in the select tool with something
 * selected, and hides entirely while a game is running (game/state.ts →
 * playingAtom). Replaces the old tray button.
 */
import {
  Box,
  TldrawUiContextualToolbar,
  TldrawUiToolbarButton,
  useEditor,
  useValue,
} from 'tldraw'
import { markAsPlayer } from '../game/player'
import { playingAtom } from '../game/state'

export function PlayerToolbar() {
  const editor = useEditor()

  // Show only when idle-selecting with a selection, and never during play.
  const show = useValue(
    'show player toolbar',
    () =>
      !playingAtom.get() &&
      editor.isIn('select.idle') &&
      editor.getSelectedShapeIds().length > 0,
    [editor],
  )

  if (!show) return null

  // Position the toolbar over the top edge of the selection (height 0 so the
  // primitive places it just above). Screen bounds track camera + scroll.
  const getSelectionBounds = () => {
    const bounds = editor.getSelectionRotatedScreenBounds()
    if (!bounds) return undefined
    return new Box(bounds.x, bounds.y, bounds.width, 0)
  }

  return (
    <TldrawUiContextualToolbar label="Player" getSelectionBounds={getSelectionBounds}>
      <TldrawUiToolbarButton
        type="tool"
        className="eng-player-btn"
        title="Make the selected shapes the player"
        onClick={() => markAsPlayer(editor, editor.getSelectedShapeIds())}
      >
        Set as Player
      </TldrawUiToolbarButton>
    </TldrawUiContextualToolbar>
  )
}
