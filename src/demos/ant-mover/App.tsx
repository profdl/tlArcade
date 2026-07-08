import { useCallback, useRef } from 'react'
import { Tldraw, type TLComponents, type Editor, useValue, Box as TLBox } from 'tldraw'
import 'tldraw/tldraw.css'
import { Field } from './game/Field'
import { RunController } from './game/RunController'
import { FIELD } from './game/geometry'
import { designateObject } from './game/shapes'
import { playingAtom, resetNonceAtom, scriptedCountAtom } from './game/state'
import './App.css'

// The overlay + sim driver render on top of the canvas. Defined ONCE at module
// scope (stable identity) so tldraw never remounts them — gameplay state flows
// through atoms, not props (see state.ts / the tlarcade-do-realtime-sim skill).
// RunController renders nothing; it owns the sim loop and input.
const components: TLComponents = {
	InFrontOfTheCanvas: () => (
		<>
			<RunController />
			<Field />
		</>
	),
}

// Scripted-grabber counts the dev toggle cycles through.
const SCRIPTED_STEPS = [0, 1, 3, 10, 50]

function App() {
	const playing = useValue('am-playing', () => playingAtom.get(), [])
	const scripted = useValue('am-scripted', () => scriptedCountAtom.get(), [])
	const editorRef = useRef<Editor | null>(null)

	const handleMount = useCallback((editor: Editor) => {
		editorRef.current = editor
		editor.user.updateUserPreferences({ colorScheme: 'light' })
		editor.zoomToBounds(
			new TLBox(FIELD.minX, FIELD.minY, FIELD.maxX - FIELD.minX, FIELD.maxY - FIELD.minY),
			{ inset: 40, animation: { duration: 0 } }
		)
	}, [])

	// Author-mode action: tag the single selected shape as the movable object.
	const handleSetObject = useCallback(() => {
		const editor = editorRef.current
		if (!editor) return
		const selected = editor.getSelectedShapeIds()
		if (selected.length === 1) designateObject(editor, selected[0])
	}, [])

	return (
		<div className="am-root">
			<Tldraw
				persistenceKey="tlArcade-ant-mover"
				components={components}
				onMount={handleMount}
			/>
			<div className="am-panel">
				<span className="am-title">Ant-Mover</span>
				<button
					className={playing ? 'am-btn am-stop' : 'am-btn am-play'}
					onClick={() => playingAtom.update((p) => !p)}
					title={playing ? 'Pause' : 'Play'}
				>
					{playing ? '❚❚' : '▶'}
				</button>
				<button
					className="am-btn"
					title="Reset the piece to its start"
					onClick={() => resetNonceAtom.update((n) => n + 1)}
				>
					↺
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
					className="am-btn am-scripted"
					title="Dev: cycle the number of scripted grabbers pulling toward the exit"
					onClick={() =>
						scriptedCountAtom.set(
							SCRIPTED_STEPS[(SCRIPTED_STEPS.indexOf(scripted) + 1) % SCRIPTED_STEPS.length] ?? 0
						)
					}
				>
					🤖 {scripted}
				</button>
				<small className="am-hint">
					{playing
						? 'grab the object anywhere and drag it through the gap'
						: 'draw a maze + object, ★ set the object, then press play'}
				</small>
			</div>
		</div>
	)
}

export default App
