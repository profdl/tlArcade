import { useCallback, useEffect, useRef } from 'react'
import { stopEventPropagation } from 'tldraw'

/** Called for the initial pointerdown and every subsequent pointermove of a drag. */
export type DragMove = (ev: { clientX: number; clientY: number }) => void

interface DragOptions {
	/** Run once on pointerdown, before the first move — e.g. mark a history stopping point. */
	onStart?: () => void
	/** Run once when the drag ends (pointerup or unmount). */
	onEnd?: () => void
}

interface LiveDrag {
	move: (ev: PointerEvent) => void
	up: () => void
}

/**
 * Shared pointer-drag plumbing for the demo's canvas overlays (IK handles, rig-mode
 * joint markers, the figure Move handle). Each of those starts a drag on an overlay
 * element's pointerdown, then tracks the pointer via `window` listeners so the drag
 * keeps working when the cursor leaves the small handle.
 *
 * This hook centralizes three things every one of them needs and one they were all
 * missing:
 * - `stopEventPropagation` + `setPointerCapture` on the pointerdown (so tldraw doesn't
 *   start its own marquee/translate, and the element keeps receiving events),
 * - `window` pointermove/pointerup wiring with clean teardown,
 * - **unmount safety**: if the overlay unmounts mid-drag (rig hidden, rig-mode exit,
 *   selection change, figure deleted), the effect cleanup tears the live drag down —
 *   previously these listeners and the pointer capture leaked.
 *
 * Usage: call `startDrag(handleMove, opts)(pointerDownEvent)`. The returned handler is
 * what you pass to `onPointerDown`. `handleMove` runs for the initial press and every
 * move, so the caller writes one code path for both.
 */
export function useDragGesture() {
	// The single in-flight drag (these overlays only ever run one at a time). Held in a
	// ref so the unmount effect can end it without re-subscribing on every render.
	const live = useRef<LiveDrag | null>(null)

	const endLive = useCallback(() => {
		const drag = live.current
		if (!drag) return
		window.removeEventListener('pointermove', drag.move)
		window.removeEventListener('pointerup', drag.up)
		live.current = null
	}, [])

	// Tear down any in-flight drag if the component unmounts mid-gesture.
	useEffect(() => endLive, [endLive])

	const startDrag = useCallback(
		(onMove: DragMove, opts: DragOptions = {}) =>
			(e: React.PointerEvent) => {
				// Don't let tldraw start its own marquee/translate on this pointerdown, and
				// keep events flowing to the handle even as the cursor leaves it.
				stopEventPropagation(e)
				try {
					;(e.target as Element).setPointerCapture(e.pointerId)
				} catch {
					// Capture can throw if the element is already gone; the window listeners
					// below still track the drag, so ignore.
				}

				// End any prior drag before starting a new one (defensive — normally none).
				endLive()
				opts.onStart?.()

				// The press itself is the first "move", so the handle starts following
				// immediately without waiting for the pointer to actually move.
				onMove(e)

				const move = (ev: PointerEvent) => onMove(ev)
				const up = () => {
					endLive()
					opts.onEnd?.()
				}
				live.current = { move, up }
				window.addEventListener('pointermove', move)
				window.addEventListener('pointerup', up)
			},
		[endLive]
	)

	return startDrag
}
