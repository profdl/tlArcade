/**
 * rig-play — shared rig-AUTHORING state (draw-bones editor).
 *
 * The RigTool (a StateNode, writes bones) and the RigOverlay (InFrontOfTheCanvas,
 * renders them) live in different tldraw layers and can't pass props, so they share
 * atoms. Holds the editable DRAFT rig (bones as pivot→tip segments in ENTITY-LOCAL
 * space) plus the character being rigged. Cleared when Rig mode exits.
 *
 * Copied from the Engine demo's game/rig/state.ts and namespaced `rigplay:` so the
 * two demos never share localStorage-visible atom ids (the shell CLAUDE.md rule).
 */
import { atom } from 'tldraw'
import type { Editor, TLShapeId } from 'tldraw'
import type { DraftRig } from '../rig/authoring'
import { isCharacterMarked } from '../game/body'

/** True while the Rig tool is active (drives the overlay + panel visibility). */
export const rigModeAtom = atom('rigplay:rigMode', false)

/** The character (figure/group) being rigged, or null. */
export const rigTargetAtom = atom<TLShapeId | null>('rigplay:rigTarget', null)

/** The editable draft rig. Entity-local coords, relative to the target's bounds. */
export const draftRigAtom = atom<DraftRig>('rigplay:draftRig', { bones: [] })

/** The in-progress bone being dragged (rubber-band), entity-local, or null. */
export const dragBoneAtom = atom<{ pivot: { x: number; y: number }; tip: { x: number; y: number } } | null>(
  'rigplay:dragBone',
  null,
)

/** A monotonic counter to name new draft bones without Date.now()/random. */
export const boneCounterAtom = atom('rigplay:boneCounter', 0)

/**
 * Enter Rig mode on a character: target the marked character, else the current
 * selection's first shape. Starts a fresh draft and switches to the bone tool. Shared
 * by the toolbar's "Rig" button. No-op if there's nothing to rig.
 */
export function enterRigMode(editor: Editor) {
  const character = editor.getCurrentPageShapes().find((s) => isCharacterMarked(s))
  const target = character?.id ?? editor.getSelectedShapeIds()[0]
  if (!target) return
  rigTargetAtom.set(target)
  draftRigAtom.set({ bones: [] })
  boneCounterAtom.set(0)
  rigModeAtom.set(true)
  editor.selectNone()
  editor.setCurrentTool('rig')
}
