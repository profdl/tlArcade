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
import { playingAtom, playIntentAtom, autoStartAtom } from './state'

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
			// No designated object → nothing to simulate; ignore the request (the
			// auto-start retry stays armed and tries again once the object exists).
			if (spec.object) {
				input.send({ type: 'start', spec })
				// A start actually shipped — disarm auto-start so the retry loop stops
				// and a later pause isn't overridden. Reset re-arms it.
				autoStartAtom.set(false)
			}
		} else {
			// A stop request. The panel's pause button also disarms auto-start (so a
			// pause STAYS paused); reset leaves it armed so the sim auto-restarts on the
			// fresh layout. Disarming is the caller's job, not this shared handler's.
			input.send({ type: 'stop' })
		}
		playIntentAtom.set(null) // consume the request
	}, [intent, editor, input])

	// Auto-start: the sim runs by DEFAULT on first load and after a reset. This
	// fires ONLY while the auto-start latch is armed (autoStartAtom) — a deliberate
	// pause from the panel disarms it, so pausing STAYS paused instead of being
	// re-started here. We retry on an interval because the input socket may not be
	// open on the first pass; once we've kicked off a start we disarm the latch so
	// the retry stops fighting a later pause. Reset re-arms it. (A late joiner into
	// an already-running room gets playing=true from the DO and never enters here.)
	const autoStart = useValue('am-autoStart', () => autoStartAtom.get(), [])
	useEffect(() => {
		if (playing || !autoStart) return
		const tryStart = () => {
			if (!input.isOpen()) return
			playIntentAtom.set('start')
		}
		tryStart()
		const id = setInterval(tryStart, 250)
		return () => clearInterval(id)
	}, [playing, autoStart, input])

	// Suppress the blue hover/selection indicator while playing. The authored object
	// is hidden (opacity 0) but its geometry is still hit-tested, so moving the pointer
	// over it makes tldraw set `hoveredShapeId` and draw the hover outline over the
	// posed body. We block that at the source: a before-change handler on the page
	// state strips `hoveredShapeId` whenever the sim is playing (checking the live
	// atom, not a stale closure) so the indicator never gets written. Registered once;
	// returns tldraw's cleanup.
	useEffect(() => {
		return editor.sideEffects.registerBeforeChangeHandler('instance_page_state', (_prev, next) => {
			if (playingAtom.get() && next.hoveredShapeId) {
				return { ...next, hoveredShapeId: null }
			}
			return next
		})
	}, [editor])

	// React to the NETWORK play-state. Hide the authored object shape while playing
	// (the overlay draws the posed body); unhide it on stop.
	//
	// NOTE: locking the canvas is NOT done here via `isReadonly` — the store comes
	// from @tldraw/sync, whose collaboration mode runs a reactive effect that forces
	// instanceState.isReadonly back to match the sync mode (readwrite), so any
	// `updateInstanceState({ isReadonly: true })` here is immediately overwritten.
	// The walls are locked at the POINTER instead (capture-phase pointerdown in
	// useInput.ts claims every event while playing). So updateShape works normally
	// regardless of play-state — no readonly ordering to dance around.
	useEffect(() => {
		const objId = getObjectShapeId(editor)
		if (!objId) return
		editor.run(
			() => {
				const s = editor.getShape(objId)
				if (!s) return
				// Non-literal `type` → cast the partial (repo CLAUDE.md union gotcha).
				editor.updateShape({ id: objId, type: s.type, opacity: playing ? 0 : 1 } as TLShapePartial)
				if (playing) editor.selectNone()
			},
			{ history: 'ignore' }
		)
	}, [editor, playing])

	return null
}
