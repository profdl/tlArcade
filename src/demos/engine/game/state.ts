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
 *  - `gameStateAtom` — the live GameState the runtime emits (status, collected,
 *    lives, score, timer). The HUD reads it so the on-screen overlay stays in sync
 *    without threading props through the components object.
 */
import { atom } from 'tldraw'
import { makeTunables, type PhysicsTunables } from './physics'
// TYPE-only import: pulls in GameState's shape at compile time with no runtime
// module, so importing engine.ts here can't create a require/import cycle.
import type { GameState } from './engine'

export const playingAtom = atom('engine:playing', false)

/** The live, editable physics tunables (seeded from the "tight & snappy" defaults). */
export const tunablesAtom = atom<PhysicsTunables>('engine:tunables', makeTunables())

/** The live GameState the runtime emits; the HUD renders it (see render/Hud.tsx). */
export const gameStateAtom = atom<GameState>('engine:gameState', {
  status: 'playing',
  collected: 0,
  total: 0,
  deaths: 0,
  lives: 3,
  score: 0,
  timeMs: 0,
})

/**
 * Bridge for the "New from template" MainMenu item (a native slot component with
 * stable identity, so it can't take props). App registers a loader on mount; the
 * menu item calls it. Same "components read a module-level thing, not props"
 * discipline as the atoms above — just a callback instead of a value.
 */
export const templateBridge: { load: ((templateKey: string) => void) | null } = { load: null }
