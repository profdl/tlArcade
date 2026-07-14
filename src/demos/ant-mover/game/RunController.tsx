// The ant-mover run driver (MULTIPLAYER). Renders nothing — a headless controller
// mounted alongside the Field overlay, inside the editor context.
//
// The sim is SERVER-AUTHORITATIVE now: the Durable Object owns the one planck
// world and broadcasts the pose (netPose.ts writes it into objPoseAtom, which
// Field draws). This controller no longer simulates. Its jobs:
//   1. Own the input socket (useAmInput) — grabs + start/stop up to the DO.
//   2. On a local play/stop REQUEST (playIntentAtom, from the panel): compute the
//      WorldSpec from the editor (the DO has no editor — plan decision) and send
//      {start, spec} / {stop}. The DO flips the authoritative play-state back over
//      the network into playingAtom.
//   3. React to the network play-state (playingAtom): hide the authored object
//      shape while playing (the overlay draws the posed body) and unhide on stop;
//      lock the canvas read-only while playing so a drag is a grab, not a gesture.
//
// Play/Stop lifecycle: STOPPED = author mode (maze + object are editable native
// shapes). PLAYING = the DO steps the sim from their geometry. Stop → edit →
// restart. The step-2/3a LOCAL client sim is gone — sim.ts now runs in the DO.

import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useEditor, useValue, type TLShapePartial } from 'tldraw'
import { readWorldSpec, getObjectShapeId } from './shapes'
import { seedDefaultLayout } from './seed'
import { useAmInput } from './useInput'
import { playingAtom, playIntentAtom } from './state'

export function RunController() {
	const editor = useEditor()
	const { roomId } = useParams<{ roomId: string }>()
	// Network-authoritative play-state (set by netPose from the DO broadcast).
	const playing = useValue('am-playing', () => playingAtom.get(), [])
	const intent = useValue('am-playIntent', () => playIntentAtom.get(), [])

	// The input socket + pointer→grab handling.
	const input = useAmInput(roomId)

	// Seed a starter maze + object onto a FRESH room (no-op if the synced doc
	// already has shapes — so a joiner never clobbers an in-progress room, and only
	// the first player into an empty room seeds it; the shapes then sync to all).
	useEffect(() => {
		seedDefaultLayout(editor)
	}, [editor])

	// Handle a local play/stop request from the panel. On START, read the authored
	// shapes into a WorldSpec here (only the client has an editor) and ship it up;
	// the DO builds the world and broadcasts play-state back. On STOP, tell the DO.
	useEffect(() => {
		if (!intent) return
		if (intent === 'start') {
			const spec = readWorldSpec(editor)
			// No designated object → nothing to simulate; ignore the request.
			if (spec.object) input.send({ type: 'start', spec })
		} else {
			input.send({ type: 'stop' })
		}
		playIntentAtom.set(null) // consume the request
	}, [intent, editor, input])

	// React to the NETWORK play-state. Hide the authored object shape while playing
	// (the overlay draws the posed body); unhide it on stop. Also lock the canvas
	// read-only while playing so a drag becomes a grab, not a brush-select/move.
	useEffect(() => {
		const objId = getObjectShapeId(editor)
		if (playing) {
			editor.run(
				() => {
					editor.updateInstanceState({ isReadonly: true })
					editor.selectNone()
					const objType = objId && editor.getShape(objId)?.type
					if (objId && objType) {
						// Non-literal `type` → cast the partial (repo CLAUDE.md union gotcha).
						editor.updateShape({ id: objId, type: objType, opacity: 0 } as TLShapePartial)
					}
				},
				{ history: 'ignore' }
			)
		} else {
			// Leaving play: clear read-only FIRST (updateShape is a no-op while
			// readonly), then unhide the authored object at its resting spot.
			editor.run(
				() => {
					editor.updateInstanceState({ isReadonly: false })
					const s = objId && editor.getShape(objId)
					if (objId && s) {
						editor.updateShape({ id: objId, type: s.type, opacity: 1 } as TLShapePartial)
					}
				},
				{ history: 'ignore' }
			)
		}
	}, [editor, playing])

	return null
}
