// A left-side tray of draggable track-piece presets, adapted from tldraw's
// "drag and drop tray" example (tldraw.dev/examples/ui/drag-and-drop-tray).
// Dropping an item creates a native shape at the drop point — no custom shape
// or tool, per this repo's native-first contract (CLAUDE.md).
import { useMemo, useRef } from 'react'
import { Box, useAtom, useEditor, useQuickReactor, useValue, Vec } from 'tldraw'
import { TRAY_ITEMS, type TrayItem } from './trayItems'
import { playingAtom } from './state'

type DragState =
	| { name: 'idle' }
	| { name: 'pointing_item'; item: TrayItem; startPosition: Vec }
	| { name: 'dragging'; item: TrayItem; currentPosition: Vec }

export function ShapeTray() {
	const rTrayContainer = useRef<HTMLDivElement>(null)
	const rDraggingPreview = useRef<HTMLDivElement>(null)

	const editor = useEditor()
	const playing = useValue('lrm-tray-playing', () => playingAtom.get(), [])

	const dragState = useAtom<DragState>('lrm-tray-dragState', () => ({ name: 'idle' }))

	const { handlePointerDown, handlePointerUp } = useMemo(() => {
		let target: HTMLDivElement | null = null

		function handlePointerMove(e: PointerEvent) {
			const current = dragState.get()
			const screenPoint = new Vec(e.clientX, e.clientY)

			switch (current.name) {
				case 'idle':
					break
				case 'pointing_item': {
					// Ignore small jitter so a plain click doesn't register as a drag.
					if (Vec.Dist(screenPoint, current.startPosition) > 10) {
						dragState.set({ name: 'dragging', item: current.item, currentPosition: screenPoint })
					}
					break
				}
				case 'dragging':
					dragState.set({ ...current, currentPosition: screenPoint })
					break
			}
		}

		function handleKeyDown(e: KeyboardEvent) {
			if (e.key === 'Escape' && dragState.get().name === 'dragging') removeEventListeners()
		}

		function removeEventListeners() {
			if (target) {
				target.removeEventListener('pointermove', handlePointerMove)
				document.removeEventListener('keydown', handleKeyDown)
			}
			dragState.set({ name: 'idle' })
		}

		function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
			e.preventDefault()
			target = e.currentTarget
			target.setPointerCapture(e.pointerId)

			const index = target.dataset.trayItemIndex
			const item = index !== undefined ? TRAY_ITEMS[+index] : undefined
			if (!item) return

			dragState.set({ name: 'pointing_item', item, startPosition: new Vec(e.clientX, e.clientY) })
			target.addEventListener('pointermove', handlePointerMove)
			document.addEventListener('keydown', handleKeyDown)
		}

		function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
			const current = dragState.get()
			target = e.currentTarget
			target.releasePointerCapture(e.pointerId)

			if (current.name === 'dragging') {
				const pagePoint = editor.screenToPage(new Vec(e.clientX, e.clientY))
				editor.markHistoryStoppingPoint('create shape from tray')
				current.item.create(editor, pagePoint)
			}

			removeEventListeners()
		}

		return { handlePointerDown, handlePointerUp }
	}, [dragState, editor])

	const state = useValue('lrm-tray-dragState-read', () => dragState.get(), [dragState])

	// Follow the cursor with a preview swatch once a drag has left the tray, and
	// hide it again over the tray itself (dropping there is a no-op cancel).
	useQuickReactor(
		'lrm-tray-drag-preview',
		() => {
			const current = dragState.get()
			const preview = rDraggingPreview.current
			const trayEl = rTrayContainer.current
			if (!preview || !trayEl) return

			if (current.name !== 'dragging') {
				preview.style.display = 'none'
				return
			}

			const trayRect = trayEl.getBoundingClientRect()
			const trayBox = new Box(trayRect.x, trayRect.y, trayRect.width, trayRect.height)
			if (Box.ContainsPoint(trayBox, current.currentPosition)) {
				preview.style.display = 'none'
				return
			}

			const viewport = editor.getViewportScreenBounds()
			preview.style.display = 'flex'
			preview.style.transform = `translate(${current.currentPosition.x - viewport.x - 45}px, ${current.currentPosition.y - viewport.y - 7}px)`
			preview.style.background = current.item.swatch
		},
		[dragState]
	)

	if (playing) return null

	return (
		<>
			<div className="lrm-tray" ref={rTrayContainer}>
				{TRAY_ITEMS.map((item, index) => (
					<div
						key={item.id}
						className="lrm-tray-item"
						data-tray-item-index={index}
						onPointerDown={handlePointerDown}
						onPointerUp={handlePointerUp}
					>
						<span className="lrm-tray-swatch" style={{ background: item.swatch }} />
						<small>{item.label}</small>
					</div>
				))}
			</div>
			<div className="lrm-tray-preview" ref={rDraggingPreview}>
				{state.name === 'dragging' ? <span>{state.item.label}</span> : null}
			</div>
		</>
	)
}
