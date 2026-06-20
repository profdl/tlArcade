import { useEffect, useRef } from 'react'
import { useEditor, toDomPrecision } from 'tldraw'
import {
	makeBody,
	stepBody,
	bodyCenter,
	bodyVelocity,
	type Body,
} from './physics'
import { collectSegments, collectCheckpoints } from './geometry'
import { collectCheckpointHits, type Checkpoint } from './checkpoints'
import { playingAtom, followAtom, startPointAtom, statsAtom, scoreAtom, resetNonceAtom } from './state'

const FIXED_DT = 1 / 120 // physics substep (s)
const STATS_EVERY = 4 // throttle React stat updates to every Nth frame

// Fraction of the gap to the sled the camera closes each frame while following.
// Low enough to glide smoothly, high enough to keep a fast sled on screen.
const CAMERA_FOLLOW_LERP = 0.12

// The sled overlay. Rendered via components.InFrontOfTheCanvas. A single rAF
// loop runs continuously: while playing it advances the physics; in all states
// it positions the sled by recomputing editor.pageToViewport() each frame, so
// the sled stays glued to the canvas under pan / zoom / resize without any
// per-frame React re-render (we write the SVG geometry imperatively).
//
// Gameplay state flows through tldraw atoms (defined in App), not props: the
// loop reads playing/follow/start cold via .get() each frame and writes
// stats/score back. This lets the parent keep its `components` object stable, so
// toggling follow or play never remounts this component (which would reset the
// rAF loop and snap the sled to the start mid-ride).
//
// The sled is a multi-point body (see makeBody): a constraint-solved quad that
// tumbles. We draw it as an SVG polygon over the body's four points plus a small
// marker dot at the lead point so its rotation is visible.
export function Rider() {
	const editor = useEditor()
	const polyRef = useRef<SVGPolygonElement | null>(null)
	const dotRef = useRef<SVGCircleElement | null>(null)
	const startRef = useRef<SVGGElement | null>(null)
	const bodyRef = useRef<Body>(makeBody(startPointAtom.get()))

	useEffect(() => {
		let raf = 0
		let last = performance.now()
		let acc = 0
		let frameCount = 0
		let segments = collectSegments(editor)
		let checkpoints: Checkpoint[] = collectCheckpoints(editor)
		// Ids collected this run; reset when a run begins so flags re-arm.
		let collected = new Set<string>()

		// Re-snapshot collision geometry each time a run begins.
		let wasPlaying = false
		// Re-seat the sled whenever the start point moves (immediate feedback even
		// while stopped) or the Reset button bumps the nonce. Track the last-seen
		// values so we only rebuild on change.
		let lastStart = startPointAtom.get()
		let lastReset = resetNonceAtom.get()

		const tick = (now: number) => {
			const start = startPointAtom.get()
			const reset = resetNonceAtom.get()
			if (start !== lastStart || reset !== lastReset) {
				lastStart = start
				lastReset = reset
				bodyRef.current = makeBody(start)
				// Clear last run's telemetry so the panel reads 0 after a reset.
				statsAtom.set({ distance: 0, speed: 0 })
			}

			const isPlaying = playingAtom.get()
			if (isPlaying && !wasPlaying) {
				// Run begins: re-seat the sled at the start and re-snapshot the track.
				bodyRef.current = makeBody(start)
				segments = collectSegments(editor)
				checkpoints = collectCheckpoints(editor)
				collected = new Set<string>()
				scoreAtom.set({ collected: 0, total: checkpoints.length })
				statsAtom.set({ distance: 0, speed: 0 }) // clear last run's readout immediately
				last = now
				acc = 0
				frameCount = 0 // restart stats cadence so the first run frame samples predictably
			}
			wasPlaying = isPlaying

			if (isPlaying) {
				let frame = (now - last) / 1000
				last = now
				if (frame > 0.05) frame = 0.05 // avoid spiral-of-death after tab blur
				acc += frame
				let scored = false
				while (acc >= FIXED_DT) {
					stepBody(bodyRef.current, segments, FIXED_DT)
					// Test checkpoints against the body center per substep so a fast
					// sled can't tunnel past a flag between rendered frames.
					// collectCheckpointHits mutates `collected` so each flag scores once.
					if (checkpoints.length > 0) {
						const c = bodyCenter(bodyRef.current)
						const hits = collectCheckpointHits(c, checkpoints, collected)
						if (hits.length > 0) scored = true
					}
					acc -= FIXED_DT
				}
				if (scored) scoreAtom.set({ collected: collected.size, total: checkpoints.length })
				if (++frameCount % STATS_EVERY === 0) {
					const c = bodyCenter(bodyRef.current)
					const d = Math.hypot(c.x - start.x, c.y - start.y)
					const v = bodyVelocity(bodyRef.current, FIXED_DT)
					statsAtom.set({ distance: d, speed: Math.hypot(v.x, v.y) })
				}

				// Camera follow: ease the viewport center toward the sled so a fast
				// ride stays on screen. Lerping (not snapping) avoids a jarring lock,
				// and skipping when already close avoids fighting a settled sled with
				// sub-pixel camera nudges. history:'ignore' keeps it off the undo
				// stack; the camera move must not be an undoable edit.
				if (followAtom.get()) {
					const center = editor.getViewportPageBounds().center
					const c = bodyCenter(bodyRef.current)
					const dx = c.x - center.x
					const dy = c.y - center.y
					if (Math.hypot(dx, dy) > 1) {
						const target = {
							x: center.x + dx * CAMERA_FOLLOW_LERP,
							y: center.y + dy * CAMERA_FOLLOW_LERP,
						}
						editor.run(() => editor.centerOnPoint(target), { history: 'ignore' })
					}
				}
			} else {
				last = now // keep timebase fresh while paused
			}

			// Position the sled. pageToViewport reads live camera + screenBounds and
			// returns coords relative to the editor container — which is exactly the
			// frame our overlay lives in (InFrontOfTheCanvas, positioned inset:0 in
			// that container). pageToScreen would return window-relative coords and
			// drift by the container's screen offset whenever the editor isn't flush
			// to the window. Correct under pan/zoom/resize in every state.
			// Start marker: a crosshair pinned to the spawn point in page space, so
			// the player can see where the sled will drop from. Hidden during a run
			// (the sled itself shows where you are). Positioned with pageToViewport
			// like the sled, so it tracks pan/zoom.
			const startG = startRef.current
			if (startG) {
				if (isPlaying) {
					startG.setAttribute('opacity', '0')
				} else {
					const s = editor.pageToViewport(start)
					startG.setAttribute('opacity', '1')
					startG.setAttribute('transform', `translate(${toDomPrecision(s.x)},${toDomPrecision(s.y)})`)
				}
			}

			const poly = polyRef.current
			const dot = dotRef.current
			if (poly) {
				const pts = bodyRef.current.points
				const screenPts = pts.map((p) => editor.pageToViewport(p.pos))
				poly.setAttribute(
					'points',
					screenPts
						.map((s) => `${toDomPrecision(s.x)},${toDomPrecision(s.y)}`)
						.join(' ')
				)
				if (dot) {
					// Marker at the body's lead point (index 1) so rotation reads.
					dot.setAttribute('cx', `${toDomPrecision(screenPts[1].x)}`)
					dot.setAttribute('cy', `${toDomPrecision(screenPts[1].y)}`)
				}
			}

			raf = requestAnimationFrame(tick)
		}
		raf = requestAnimationFrame(tick)
		return () => cancelAnimationFrame(raf)
	}, [editor])

	// Full-viewport SVG overlay; the rAF loop writes the polygon/dot geometry in
	// screen space each frame. Static appearance lives in App.css (.lr-sled-*).
	return (
		<svg className="lr-sled-svg" aria-hidden="true">
			{/* Start marker: a target ring + crosshair at the spawn point, centered on
			    its own origin so the rAF loop only has to translate the group. */}
			<g ref={startRef} className="lr-start-marker" opacity="0">
				<circle className="lr-start-ring" r={12} />
				<line className="lr-start-cross" x1={-16} y1={0} x2={16} y2={0} />
				<line className="lr-start-cross" x1={0} y1={-16} x2={0} y2={16} />
			</g>
			<polygon ref={polyRef} className="lr-sled-body" points="" />
			<circle ref={dotRef} className="lr-sled-dot" r={3} />
		</svg>
	)
}
