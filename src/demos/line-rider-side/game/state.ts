// Shared gameplay state, held in tldraw atoms rather than React state.
//
// Why atoms and not props/React state: the rider overlay is mounted through
// <Tldraw>'s `components.InFrontOfTheCanvas`. tldraw remounts a slot whenever the
// `components` object identity changes, so that object must stay stable. If the
// volatile gameplay values (play/pause, follow, start point, live stats) rode in
// React state and threaded through `components`, every change would mint a new
// object and remount the rider — tearing down its rAF loop and snapping the sled
// to the start mid-ride. Routing them through atoms lets the App pass a constant
// `components` object: the rider reads inputs and writes outputs via these atoms,
// and the panel mirrors them reactively with useValue.

import { atom } from 'tldraw'
import type { Vec2 } from './physics'

/**
 * The play style. 'line' is the classic Line Rider clone (gravity-only sled on
 * user-drawn track). 'side' is the side-scroller variation: the character gets a
 * constant horizontal propulsion force and auto-runs along an implicit flat
 * ground plane, launching off ramps the user draws above it. Rides an atom (not
 * props) for the same referential-stability reason as the other inputs; captured
 * at run start by RunController so it can't change mid-run.
 */
export type GameMode = 'line' | 'side'

/** The active play style. Defaults to classic line-rider. */
export const modeAtom = atom<GameMode>('lrs-mode', 'line')

/**
 * In 'side' mode the implicit ground plane sits this many page-pixels BELOW the
 * start point, so the character drops a short distance and settles onto the
 * ground before running (more forgiving, and it lets the start marker read as
 * floating above the ground). The physics ground segment (RunController), the
 * visible ground line (Rider), and the test-ramp foot (App) all derive the
 * ground Y as `start.y + SIDE_GROUND_DROP` from this one constant so they can't
 * drift apart. Kept modest so the settle is a quick hop, not a long fall.
 */
export const SIDE_GROUND_DROP = 120

/** The side-mode ground plane's page-Y for a given start point. One source of
 * truth for the physics ground, the visible ground line, and the ramp foot. */
export function sideGroundY(start: Vec2): number {
	return start.y + SIDE_GROUND_DROP
}

/** Whether a run is in progress. */
export const playingAtom = atom('lrs-playing', false)

/** Whether the camera eases to follow the sled while playing. */
export const followAtom = atom('lrs-follow', true)

/** Whether surface sounds are muted. Off (audible) by default. */
export const mutedAtom = atom('lrs-muted', false)

/**
 * Debug overlay: when on, the rider draws the collision geometry it actually
 * simulates — every collidable shape's page-space segments plus the sled rig's
 * per-point contact circles — so you can see what the physics "sees" vs. the
 * drawn art. Off by default.
 */
export const showCollisionsAtom = atom('lrs-showCollisions', false)

/** Page-space point the sled spawns from at the start of a run. */
export const startPointAtom = atom<Vec2>('lrs-startPoint', { x: 200, y: 100 })

/**
 * Monotonic counter the Reset button bumps to re-seat the sled at the start
 * point without moving the start itself. The rider re-builds its body whenever
 * this changes (and whenever startPointAtom changes); a counter — not a boolean —
 * so repeated resets to the same start still register as a change.
 */
export const resetNonceAtom = atom('lrs-resetNonce', 0)

/** Live run telemetry the rider publishes for the panel. */
export const statsAtom = atom('lrs-stats', { distance: 0, speed: 0 })

/** Checkpoint progress: how many of `total` flags collected this run. */
export const scoreAtom = atom('lrs-score', { collected: 0, total: 0 })
