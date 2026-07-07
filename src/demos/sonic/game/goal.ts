// The Sonic win condition — the one gameplay concept the Line Rider base lacks.
//
// A *goal* is a single page-space (possibly rotated) box the character wins by
// reaching: the first substep the body center lands inside it during a run, the
// run is won. It reuses the checkpoints module's oriented-box + point-in-box math
// verbatim (a goal is just a Checkpoint we test for entry rather than collect), so
// there is no new geometry here — only the "which native shape is the goal" pick
// and the win test. Pure (no tldraw / framework deps) so it stays unit-testable,
// mirroring checkpoints.ts / physics.ts.

import type { Vec2 } from './physics'
import { pointInCheckpoint, type Checkpoint } from './checkpoints'

// Native `frame` shapes are the goal marker. A frame is a distinct native shape
// type used for nothing else here — notes are rings (checkpoints), and the track
// kinds are draw/line/geo/arrow (COLLIDABLE_TYPES) — so a frame reads
// unambiguously as "the finish". Native-first: no custom shape, the user drops a
// frame where the level should end. Frames are not in COLLIDABLE_TYPES, so a goal
// is never also solid track.
export const GOAL_TYPE = 'frame'

/**
 * True when the character (its body center `pos`) has reached the goal box. A
 * goal is modeled as a `Checkpoint` (the same oriented box), so this is exactly
 * the checkpoint entry test — factored out under a Sonic-meaningful name so the
 * win check reads as a win, not a "collect". Returns false when there is no goal.
 */
export function reachedGoal(pos: Vec2, goal: Checkpoint | null): boolean {
	return goal !== null && pointInCheckpoint(pos, goal)
}
