/**
 * Engine — shared gameplay state.
 *
 * The tray and the physics panel live inside tldraw
 * (components.InFrontOfTheCanvas), so they can't take props from App without
 * breaking the components object's referential stability (see App.tsx). They read
 * atoms instead:
 *  - `playingAtom` — App sets it on Play/Stop; the tray hides itself while a game
 *    runs, and the physics panel shows only then.
 *  - `tunablesAtom` — the LIVE physics values. The runtime reads this atom every
 *    substep (so edits apply mid-play), and the panel writes to it. It's the
 *    single live-editable copy of the tuning; App resets it to defaults on mount.
 */
import { atom } from 'tldraw'
import { makeTunables, type PhysicsTunables } from './physics'

export const playingAtom = atom('engine:playing', false)

/** The live, editable physics tunables (seeded from the "tight & snappy" defaults). */
export const tunablesAtom = atom<PhysicsTunables>('engine:tunables', makeTunables())
