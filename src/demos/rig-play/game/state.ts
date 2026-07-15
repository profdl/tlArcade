/**
 * rig-play — shared play/UI atoms.
 *
 * The toolbar, overlay, and runtime live in different tldraw layers / outside React
 * context and can't pass props, so they share atoms (the same pattern as the Engine
 * demo's game/state.ts). Namespaced `rigplay:` so they never collide with another
 * demo's atoms in the switcher.
 */
import { atom } from 'tldraw'

/** True while the character is being driven (Play). The toolbar/overlay read it. */
export const playingAtom = atom('rigplay:playing', false)

/**
 * DEBUG: the character's live skeleton during play — each bone as a PAGE-space
 * pivot→tip segment, set by the runtime each frame when `showRigDebugAtom` is on. The
 * overlay draws it so you can SEE the rig evaluating. Null when not playing / no rig.
 */
export const rigDebugAtom = atom<
  { bones: { pivot: { x: number; y: number }; tip: { x: number; y: number } }[] } | null
>('rigplay:rigDebug', null)

/** Toggle the play-time skeleton overlay (debug). Off by default so the figure shows clean. */
export const showRigDebugAtom = atom('rigplay:showRigDebug', false)

/** Which leg animation mode the walk uses (IK bends the knee; straight keeps it inline). */
export const legModeAtom = atom<'straight' | 'ik'>('rigplay:legMode', 'ik')
