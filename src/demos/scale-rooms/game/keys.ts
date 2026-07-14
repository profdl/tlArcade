/**
 * KEYS — a tiny keyboard-state tracker for WASD + arrow movement.
 * ================================================================
 * A plain `Set` of currently-held movement keys, read fresh every tick by the game
 * loop (so a key held THROUGH a portal transition keeps driving movement in the new
 * level — no per-transition reset needed).
 *
 * For exactly the keys we own we call preventDefault + stopPropagation so a bare
 * `keydown` can't ALSO trigger tldraw's own single-letter tool shortcuts (e.g. "d"
 * → draw tool). Registered under <Tldraw onMount> and disposed with everything else.
 */

const MOVEMENT_KEYS = new Set([
	'w', 'a', 's', 'd',
	'arrowup', 'arrowdown', 'arrowleft', 'arrowright',
])

export type KeyState = {
	isDown: (key: string) => boolean
	/** Net movement direction from held keys, each axis in {-1, 0, 1} (unnormalised). */
	axis: () => { x: number; y: number }
	dispose: () => void
}

export function registerKeyState(): KeyState {
	const down = new Set<string>()

	const onKeyDown = (e: KeyboardEvent) => {
		const key = e.key.toLowerCase()
		if (!MOVEMENT_KEYS.has(key)) return
		e.preventDefault()
		e.stopPropagation()
		down.add(key)
	}
	const onKeyUp = (e: KeyboardEvent) => {
		const key = e.key.toLowerCase()
		if (!MOVEMENT_KEYS.has(key)) return
		e.preventDefault()
		e.stopPropagation()
		down.delete(key)
	}
	// If the window loses focus mid-move, the matching keyup lands elsewhere and never
	// clears the key — leaving the player drifting forever. Drop all held keys on blur.
	const onBlur = () => down.clear()

	// Capture phase so we intercept before tldraw's document-level shortcut handlers.
	window.addEventListener('keydown', onKeyDown, { capture: true })
	window.addEventListener('keyup', onKeyUp, { capture: true })
	window.addEventListener('blur', onBlur)

	const isDown = (key: string) => down.has(key)

	return {
		isDown,
		axis: () => ({
			x: (isDown('d') || isDown('arrowright') ? 1 : 0) - (isDown('a') || isDown('arrowleft') ? 1 : 0),
			y: (isDown('s') || isDown('arrowdown') ? 1 : 0) - (isDown('w') || isDown('arrowup') ? 1 : 0),
		}),
		dispose: () => {
			window.removeEventListener('keydown', onKeyDown, { capture: true })
			window.removeEventListener('keyup', onKeyUp, { capture: true })
			window.removeEventListener('blur', onBlur)
			down.clear()
		},
	}
}
