/**
 * Engine — a drag-and-drop game builder on tldraw v5 (native-first).
 *
 * There is no custom shape: every element is a native tldraw geo shape whose
 * color names its role (see game/roles.ts). Elements are added from the left
 * drag-and-drop tray (render/Tray.tsx, mounted via components); press Play and a
 * GameRuntime (game/engine.ts) reads the level off the canvas and runs a
 * platformer sim. A default level loads on first visit; Reset rebuilds it.
 *
 * The `components` object is a module-level const (stable identity) so the tray
 * never remounts; the tray reads play state from game/state.ts → playingAtom.
 */
import { useCallback, useRef, useState } from 'react'
import { DefaultStylePanel, Tldraw, useValue, type TLComponents, type Editor } from 'tldraw'
import 'tldraw/tldraw.css'
import { Tray } from './render/Tray'
import { PlayerToolbar } from './render/PlayerToolbar'
import { PhysicsPanel } from './render/PhysicsPanel'
import { GameRuntime, type GameState } from './game/engine'
import { loadLevel } from './game/level'
import { playingAtom, tunablesAtom } from './game/state'
import { makeTunables } from './game/physics'
import './App.css'

// InFrontOfTheCanvas takes a single component; render both the drag tray and the
// "Set as Player" contextual toolbar. Module-level const → stable identity, so
// the layer never remounts (see this file's header).
function InFront() {
  return (
    <>
      <Tray />
      <PlayerToolbar />
      <PhysicsPanel />
    </>
  )
}

// During play the physics panel sits top-right, exactly where tldraw's style
// panel lives — and styling shapes mid-play is meaningless anyway. So hide the
// style panel while playing; otherwise it's the stock one.
function StylePanel() {
  const playing = useValue('style panel: playing', () => playingAtom.get(), [])
  if (playing) return null
  return <DefaultStylePanel />
}

const components: TLComponents = {
  InFrontOfTheCanvas: InFront,
  StylePanel,
}

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
    // Start each session from the shipped "tight & snappy" defaults (the atom is
    // module-global, so a previous session's live edits would otherwise linger).
    tunablesAtom.set(makeTunables())
    runtimeRef.current = new GameRuntime(editor, setState)
    // First visit (empty canvas) starts on the default level. An existing (saved)
    // canvas is left as the player left it — Reset is how you get back here.
    if (editor.getCurrentPageShapes().length === 0) {
      loadLevel(editor, undefined, true)
    }
    if (import.meta.env.DEV) {
      ;(window as unknown as { __editor?: Editor }).__editor = editor
    }
    return () => {
      runtimeRef.current?.stop()
      runtimeRef.current = null
      playingAtom.set(false)
    }
  }, [])

  const handleReset = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    runtimeRef.current?.stop()
    playingAtom.set(false)
    setPlaying(false)
    setState(IDLE)
    setNoPlayer(false)
    loadLevel(editor)
  }, [])

  const togglePlay = useCallback(() => {
    const rt = runtimeRef.current
    if (!rt) return
    if (rt.isPlaying) {
      rt.stop()
      playingAtom.set(false)
      setPlaying(false)
      setState(IDLE)
      return
    }
    setNoPlayer(false)
    if (!rt.start()) {
      setNoPlayer(true)
      return
    }
    playingAtom.set(true)
    setPlaying(true)
  }, [])

  const won = playing && state.status === 'won'

  return (
    <div className="eng-root">
      <Tldraw persistenceKey="tlArcade-engine-native" components={components} onMount={handleMount} />

      <div className="eng-topbar">
        <button
          className={playing ? 'eng-btn eng-stop' : 'eng-btn eng-play'}
          onClick={togglePlay}
          title={playing ? 'Stop' : 'Play'}
        >
          {playing ? '■ Stop' : '▶ Play'}
        </button>
        <button className="eng-btn eng-reset" onClick={handleReset} title="Reset to the default level">
          ↺ Reset
        </button>
        {playing && (
          <>
            <span className="eng-stat">
              {state.total > 0 ? `⭐ ${state.collected}/${state.total}` : 'No tokens'}
              {state.deaths > 0 ? ` · 💀 ${state.deaths}` : ''}
            </span>
            <span className="eng-controls">← → move · ↑ jump</span>
          </>
        )}
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
