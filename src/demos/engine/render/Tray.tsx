/**
 * Engine — the left drag-and-drop tray.
 *
 * Adapted from tldraw's official "Drag and drop tray" example: a custom UI
 * mounted via components.InFrontOfTheCanvas that uses pointer capture + a small
 * drag state machine, then on release converts the screen point to a page point
 * (`editor.screenToPage`) and creates the shape. Here each tray item drops a
 * native, labelled geo shape for its role (see game/roles.ts → shapeForRole).
 *
 * The tray hides while a game is running (reads game/state.ts → playingAtom).
 */
import { useMemo, useRef } from 'react'
import { Box, Vec, useAtom, useEditor, useQuickReactor, useValue } from 'tldraw'
import { ROLE_LIST, ROLES, shapeForRole, type Role } from '../game/roles'
import { RoleIcon } from './icons'
import { playingAtom } from '../game/state'

type DragState =
  | { name: 'idle' }
  | { name: 'pointing'; role: Role; start: Vec }
  | { name: 'dragging'; role: Role; current: Vec }

export function Tray() {
  const editor = useEditor()
  const playing = useValue('playing', () => playingAtom.get(), [])
  const rDragImage = useRef<HTMLDivElement>(null)
  // The tray item currently captured for a drag. A ref (not a closure `let`) so
  // the memoized handlers can share it without reassigning a captured variable.
  const rTarget = useRef<HTMLDivElement | null>(null)
  const dragState = useAtom<DragState>('engine:trayDrag', { name: 'idle' })

  const { handlePointerDown, handlePointerUp } = useMemo(() => {
    function handlePointerMove(e: PointerEvent) {
      const current = dragState.get()
      const screen = new Vec(e.clientX, e.clientY)
      if (current.name === 'pointing') {
        if (Vec.Dist(screen, current.start) > 10) {
          dragState.set({ name: 'dragging', role: current.role, current: screen })
        }
      } else if (current.name === 'dragging') {
        dragState.set({ ...current, current: screen })
      }
    }

    function cleanup() {
      rTarget.current?.removeEventListener('pointermove', handlePointerMove)
      rTarget.current = null
      dragState.set({ name: 'idle' })
    }

    function handlePointerDown(e: React.PointerEvent) {
      if (playingAtom.get()) return
      e.preventDefault()
      const target = e.currentTarget as HTMLDivElement
      rTarget.current = target
      target.setPointerCapture(e.pointerId)
      const role = target.dataset.role as Role
      dragState.set({ name: 'pointing', role, start: new Vec(e.clientX, e.clientY) })
      target.addEventListener('pointermove', handlePointerMove)
    }

    function handlePointerUp(e: React.PointerEvent) {
      const current = dragState.get()
      const t = e.currentTarget as HTMLDivElement
      t.releasePointerCapture(e.pointerId)
      if (current.name === 'dragging') {
        // Drop only counts if released over the canvas, not back on the tray.
        const trayEl = t.closest('.eng-tray') as HTMLElement | null
        const r = trayEl?.getBoundingClientRect()
        const overTray =
          r != null &&
          Box.ContainsPoint(new Box(r.x, r.y, r.width, r.height), new Vec(e.clientX, e.clientY))
        if (!overTray) {
          const page = editor.screenToPage(new Vec(e.clientX, e.clientY))
          const { size } = ROLES[current.role]
          editor.markHistoryStoppingPoint('drop element')
          editor.createShape({
            ...shapeForRole(current.role),
            x: page.x - size.w / 2,
            y: page.y - size.h / 2,
          })
        }
      }
      cleanup()
    }

    return { handlePointerDown, handlePointerUp }
  }, [dragState, editor, rTarget])

  // The floating "ghost" that follows the cursor while dragging over the canvas.
  useQuickReactor(
    'engine:dragGhost',
    () => {
      const s = dragState.get()
      const el = rDragImage.current
      if (!el) return
      if (s.name !== 'dragging') {
        el.style.display = 'none'
        return
      }
      const vb = editor.getViewportScreenBounds()
      el.style.display = 'flex'
      el.style.transform = `translate(${s.current.x - vb.x - 24}px, ${s.current.y - vb.y - 24}px)`
    },
    [dragState, editor],
  )

  const state = useValue('trayDrag', () => dragState.get(), [dragState])
  if (playing) return null

  return (
    <>
      <div className="eng-tray">
        {ROLE_LIST.map((role) => (
          <div
            key={role}
            className="eng-tray-item"
            data-role={role}
            title={`Drag to add a ${ROLES[role].label}`}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
          >
            <RoleIcon role={role} />
            <span className="eng-tray-label">{ROLES[role].label}</span>
          </div>
        ))}
      </div>
      <div className="eng-drag-ghost" ref={rDragImage}>
        {state.name === 'dragging' ? <RoleIcon role={state.role} size={44} /> : null}
      </div>
    </>
  )
}
