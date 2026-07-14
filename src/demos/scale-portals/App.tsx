import { useCallback, useMemo, useRef, useState } from 'react'
import { Tldraw, type Editor, type TLComponents } from 'tldraw'
import 'tldraw/tldraw.css'
import { TLDRAW_LICENSE_KEY } from '../licenseKey'
import { registerGame, DEFAULT_CONFIG, type GameHandle } from './game/gameLoop'
import { registerKeyState } from './game/keys'
import { ZOOM_STEPS } from './game/constants'
import { PlayerSnail } from './game/PlayerSnail'
import { WorldControls } from './game/WorldControls'
import type { PatternName } from './game/patterns'

/** A NEW world generates every start; `?seed=<number>` reproduces a specific one
 *  (the seed is logged to the console on every start for sharing). */
function seedFromUrl(): number | undefined {
	const raw = new URLSearchParams(window.location.search).get('seed')
	if (raw == null) return undefined
	const seed = Number(raw)
	return Number.isFinite(seed) ? seed >>> 0 : undefined
}

export default function App() {
	// The live game handle (set on mount) lets the pattern buttons rebuild the world in place.
	const gameRef = useRef<GameHandle | null>(null)
	const [pattern, setPattern] = useState<PatternName>(DEFAULT_CONFIG.pattern)

	const handleMount = useCallback((editor: Editor) => {
		editor.setCurrentTool('select')
		editor.updateInstanceState({ isReadonly: false })
		// Widen the zoom range past tldraw's native 800% max so the deepest scale
		// (framed at ~894%, see MAX_DEPTH in constants.ts) can be reached by zoomToBounds.
		editor.setCameraOptions({ ...editor.getCameraOptions(), zoomSteps: ZOOM_STEPS })
		const keys = registerKeyState()
		const game = registerGame(editor, keys, { seed: seedFromUrl(), config: DEFAULT_CONFIG })
		gameRef.current = game
		if (import.meta.env.DEV) (window as unknown as { __editor: Editor }).__editor = editor
		return () => {
			game.dispose()
			gameRef.current = null
			keys.dispose()
		}
	}, [])

	// Rebuild the whole nested world under the picked pattern (same seed → comparable worlds).
	const onPick = useCallback((next: PatternName) => {
		setPattern(next)
		gameRef.current?.regenerate({ pattern: next })
	}, [])

	// This demo is a game level, not a drawing canvas: hide the tool/style UI so there's no
	// tool-switching surface (and no way for a stray WASD press to flip tldraw's active tool).
	// PlayerSnail paints the snail over the (invisible) player; WorldControls is the pattern picker.
	const components: TLComponents = useMemo(
		() => ({
			Toolbar: null,
			StylePanel: null,
			InFrontOfTheCanvas: () => (
				<>
					<PlayerSnail />
					<WorldControls pattern={pattern} onPick={onPick} />
				</>
			),
		}),
		[pattern, onPick]
	)

	return (
		<div style={{ position: 'fixed', inset: 0 }}>
			<Tldraw licenseKey={TLDRAW_LICENSE_KEY} components={components} onMount={handleMount} />
		</div>
	)
}
