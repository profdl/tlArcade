import { atom, type Editor, type TLShapeId } from 'tldraw'
import { applyFrame, type Pose } from '../poses/applyPose'

/**
 * Per-figure motion playback. Plays a catalog pose's `frames` sequence on a figure
 * by stepping through the frames at the pose's `fps`, writing each frame through the
 * same `applyFrame` path the static picker uses (so playback and one-shot posing are
 * identical, and both stay invisible to the bone-joint binding via its suppression).
 *
 * State lives at module scope, keyed by figureId, so:
 *  - each figure plays independently (multiple figures can animate at once),
 *  - the PoseToolbar can read "is THIS figure playing?" reactively via `playingFigures`.
 *
 * The loop advances by wall-clock time (not one frame per rAF tick) so playback runs
 * at the motion's real speed regardless of display refresh rate.
 */

/** Reactive set of figure ids currently playing. Toolbar reads it via `useValue`. */
export const playingFigures = atom<ReadonlySet<TLShapeId>>('playingFigures', new Set())

/**
 * The pose most recently picked for each figure — what its Play button will play.
 * Keyed by figureId so a figure remembers its choice even as the user selects
 * different limbs (which re-mounts the toolbar) or poses another figure. Reactive so
 * the toolbar's Play button enables/disables as the pick changes.
 */
export const selectedPose = atom<ReadonlyMap<TLShapeId, Pose>>('selectedPose', new Map())

export function setSelectedPose(figure: TLShapeId, pose: Pose): void {
	const next = new Map(selectedPose.get())
	next.set(figure, pose)
	selectedPose.set(next)
}

export function getSelectedPose(figure: TLShapeId): Pose | undefined {
	return selectedPose.get().get(figure)
}

/**
 * Playback mode shared by all figures: loop the clip vs. play it once. Module-level
 * (not per-figure) so the Loop/Once toggle keeps its setting across selections. The
 * toolbar reads it via `useValue` and passes it to `playPose`.
 */
export const loopMode = atom<boolean>('loopMode', true)

export function toggleLoopMode(): void {
	loopMode.set(!loopMode.get())
}

interface Playback {
	raf: number
	/** performance.now() timestamp when the current frame index started showing. */
	frameStart: number
}

const active = new Map<TLShapeId, Playback>()

function markPlaying(figure: TLShapeId, playing: boolean): void {
	const next = new Set(playingFigures.get())
	if (playing) next.add(figure)
	else next.delete(figure)
	playingFigures.set(next)
}

/** True if `figure` is currently animating. */
export function isPlaying(figure: TLShapeId): boolean {
	return active.has(figure)
}

/**
 * Start playing `pose`'s motion on `figure`. No-op if the pose has no frames.
 * Restarts from frame 0 if the figure is already playing something.
 *
 * @param loop when true, the clip repeats until `stopPlaying`; when false it plays
 *             once and stops on the final frame.
 */
export function playPose(
	editor: Editor,
	figure: TLShapeId,
	pose: Pose,
	{ loop }: { loop: boolean }
): void {
	const frames = pose.frames
	if (!frames || frames.length === 0) return

	// Restart cleanly if already playing.
	stopPlaying(figure)

	const fps = pose.fps && pose.fps > 0 ? pose.fps : 20
	const frameDurationMs = 1000 / fps
	let index = 0

	// Show the first frame immediately so Play has instant feedback.
	applyFrame(editor, figure, frames[index])

	const state: Playback = { raf: 0, frameStart: 0 }

	const tick = (now: number) => {
		// The figure may have been deleted mid-playback (e.g. undo) — stop if its
		// pelvis is gone so we don't leak a loop or throw in applyFrame.
		if (!editor.getShape(figure)) {
			stopPlaying(figure)
			return
		}

		if (state.frameStart === 0) state.frameStart = now
		const elapsed = now - state.frameStart

		if (elapsed >= frameDurationMs) {
			// Advance by however many frame-durations have elapsed (robust to a slow/
			// backgrounded tab producing a large gap), but never skip past the end.
			const advance = Math.floor(elapsed / frameDurationMs)
			state.frameStart = now
			index += advance

			if (index >= frames.length) {
				if (loop) {
					index %= frames.length
				} else {
					// Land exactly on the last frame, then stop.
					applyFrame(editor, figure, frames[frames.length - 1])
					stopPlaying(figure)
					return
				}
			}
			applyFrame(editor, figure, frames[index])
		}

		state.raf = requestAnimationFrame(tick)
	}

	state.raf = requestAnimationFrame(tick)
	active.set(figure, state)
	markPlaying(figure, true)
}

/** Stop playback for `figure` (idempotent). The figure holds its current frame. */
export function stopPlaying(figure: TLShapeId): void {
	const state = active.get(figure)
	if (!state) return
	cancelAnimationFrame(state.raf)
	active.delete(figure)
	markPlaying(figure, false)
}

/** Stop every playing figure — call on unmount to cancel any live rAF loops. */
export function stopAll(): void {
	for (const figure of [...active.keys()]) stopPlaying(figure)
}
