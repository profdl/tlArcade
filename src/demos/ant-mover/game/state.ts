// Shared gameplay atoms for ant-mover. Module-level (like sonic/toolkit) so the
// `components` object in App stays referentially stable — threading these through
// props would remount the overlay and reset the sim/interpolation mid-run. App
// mirrors them with useValue; the overlay reads/writes them in its rAF loop.

import { atom } from 'tldraw'
import type { Pose, ObjectShape } from './sim'

/** Whether the sim is running (author mode when false; sim mode when true). */
export const playingAtom = atom<boolean>('am-playing', false)

/** The latest object pose the overlay should draw (page space). The local sim
 * writes it each frame (step 3a); from step 5 the network broadcast writes it.
 * Single choke point for "where is the object". */
export const objPoseAtom = atom<Pose>('am-objPose', { x: 0, y: 0, angle: 0 })

/** The object's local convex pieces + spawn, published when a run starts so the
 * overlay can draw the posed body. Null when no run is active (author mode) or
 * no object is designated. */
export const objShapeAtom = atom<ObjectShape | null>('am-objShape', null)

/** Bumped to force a fresh sim (Reset). */
export const resetNonceAtom = atom<number>('am-resetNonce', 0)

/** Dev-only: number of SCRIPTED grabbers (bots) pulling the object toward the
 * exit, so a crowd sim can run with no humans. 0 = off. Lets us watch how N
 * pullers shove one body around long before N real players exist. */
export const scriptedCountAtom = atom<number>('am-scripted', 0)

/** A rope to draw: from the grabbed point ON the object (page px, so it tracks
 * the object's motion/rotation) to the puller's cursor (page px). `human` flags
 * the local player's own rope for a distinct color. */
export interface RopeView {
	anchor: { x: number; y: number }
	cursor: { x: number; y: number }
	human: boolean
}

/** The active ropes to render this frame. Written by the sim loop, read by
 * Field. In step 5 the broadcast fills this so remote players' ropes draw too. */
export const ropesAtom = atom<RopeView[]>('am-ropes', [])
