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
import { Tldraw, type TLComponents, type Editor, useValue } from 'tldraw'
import 'tldraw/tldraw.css'
import { Field } from '../game/Field'
import { RunController } from '../game/RunController'
import { WinWatcher } from '../game/WinWatcher'
import { FIELD } from '../game/geometry'
import { resetGame } from '../game/seed'
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
			<WinWatcher />
		</>
	),
	// Ant-mover is a GAME, not an editor: hide the native tldraw editing UI. The
	// game's own controls live in the .am-panel. `null` hides a slot (see the
	// tldraw component-slots docs).
	Toolbar: null, // bottom tool selector (select/draw/shapes/…)
	StylePanel: null, // top-right style/settings panel for the selection
	MenuPanel: null, // top-left menu cluster (main menu + page menu)
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
		// Default zoom = 50%, centred on the field (shifted left to keep the off-field
		// "Drag" hint in frame). tldraw's camera maps screen = (page + camera) * z, so
		// to centre page point (cx,cy) in the viewport at zoom z:
		// camera = viewportCenterScreen / z - (cx,cy).
		const z = 0.5
		const cx = (FIELD.minX + FIELD.maxX) / 2 - 130 // bias left for the Drag hint
		const cy = (FIELD.minY + FIELD.maxY) / 2
		const vsb = editor.getViewportScreenBounds()
		editor.setCamera(
			{ x: vsb.w / 2 / z - cx, y: vsb.h / 2 / z - cy, z },
			{ animation: { duration: 0 } }
		)
	}, [])

	// Wipe the page and rebuild the default puzzle (maze + T + flag), then
	// auto-restart the sim on the fresh layout. Shared with the win dialog's reset.
	const handleReset = useCallback(() => {
		const editor = editorRef.current
		if (!editor) return
		resetGame(editor)
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
					title="Reset the scene to the default puzzle and restart the sim (clears all edits)"
					onClick={handleReset}
				>
					↺ Play Again
				</button>
				<CopyLinkButton />
				{!playing && <small className="am-hint">paused — edit the walls, then press play</small>}
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
