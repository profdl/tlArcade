// Shared gameplay atoms for ant-mover. Module-level (like sonic/toolkit) so the
// `components` object in App stays referentially stable — threading these through
// props would remount the overlay and reset the sim/interpolation mid-run. App
// mirrors them with useValue; the overlay reads/writes them in its rAF loop.

import { atom } from 'tldraw'
import type { Pose, ObjectShape } from './sim'

/** Whether the sim is running (author mode when false; sim mode when true). In
 * multiplayer this is SERVER-authoritative: the network broadcast (netPose) sets
 * it so every client enters/leaves sim-mode together. The panel expresses a
 * *request* to play/stop via playIntentAtom (below), not by writing this directly. */
export const playingAtom = atom<boolean>('am-playing', false)

/** The local player's play/stop REQUEST (author mode toggle). The panel bumps this;
 * RunController (inside the editor context, owner of the input socket) reacts —
 * computing the WorldSpec and sending {start}/{stop} to the server. The actual
 * playing state comes back over the network into playingAtom. `null` = no pending
 * request. */
export const playIntentAtom = atom<'start' | 'stop' | null>('am-playIntent', null)

/** The latest object pose the overlay should draw (page space). The local sim
 * writes it each frame (step 3a); from step 5 the network broadcast writes it.
 * Single choke point for "where is the object". */
export const objPoseAtom = atom<Pose>('am-objPose', { x: 0, y: 0, angle: 0 })

/** The object's local convex pieces + spawn, published when a run starts so the
 * overlay can draw the posed body. Null when no run is active (author mode) or
 * no object is designated. */
export const objShapeAtom = atom<ObjectShape | null>('am-objShape', null)

/** A rope to draw: from the grabbed point ON the object (page px, so it tracks
 * the object's motion/rotation) to the puller's cursor (page px). `human` flags
 * the local player's own rope for a distinct color. */
export interface RopeView {
	anchor: { x: number; y: number }
	cursor: { x: number; y: number }
	human: boolean
}

/** The active ropes to render this frame. Filled by the network broadcast
 * (netPose) — the DO sends one rope per active grab; remote players' ropes draw
 * too, the local player's flagged `human`. Read by Field. */
export const ropesAtom = atom<RopeView[]>('am-ropes', [])
