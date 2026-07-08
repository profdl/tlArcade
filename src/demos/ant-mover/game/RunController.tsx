// The ant-mover sim driver: owns the local planck sim, runs a fixed-timestep rAF
// loop, turns mouse drags into grabs, and (dev) drives scripted grabbers. Renders
// NOTHING — it's a headless controller mounted alongside the Field overlay. It
// writes the object pose into objPoseAtom every frame; Field reads it and draws.
//
// This is the STEP-2/3a LOCAL sim (client-authoritative, to prove feel). The sim
// module (sim.ts) is pure and framework-free precisely so it ports into the DO at
// step 4 unchanged — only this driver (input + loop) is client-only.
//
// Play/Stop lifecycle (step 3a): STOPPED = author mode (the maze + object are
// editable native shapes). On PLAY we read the authored shapes' true geometry
// into a planck sim (readWorldSpec → createWorld), hide the object shape (the
// overlay draws the posed body instead), and step. On STOP we drop the sim and
// unhide the shape at its authored spot. Stop → edit → restart.

import { useEffect, useRef } from 'react'
import { useEditor, useValue, type TLShapePartial } from 'tldraw'
import {
	createWorld,
	step,
	objPose,
	hitTestObject,
	grabAnchorPage,
	FIXED_DT,
	type Sim,
	type Grab,
} from './sim'
import { readWorldSpec, getObjectShapeId } from './shapes'
import { EXIT, PX_PER_M } from './geometry'
import { seedDefaultLayout } from './seed'
import { playingAtom, resetNonceAtom, objPoseAtom, scriptedCountAtom, ropesAtom, objShapeAtom, type RopeView } from './state'

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
	const humanGrab = useRef<Grab | null>(null)
	const botsRef = useRef<Bot[]>([])

	// Seed a starter maze + object onto a fresh canvas (once; no-op if the page
	// already has shapes, so a persisted/edited canvas is never clobbered).
	useEffect(() => {
		seedDefaultLayout(editor)
	}, [editor])

	// Build / tear down the sim on the Play↔Stop edge (and on Reset while playing).
	// PLAY: read the authored shapes into a planck world, hide the object shape
	// (the overlay draws the posed body). STOP: drop the sim, unhide the shape.
	useEffect(() => {
		if (playing) {
			const spec = readWorldSpec(editor)
			const sim = createWorld(spec)
			simRef.current = sim
			humanGrab.current = null
			if (sim) {
				objPoseAtom.set(objPose(sim))
				objShapeAtom.set(sim.shape)
				// Hide the authored object shape while the sim owns its motion.
				const objId = getObjectShapeId(editor)
				const objType = objId && editor.getShape(objId)?.type
				if (objId && objType) {
					// Non-literal `type` → cast the partial (repo CLAUDE.md union gotcha).
					editor.run(
						() => editor.updateShape({ id: objId, type: objType, opacity: 0 } as TLShapePartial),
						{ history: 'ignore' }
					)
				}
			} else {
				// No designated object (or unusable outline) — nothing to simulate.
				objShapeAtom.set(null)
			}
			return () => {
				// Leaving play: unhide the authored object at its resting spot. Clear
				// read-only FIRST — updateShape is a no-op while the editor is readonly
				// (still true here: this cleanup runs before the readonly effect sets it
				// false on the same toggle), so the unhide would otherwise be dropped and
				// the shape stay invisible.
				const objId = getObjectShapeId(editor)
				const s = objId && editor.getShape(objId)
				editor.run(
					() => {
						editor.updateInstanceState({ isReadonly: false })
						if (objId && s) {
							editor.updateShape({ id: objId, type: s.type, opacity: 1 } as TLShapePartial)
						}
					},
					{ history: 'ignore' }
				)
				simRef.current = null
				botsRef.current = []
				ropesAtom.set([])
				objShapeAtom.set(null)
			}
		}
	}, [editor, playing, resetNonce])

	// Rebuild the scripted bots whenever the count changes (only meaningful while
	// a sim exists). Each bot grabs a point spread across the object and pulls
	// toward the exit — enough to watch a crowd shove the piece around.
	useEffect(() => {
		const sim = simRef.current
		if (!sim) {
			botsRef.current = []
			return
		}
		const bots: Bot[] = []
		// Spread anchors across the object's local convex pieces (body-local meters,
		// planck +y up). Grab a vertex from successive pieces so pulls aren't colinear.
		const pieces = sim.shape.pieces
		for (let i = 0; i < scriptedCount; i++) {
			const piece = pieces[i % pieces.length]
			const v = piece[i % piece.length]
			// Piece verts are local page px (+y down); convert to planck local meters
			// (y-flip: page +y down → planck +y up).
			const anchorLocal = { x: v.x / PX_PER_M, y: -v.y / PX_PER_M }
			bots.push({ grab: { anchorLocal, cursor: { x: EXIT.cx, y: EXIT.cy } } })
		}
		botsRef.current = bots
	}, [scriptedCount, playing, resetNonce])

	// Pointer grab handling on the editor container. Own listeners (capture phase)
	// so a drag on the object becomes a grab regardless of the active tldraw tool.
	useEffect(() => {
		const container = editor.getContainer()

		const pagePointFromEvent = (e: PointerEvent) => editor.screenToPage({ x: e.clientX, y: e.clientY })

		const onDown = (e: PointerEvent) => {
			if (!playingAtom.get()) return
			const sim = simRef.current
			if (!sim) return
			const p = pagePointFromEvent(e)
			const anchorLocal = hitTestObject(sim, p)
			if (anchorLocal) {
				humanGrab.current = { anchorLocal, cursor: { x: p.x, y: p.y } }
				// This drag is a GRAB, not a canvas gesture — claim the event so tldraw
				// never sees it (no brush-select, no shape drag).
				e.stopPropagation()
				e.preventDefault()
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

	// Lock the canvas to read-only WHILE PLAYING so a drag can't brush-select or
	// move shapes — during play the only meaningful drag is a grab (handled above).
	// Pan/zoom still work in read-only, so a click that MISSES the object pans.
	useEffect(() => {
		editor.run(
			() => {
				editor.updateInstanceState({ isReadonly: playing })
				if (playing) editor.selectNone()
			},
			{ history: 'ignore' }
		)
	}, [editor, playing])

	// The fixed-timestep loop. Accumulator pattern: step the sim in fixed FIXED_DT
	// chunks regardless of frame rate, so physics matches the server tick. Only
	// steps while playing and a sim exists.
	useEffect(() => {
		let raf = 0
		let last = performance.now()
		let acc = 0

		const frame = (now: number) => {
			raf = requestAnimationFrame(frame)
			const sim = simRef.current
			const dtMs = now - last
			last = now
			if (!sim) return

			const grabs: Grab[] = []
			if (humanGrab.current) grabs.push(humanGrab.current)
			for (const b of botsRef.current) grabs.push(b.grab)

			if (playingAtom.get()) {
				acc += dtMs / 1000
				if (acc > 0.25) acc = 0.25 // don't spiral into a huge catch-up after a tab-away
				while (acc >= FIXED_DT) {
					step(sim, grabs)
					acc -= FIXED_DT
				}
			} else {
				acc = 0
			}
			objPoseAtom.set(objPose(sim))

			// Publish the ropes to draw: each grab's live object-side point → cursor.
			const ropes: RopeView[] = playingAtom.get()
				? grabs.map((g, i) => ({
						anchor: grabAnchorPage(sim, g),
						cursor: { x: g.cursor.x, y: g.cursor.y },
						human: i === 0 && humanGrab.current === g,
					}))
				: []
			ropesAtom.set(ropes)
		}

		raf = requestAnimationFrame(frame)
		return () => cancelAnimationFrame(raf)
	}, [])

	void playing // keep the panel re-rendering on toggle

	return null
}
