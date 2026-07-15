// The ant-mover game room: a synced tldraw canvas + the sim overlay + the control
// panel. Multiplayer, mirroring the Toolkit:
//  - useSync connects the store to the room's DO over /api/am/connect/:roomId, so
//    the authored maze + which shape is the object are shared/edited by everyone.
//  - onCustomMessageReceived is the ONE downstream out-of-band channel: the DO
//    pushes the per-tick pose + ropes + play-state here (netPose.ts → atoms).
//  - the room id is in the URL, so "Copy link" IS the invite.
//
// The high-frequency pose does NOT ride the store (it's transient, not document
// state); it comes through the custom-message channel and is interpolated for
// display. Input (grabs + start/stop) rides a SEPARATE input socket, opened inside
// RunController (see useInput.ts) — the sync socket can't carry client→server data.

import { useSync } from '@tldraw/sync'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
	Tldraw,
	type TLComponents,
	type Editor,
	useValue,
	Box as TLBox,
} from 'tldraw'
import 'tldraw/tldraw.css'
import { Field } from '../game/Field'
import { RunController } from '../game/RunController'
import { FIELD } from '../game/geometry'
import { designateObject } from '../game/shapes'
import { resetToDefaultLayout } from '../game/seed'
import { playingAtom, playIntentAtom, autoStartAtom } from '../game/state'
import { onAmServerMessage, startPoseInterpolation } from '../game/netPose'
import { multiplayerAssetStore } from '../multiplayerAssetStore'
import { TLDRAW_LICENSE_KEY } from '../../licenseKey'

// The overlay + sim driver render on top of the canvas. Defined ONCE at module
// scope (stable identity) so tldraw never remounts them — gameplay state flows
// through atoms, not props (see game/state.ts / the tlarcade-do-realtime-sim
// skill rule 6: an inline `components` remounts the overlay and resets interp).
// RunController renders nothing; it owns the input socket + run lifecycle.
const components: TLComponents = {
	InFrontOfTheCanvas: () => (
		<>
			<RunController />
			<Field />
		</>
	),
}

export function Room() {
	const { roomId } = useParams<{ roomId: string }>()
	const playing = useValue('am-playing', () => playingAtom.get(), [])
	const editorRef = useRef<Editor | null>(null)

	// Connect the store to multiplayer. tldraw DEFAULT shapes only (the DO's schema
	// matches), so no custom shapeUtils. The custom-message handler is the pose/
	// play-state receive path.
	const store = useSync({
		uri: `${window.location.origin}/api/am/connect/${roomId}`,
		assets: multiplayerAssetStore,
		onCustomMessageReceived: onAmServerMessage,
	})

	// Drive the display-rate pose interpolation while the room is mounted.
	useEffect(() => startPoseInterpolation(), [])

	const handleMount = useCallback((editor: Editor) => {
		editorRef.current = editor
		editor.user.updateUserPreferences({ colorScheme: 'light' })
		editor.zoomToBounds(
			new TLBox(FIELD.minX, FIELD.minY, FIELD.maxX - FIELD.minX, FIELD.maxY - FIELD.minY),
			{ inset: 40, animation: { duration: 0 } }
		)
	}, [])

	// Author-mode action: tag the single selected shape as the movable object. Syncs
	// to all players through the store (meta.amRole).
	const handleSetObject = useCallback(() => {
		const editor = editorRef.current
		if (!editor) return
		const selected = editor.getSelectedShapeIds()
		if (selected.length === 1) designateObject(editor, selected[0])
	}, [])

	// Wipe the page and rebuild the default puzzle (maze + T), then auto-restart.
	// Stop the current DO run first so it rebuilds from the fresh spec, re-arm
	// auto-start so RunController immediately restarts the sim on the new layout,
	// and reseed. The canvas isn't read-only (the sync layer keeps it readwrite; play
	// mode is gated at the pointer, not via isReadonly), so the reseed applies even
	// mid-run. The synced store propagates the reset + restart to every player.
	const handleReset = useCallback(() => {
		const editor = editorRef.current
		if (!editor) return
		autoStartAtom.set(true) // re-arm so the sim auto-restarts on the fresh layout
		playIntentAtom.set('stop')
		resetToDefaultLayout(editor)
	}, [])

	return (
		<div className="am-root">
			<Tldraw
				store={store}
				licenseKey={TLDRAW_LICENSE_KEY}
				components={components}
				onMount={handleMount}
			/>
			<div className="am-panel">
				<span className="am-title">Ant-Mover</span>
				<button
					className={playing ? 'am-btn am-stop' : 'am-btn am-play'}
					// Request play/stop; the server flips playingAtom back over the network.
					// Pausing DISARMS auto-start so it stays paused; playing re-arms it so
					// the retry loop can start the run once the input socket is open.
					onClick={() => {
						autoStartAtom.set(!playing)
						playIntentAtom.set(playing ? 'stop' : 'start')
					}}
					title={playing ? 'Stop' : 'Play'}
				>
					{playing ? '❚❚' : '▶'}
				</button>
				<button
					className="am-btn"
					disabled={playing}
					title="Designate the selected shape as the object to move (author mode)"
					onClick={handleSetObject}
				>
					★ set object
				</button>
				<button
					className="am-btn"
					title="Reset the scene to the default puzzle and restart the sim (clears all edits)"
					onClick={handleReset}
				>
					↺ reset
				</button>
				<CopyLinkButton />
				<small className="am-hint">
					{playing
						? 'grab the object anywhere and drag it through the gap'
						: 'paused — edit the walls, then press play'}
				</small>
			</div>
		</div>
	)
}

/** Copy the current room URL — the invite. Shows a brief "Copied!" confirmation. */
function CopyLinkButton() {
	const [copied, setCopied] = useState(false)
	useEffect(() => {
		if (!copied) return
		const t = setTimeout(() => setCopied(false), 2000)
		return () => clearTimeout(t)
	}, [copied])
	return (
		<button
			className="am-btn"
			title="Copy this room's link to invite others"
			onClick={() => {
				navigator.clipboard.writeText(window.location.href)
				setCopied(true)
			}}
		>
			{copied ? '✓ copied' : '🔗 invite'}
		</button>
	)
}
