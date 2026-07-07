/**
 * Engine — shared rig-authoring state (R1 redesign).
 *
 * The RigTool (a StateNode, writes bones) and the RigOverlay
 * (InFrontOfTheCanvas, renders them) live in different tldraw layers and can't pass
 * props, so they share an atom — the same pattern as game/state.ts. Holds the
 * editable DRAFT rig (bones as pivot→tip segments in ENTITY-LOCAL space) plus the
 * character being rigged. Cleared when Rig mode exits.
 */
import { atom } from 'tldraw'
import type { Editor, TLShapeId } from 'tldraw'
import type { DraftRig } from './authoring'
import { isPlayerMarked } from '../player'

/** True while the Rig tool is active (drives the overlay + panel visibility). */
export const rigModeAtom = atom('engine:rigMode', false)

/** The character (player group / figure) being rigged, or null. */
export const rigTargetAtom = atom<TLShapeId | null>('engine:rigTarget', null)

/** The editable draft rig. Entity-local coords, relative to the target's bounds. */
export const draftRigAtom = atom<DraftRig>('engine:draftRig', { bones: [] })

/** The in-progress bone being dragged (rubber-band), entity-local, or null. */
export const dragBoneAtom = atom<{ pivot: { x: number; y: number }; tip: { x: number; y: number } } | null>(
  'engine:dragBone',
  null,
)

/**
 * DEBUG: the player's live skeleton during play — each bone as a PAGE-space
 * pivot→tip segment, set by the runtime each frame (game/engine.ts) when
 * `showRigDebugAtom` is on. The overlay draws it so you can SEE the rig evaluating.
 * Null when not playing / no rig.
 */
export const rigDebugAtom = atom<
  { bones: { pivot: { x: number; y: number }; tip: { x: number; y: number } }[] } | null
>('engine:rigDebug', null)

/** Toggle the play-time skeleton overlay (debug). */
export const showRigDebugAtom = atom('engine:showRigDebug', true)

/** A monotonic counter to name new draft bones without Date.now()/random. */
export const boneCounterAtom = atom('engine:boneCounter', 0)

/**
 * Enter Rig mode on a character: target the marked player, else the current
 * selection's first shape. Starts a fresh draft and switches to the bone tool.
 * Shared by the selection toolbar (the "Rig" button) — kept here so the toolbar
 * doesn't import the overlay. No-op if there's nothing to rig.
 */
export function enterRigMode(editor: Editor) {
  const player = editor.getCurrentPageShapes().find((s) => isPlayerMarked(s))
  const target = player?.id ?? editor.getSelectedShapeIds()[0]
  if (!target) return
  rigTargetAtom.set(target)
  draftRigAtom.set({ bones: [] })
  boneCounterAtom.set(0)
  rigModeAtom.set(true)
  editor.selectNone()
  editor.setCurrentTool('rig')
}
