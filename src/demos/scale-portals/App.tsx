import { useCallback } from 'react'
import { Tldraw, type Editor, type TLComponents } from 'tldraw'
import 'tldraw/tldraw.css'
import { registerGame } from './game/gameLoop'
import { registerKeyState } from './game/keys'

// This demo is a game level, not a drawing canvas: hide the tool/style UI so
// there's no tool-switching surface (and no way for a stray WASD press to flip
// tldraw's active tool). Movement keys are also guarded in keys.ts.
const components: TLComponents = { Toolbar: null, StylePanel: null }

export default function App() {
	const handleMount = useCallback((editor: Editor) => {
		editor.setCurrentTool('select')
		editor.updateInstanceState({ isReadonly: false })
		const keys = registerKeyState()
		const stopGame = registerGame(editor, keys)
		if (import.meta.env.DEV) (window as unknown as { __editor: Editor }).__editor = editor
		return () => {
			stopGame()
			keys.dispose()
		}
	}, [])

	return (
		<div style={{ position: 'fixed', inset: 0 }}>
			<Tldraw components={components} onMount={handleMount} />
		</div>
	)
}
