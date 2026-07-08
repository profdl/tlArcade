// Shared gameplay atoms for ant-mover. Module-level (like sonic/toolkit) so the
// `components` object in App stays referentially stable — threading these through
// props would remount the overlay and reset the sim/interpolation mid-run. App
// mirrors them with useValue; the overlay reads/writes them in its rAF loop.

import { atom } from 'tldraw'
import type { Pose } from './sim'

/** Whether the sim is running (stepping). Step 1 renders a static pose; step 2
 * wires this to a Play toggle. */
export const playingAtom = atom<boolean>('am-playing', false)

/** The latest T pose the overlay should draw (page space). In step 1 this is the
 * static spawn pose; from step 2 the local sim writes it each frame; from step 5
 * the network broadcast writes it. Single choke point for "where is the T". */
export const tPoseAtom = atom<Pose>('am-tPose', { x: 0, y: 0, angle: 0 })

/** Bumped to force a fresh sim (Reset). */
export const resetNonceAtom = atom<number>('am-resetNonce', 0)

/** Dev-only: number of SCRIPTED grabbers (bots) pulling the T toward the exit, so
 * a crowd sim can run with no humans. 0 = off. Lets us watch how N pullers shove
 * one body around long before N real players exist (plan step 2 / step 7 proxy). */
export const scriptedCountAtom = atom<number>('am-scripted', 0)
