/**
 * Engine — the selection contextual toolbar ("Set as Player" + "Rig").
 *
 * Adapted from tldraw's official "Contextual toolbar" example: ONE
 * `TldrawUiContextualToolbar` (mounted via components.InFrontOfTheCanvas) floating
 * above the current selection. It is the single selection toolbar (PLAN §7.5's
 * role-aware `ElementToolbar`) — every per-selection action lives here so the
 * toolbars never stack. Today: "Set as Player" (mark the selection as the player;
 * game/player.ts → markAsPlayer) and "Rig" (enter bone-drawing rig mode on the
 * character; game/rig/state.ts → enterRigMode).
 *
 * Shows only when idle-selecting with a selection, and hides during play
 * (playingAtom) and while in rig mode (rigModeAtom, which has its own overlay).
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
import { enterRigMode, rigModeAtom } from '../game/rig/state'

export function PlayerToolbar() {
  const editor = useEditor()

  // Idle-selecting with a selection; never during play or rig mode.
  const show = useValue(
    'show selection toolbar',
    () =>
      !playingAtom.get() &&
      !rigModeAtom.get() &&
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
    <TldrawUiContextualToolbar label="Selection" getSelectionBounds={getSelectionBounds}>
      <TldrawUiToolbarButton
        type="tool"
        className="eng-player-btn"
        title="Make the selected shapes the player"
        onClick={() => markAsPlayer(editor, editor.getSelectedShapeIds())}
      >
        Set as Player
      </TldrawUiToolbarButton>
      <TldrawUiToolbarButton
        type="tool"
        title="Draw a skeleton on this character"
        onClick={() => enterRigMode(editor)}
      >
        Rig
      </TldrawUiToolbarButton>
    </TldrawUiContextualToolbar>
  )
}
