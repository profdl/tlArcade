// The ant-mover sim driver: owns the local planck sim, runs a fixed-timestep rAF
// loop, turns mouse drags into grabs, and (dev) drives scripted grabbers. Renders
// NOTHING — it's a headless controller mounted alongside the Field overlay. It
// writes the T pose into tPoseAtom every frame; Field reads it and draws.
//
// This is the STEP-2 LOCAL sim (client-authoritative, to prove feel). The sim
// module (sim.ts) is pure and framework-free precisely so it ports into the DO at
// step 4 unchanged — only this driver (input + loop) is client-only.
//
// Grab model: mousedown hit-tests the T; if it hits, we capture the body-local
// anchor (stuck to that spot) and track the cursor until mouseup. Force is a
// spring from anchor→cursor applied AT the anchor (off-center → torque). See the
// planck-rigid-body-sim skill.

import { useEffect, useRef } from 'react'
import { useEditor, useValue } from 'tldraw'
import { createWorld, step, tPose, hitTestT, FIXED_DT, type Sim, type Grab } from './sim'
import { EXIT } from './geometry'
import { playingAtom, resetNonceAtom, tPoseAtom, scriptedCountAtom } from './state'

/** A scripted (bot) grabber: holds a fixed body-local anchor and pulls toward a
 * moving target — here, the exit — so a crowd sim can run with no humans. */
interface Bot {
	grab: Grab
}

export function RunController() {
	const editor = useEditor()
	const playing = useValue('am-playing', () => playingAtom.get(), [])
	const resetNonce = useValue('am-resetNonce', () => resetNonceAtom.get(), [])
	const scriptedCount = useValue('am-scripted', () => scriptedCountAtom.get(), [])

	// Mutable refs the rAF loop reads without re-subscribing.
	const simRef = useRef<Sim | null>(null)
	// The human's live grab (null when not dragging). Kept in a ref so pointer
	// handlers and the loop share one object.
	const humanGrab = useRef<Grab | null>(null)
	const botsRef = useRef<Bot[]>([])

	// (Re)build the sim on mount and on Reset. Seed the static pose immediately so
	// Field shows the piece even before the loop starts.
	useEffect(() => {
		const sim = createWorld()
		simRef.current = sim
		humanGrab.current = null
		tPoseAtom.set(tPose(sim))
	}, [resetNonce])

	// Rebuild the scripted bots whenever the requested count changes. Each bot
	// grabs a point spread around the T's crossbar and stem and pulls toward the
	// exit — enough to watch a crowd shove the piece around.
	useEffect(() => {
		const sim = simRef.current
		if (!sim) return
		const bots: Bot[] = []
		for (let i = 0; i < scriptedCount; i++) {
			// Spread anchors across the T in body-local meters (planck +y up). The
			// crossbar spans ~±3m; the stem hangs below (−y). Fan them out so pulls
			// aren't all colinear.
			const frac = scriptedCount === 1 ? 0.5 : i / (scriptedCount - 1)
			const anchorLocal = { x: (frac - 0.5) * 5.2, y: 2.2 }
			bots.push({ grab: { anchorLocal, cursor: { x: EXIT.cx, y: EXIT.cy } } })
		}
		botsRef.current = bots
	}, [scriptedCount, resetNonce])

	// Pointer grab handling on the editor container. We attach our own listeners
	// (capture phase) so a drag on the T becomes a grab regardless of the active
	// tldraw tool, and use screenToPage for page coords.
	useEffect(() => {
		const container = editor.getContainer()

		const pagePointFromEvent = (e: PointerEvent) =>
			editor.screenToPage({ x: e.clientX, y: e.clientY })

		const onDown = (e: PointerEvent) => {
			if (!playingAtom.get()) return
			const sim = simRef.current
			if (!sim) return
			const p = pagePointFromEvent(e)
			const anchorLocal = hitTestT(sim, p)
			if (anchorLocal) {
				humanGrab.current = { anchorLocal, cursor: { x: p.x, y: p.y } }
			}
		}
		const onMove = (e: PointerEvent) => {
			if (!humanGrab.current) return
			const p = pagePointFromEvent(e)
			humanGrab.current.cursor = { x: p.x, y: p.y }
		}
		const onUp = () => {
			humanGrab.current = null
		}

		container.addEventListener('pointerdown', onDown, { capture: true })
		window.addEventListener('pointermove', onMove)
		window.addEventListener('pointerup', onUp)
		return () => {
			container.removeEventListener('pointerdown', onDown, { capture: true } as EventListenerOptions)
			window.removeEventListener('pointermove', onMove)
			window.removeEventListener('pointerup', onUp)
		}
	}, [editor])

	// The fixed-timestep loop. Accumulator pattern: step the sim in fixed FIXED_DT
	// chunks regardless of frame rate, so physics is deterministic and matches the
	// server tick. Only steps while playing; always writes the pose (so a paused
	// piece still renders where it rests).
	useEffect(() => {
		let raf = 0
		let last = performance.now()
		let acc = 0

		const frame = (now: number) => {
			raf = requestAnimationFrame(frame)
			const sim = simRef.current
			if (!sim) return

			const dtMs = now - last
			last = now
			if (playingAtom.get()) {
				acc += dtMs / 1000
				// Cap the accumulator so a tab-away doesn't spiral into a huge catch-up.
				if (acc > 0.25) acc = 0.25
				while (acc >= FIXED_DT) {
					const grabs: Grab[] = []
					if (humanGrab.current) grabs.push(humanGrab.current)
					for (const b of botsRef.current) grabs.push(b.grab)
					step(sim, grabs)
					acc -= FIXED_DT
				}
			} else {
				acc = 0
			}
			tPoseAtom.set(tPose(sim))
		}

		raf = requestAnimationFrame(frame)
		return () => cancelAnimationFrame(raf)
		// The loop reads playing via the atom (not the closure) so it never needs to
		// restart; mount once.
	}, [])

	// Nudge dependency so lint/TS see `playing` used (it gates via the atom inside
	// the loop; this keeps the mirror honest and re-renders the panel).
	void playing

	return null
}
