import { useCallback } from 'react'
import { Tldraw, type TLComponents, type Editor, Box as TLBox } from 'tldraw'
import 'tldraw/tldraw.css'
import { Field } from './game/Field'
import { FIELD, T_SPAWN } from './game/geometry'
import { tPoseAtom } from './game/state'
import './App.css'

// The overlay renders on top of the canvas. Defined ONCE at module scope (stable
// identity) so tldraw never remounts it — gameplay state flows through atoms, not
// props (see state.ts and the tlarcade-do-realtime-sim skill).
const components: TLComponents = {
	InFrontOfTheCanvas: () => <Field />,
}

function App() {
	const handleMount = useCallback((editor: Editor) => {
		editor.user.updateUserPreferences({ colorScheme: 'light' })
		// Seed the static T pose at its spawn (step 1: no sim loop yet).
		tPoseAtom.set({ x: T_SPAWN.x, y: T_SPAWN.y, angle: 0 })
		// Frame the whole playfield so the maze + T are visible on load.
		editor.zoomToBounds(
			new TLBox(FIELD.minX, FIELD.minY, FIELD.maxX - FIELD.minX, FIELD.maxY - FIELD.minY),
			{ inset: 40, animation: { duration: 0 } }
		)
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
				<small className="am-hint">drag the T through the gap (grab coming in step 2)</small>
			</div>
		</div>
	)
}

export default App
