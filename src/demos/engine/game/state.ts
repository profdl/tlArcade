/**
 * Engine — shared gameplay state.
 *
 * The tray lives inside tldraw (components.InFrontOfTheCanvas), so it can't take
 * props from App without breaking the components object's referential stability
 * (see App.tsx). It reads `playingAtom` instead — App sets it on Play/Stop, the
 * tray hides itself while a game is running.
 */
import { atom } from 'tldraw'

export const playingAtom = atom('engine:playing', false)
