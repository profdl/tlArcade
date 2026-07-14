// Receive side of the server→client pose channel (skill rule 3/6). The DO pushes
// ServerMsg through room.sendCustomMessage; it arrives at
// useSync({ onCustomMessageReceived }) (wired in pages/Room.tsx) and lands here.
//
// This module is the ONLY place the network writes gameplay state, and it writes
// into the SAME atoms the old local sim used (objPoseAtom / ropesAtom /
// objShapeAtom / playingAtom). Field.tsx reads those atoms unchanged — flipping
// the pose source from local sim to network is invisible to the renderer.
//
// INTERPOLATION (skill rule 6): the server ticks at ~30 Hz but displays run at
// 60–144 Hz, so a raw pose write stutters. We buffer the last two received poses
// and a rAF loop writes a time-interpolated pose into objPoseAtom each frame
// (lerp position, shortest-arc lerp angle). Ropes are written straight through
// (thin lines; their small stutter is imperceptible next to the heavy body).

import { TAB_ID } from '@tldraw/editor'
import { objPoseAtom, ropesAtom, objShapeAtom, playingAtom, type RopeView } from './state'
import type { Pose } from './sim'
import { isServerMsg, type ServerMsg } from './protocol'

/** This client's sync sessionId — useSync uses TAB_ID, and we open the input
 *  socket with the same value, so the server addresses our pose broadcast to this
 *  id. Used to flag which incoming rope is our own (distinct color). */
export const AM_SESSION_ID = TAB_ID

// --- Interpolation buffer ---------------------------------------------------
// Keep the previous + latest pose and the wall-clock times they arrived. The rAF
// loop interpolates between them by real elapsed time, so it stays smooth even if
// tick arrival jitters. We interpolate at a fixed lag (the inter-arrival gap) so
// we're always between two KNOWN poses rather than extrapolating past the latest.

interface Sample {
	pose: Pose
	t: number
}
let prev: Sample | null = null
let next: Sample | null = null
/** rolling estimate of the server tick interval (ms), seeded to ~33ms (30 Hz). */
let interval = 33

/** Shortest-arc angle interpolation (radians): lerp along the smaller direction so
 *  a wrap across ±π doesn't spin the body the long way round. */
function lerpAngle(a: number, b: number, t: number): number {
	let d = (b - a) % (Math.PI * 2)
	if (d > Math.PI) d -= Math.PI * 2
	if (d < -Math.PI) d += Math.PI * 2
	return a + d * t
}

/** Handle one message off the sync custom channel. Wire this to
 *  useSync({ onCustomMessageReceived }). */
export function onAmServerMessage(data: unknown): void {
	if (!isServerMsg(data)) return
	const msg = data as ServerMsg
	if (msg.type === 'am-play') {
		playingAtom.set(msg.playing)
		objShapeAtom.set(msg.shape)
		if (!msg.playing) {
			// Run ended: clear transient render state and reset the interpolation buffer
			// so a later run doesn't lerp from a stale pose.
			ropesAtom.set([])
			prev = null
			next = null
		}
		return
	}
	// am-pose: push into the interpolation buffer.
	const now = performance.now()
	if (next) {
		interval = Math.max(8, Math.min(200, now - next.t)) // clamp out pauses/spikes
		prev = next
	}
	next = { pose: msg.pose, t: now }
	if (!prev) prev = next

	// Ropes render straight through; flag our own for the distinct color.
	const ropes: RopeView[] = msg.ropes.map((r) => ({
		anchor: r.anchor,
		cursor: r.cursor,
		human: r.sessionId === AM_SESSION_ID,
	}))
	ropesAtom.set(ropes)
}

/** Start the interpolation rAF loop; returns a disposer. Mounted by Room while the
 *  editor is up. Writes an interpolated pose into objPoseAtom every frame. */
export function startPoseInterpolation(): () => void {
	let raf = 0
	const frame = () => {
		raf = requestAnimationFrame(frame)
		if (!prev || !next) return
		if (prev === next) {
			objPoseAtom.set(next.pose)
			return
		}
		// Render at a fixed lag of one interval behind `next` so we interpolate
		// between prev→next rather than extrapolating past the newest sample.
		const renderTime = performance.now() - interval
		const span = next.t - prev.t
		const t = span > 0 ? Math.max(0, Math.min(1, (renderTime - prev.t) / span)) : 1
		objPoseAtom.set({
			x: prev.pose.x + (next.pose.x - prev.pose.x) * t,
			y: prev.pose.y + (next.pose.y - prev.pose.y) * t,
			angle: lerpAngle(prev.pose.angle, next.pose.angle, t),
		})
	}
	raf = requestAnimationFrame(frame)
	return () => cancelAnimationFrame(raf)
}

/** Reset the interpolation buffer (e.g. on unmount / room change). */
export function resetPoseBuffer(): void {
	prev = null
	next = null
}
