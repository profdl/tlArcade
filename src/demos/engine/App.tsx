/**
 * Engine — a drag-and-drop game builder on tldraw v5.
 *
 * Drop elements from the tray (player / wall / token / hazard / goal), arrange
 * them, then press Play to test-drive a platformer. Native geo/draw/line shapes
 * double as solid terrain, so you can literally draw your level.
 *
 * The shell here is thin: it mounts <Tldraw> with the one custom shape
 * (EntityShapeUtil), renders the tray + HUD outside the canvas, and owns a
 * GameRuntime (game/engine.ts) that runs the sim during Play.
 */
import { useCallback, useRef, useState } from 'react'
import { Tldraw, createShapeId, type Editor } from 'tldraw'
import 'tldraw/tldraw.css'
import { EntityShapeUtil } from './render/EntityShapeUtil'
import { GameRuntime, type GameState } from './game/engine'
import { ROLES, ROLE_LIST, type Role } from './game/roles'
import './App.css'

const shapeUtils = [EntityShapeUtil]

const IDLE: GameState = { status: 'playing', collected: 0, total: 0, deaths: 0 }

export default function App() {
  const editorRef = useRef<Editor | null>(null)
  const runtimeRef = useRef<GameRuntime | null>(null)
  const [playing, setPlaying] = useState(false)
  const [state, setState] = useState<GameState>(IDLE)
  const [noPlayer, setNoPlayer] = useState(false)

  const handleMount = useCallback((editor: Editor) => {
    editorRef.current = editor
    editor.user.updateUserPreferences({ colorScheme: 'light' })
    runtimeRef.current = new GameRuntime(editor, setState)
    if (import.meta.env.DEV) {
      ;(window as unknown as { __editor?: Editor }).__editor = editor
    }
    return () => {
      runtimeRef.current?.stop()
      runtimeRef.current = null
    }
  }, [])

  // Drop a fresh element at the center of the current viewport.
  const drop = useCallback((role: Role) => {
    const editor = editorRef.current
    if (!editor || playing) return
    const def = ROLES[role]
    const c = editor.getViewportPageBounds().center
    const id = createShapeId()
    editor.run(() => {
      editor.createShape({
        id,
        type: 'gameEntity',
        x: c.x - def.size.w / 2,
        y: c.y - def.size.h / 2,
        props: { w: def.size.w, h: def.size.h, role },
      })
      editor.select(id)
    })
  }, [playing])

  const togglePlay = useCallback(() => {
    const rt = runtimeRef.current
    if (!rt) return
    if (rt.isPlaying) {
      rt.stop()
      setPlaying(false)
      setState(IDLE)
      return
    }
    setNoPlayer(false)
    const ok = rt.start()
    if (!ok) {
      setNoPlayer(true)
      return
    }
    setPlaying(true)
  }, [])

  const won = playing && state.status === 'won'

  return (
    <div className="eng-root">
      <Tldraw persistenceKey="tlArcade-engine" shapeUtils={shapeUtils} onMount={handleMount} />

      <div className="eng-tray">
        <button
          className={playing ? 'eng-btn eng-stop' : 'eng-btn eng-play'}
          onClick={togglePlay}
          title={playing ? 'Stop' : 'Play'}
        >
          {playing ? '■ Stop' : '▶ Play'}
        </button>
        <div className="eng-divider" />
        {ROLE_LIST.map((role) => (
          <button
            key={role}
            className="eng-btn eng-tool"
            disabled={playing}
            title={`Add ${ROLES[role].label}`}
            onClick={() => drop(role)}
          >
            <span className="eng-emoji">{ROLES[role].emoji}</span>
            {ROLES[role].label}
          </button>
        ))}
        {playing && (
          <>
            <div className="eng-divider" />
            <span className="eng-stat">
              {state.total > 0 ? `⭐ ${state.collected}/${state.total}` : 'No tokens'}
              {state.deaths > 0 ? ` · 💀 ${state.deaths}` : ''}
            </span>
          </>
        )}
      </div>

      <div className="eng-hint">
        {playing
          ? 'Move: ← → / A D · Jump: ↑ / W / Space'
          : 'Drop a 🙂 Player, some 🧱 Walls, then Play. Or draw walls with the pencil.'}
      </div>

      {noPlayer && (
        <div className="eng-toast" onAnimationEnd={() => setNoPlayer(false)}>
          Add a 🙂 Player first
        </div>
      )}

      {won && (
        <div className="eng-banner">
          <div className="eng-banner-title">🏁 You win!</div>
          <button className="eng-btn eng-play" onClick={togglePlay}>
            Back to editing
          </button>
        </div>
      )}
    </div>
  )
}
