/**
 * Engine — a drag-and-drop game builder on tldraw v5 (native-first).
 *
 * There is no custom shape: every element is a native tldraw geo shape whose
 * color names its role (see game/roles.ts). Elements are added from the left
 * drag-and-drop tray (render/Tray.tsx, mounted via components); press Play and a
 * GameRuntime (game/engine.ts) reads the level off the canvas and runs a
 * platformer sim. A default level loads on first visit; Reset rebuilds it.
 * Restart (shown mid-play) re-runs the CURRENT level from its authored start.
 *
 * The `components` object is a module-level const (stable identity) so the tray
 * never remounts; the tray reads play state from game/state.ts → playingAtom.
 */
import { useCallback, useRef, useState } from 'react'
import {
  DefaultHelperButtons,
  DefaultMainMenu,
  DefaultStylePanel,
  Tldraw,
  TldrawUiMenuGroup,
  TldrawUiMenuItem,
  TldrawUiMenuSubmenu,
  useValue,
  type TLComponents,
  type TLUiHelperButtonsProps,
  type TLUiMainMenuProps,
  type Editor,
} from 'tldraw'
import 'tldraw/tldraw.css'
import { Tray } from './render/Tray'
import { PlayerToolbar } from './render/PlayerToolbar'
import { PhysicsPanel } from './render/PhysicsPanel'
import { GeneratePanel } from './render/GeneratePanel'
import { Hud } from './render/Hud'
import { GameRuntime, type GameState } from './game/engine'
import { loadLevel } from './game/level'
import { playingAtom, tunablesAtom, templateBridge } from './game/state'
import { makeTunables } from './game/physics'
import { TEMPLATE_LIST } from './game/templates'
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
      <Hud />
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

// The single "✨ Generate" AI door lives in tldraw's bottom-left HelperButtons
// slot, next to the stock helper buttons (PLAN §7.5 — one native AI entry point).
function HelperButtons(props: TLUiHelperButtonsProps) {
  return (
    <DefaultHelperButtons {...props}>
      {props.children}
      <GeneratePanel />
    </DefaultHelperButtons>
  )
}

// "New from template" — a native MainMenu submenu listing the bundled games
// (PLAN §5.5). The item calls templateBridge.load (App registers it on mount),
// since a stable-identity slot component can't take props.
function MainMenu(props: TLUiMainMenuProps) {
  return (
    <DefaultMainMenu {...props}>
      <TldrawUiMenuGroup id="engine-templates">
        <TldrawUiMenuSubmenu id="engine-new-from-template" label="New from template">
          {TEMPLATE_LIST.map(({ key, template }) => (
            <TldrawUiMenuItem
              key={key}
              id={`template-${key}`}
              label={template.name}
              readonlyOk
              onSelect={() => templateBridge.load?.(key)}
            />
          ))}
        </TldrawUiMenuSubmenu>
      </TldrawUiMenuGroup>
    </DefaultMainMenu>
  )
}

const components: TLComponents = {
  InFrontOfTheCanvas: InFront,
  StylePanel,
  HelperButtons,
  MainMenu,
}

const IDLE: GameState = {
  status: 'playing',
  collected: 0,
  total: 0,
  deaths: 0,
  lives: 3,
  score: 0,
  timeMs: 0,
}

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
    // Register the "New from template" loader for the MainMenu item.
    templateBridge.load = (templateKey: string) => {
      const t = TEMPLATE_LIST.find((x) => x.key === templateKey)?.template
      if (!t) return
      runtimeRef.current?.stop()
      playingAtom.set(false)
      setPlaying(false)
      setState(IDLE)
      setNoPlayer(false)
      tunablesAtom.set(makeTunables())
      runtimeRef.current?.setRules(t.rules)
      loadLevel(editor, t.level)
    }
    return () => {
      templateBridge.load = null
      runtimeRef.current?.stop()
      runtimeRef.current = null
      playingAtom.set(false)
    }
  }, [])

  const handleReset = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    runtimeRef.current?.stop()
    runtimeRef.current?.setRules(undefined) // default level → default rules
    playingAtom.set(false)
    setPlaying(false)
    setState(IDLE)
    setNoPlayer(false)
    loadLevel(editor)
  }, [])

  // Restart keeps the authored level exactly as-is but re-runs it from the top:
  // stop() restores every authored position/opacity (player parts, tokens, …),
  // then a fresh start() re-collects the same on-canvas level and spawns the
  // player back at its authored spot. Only meaningful while a game is running.
  const handleRestart = useCallback(() => {
    const rt = runtimeRef.current
    if (!rt || !rt.isPlaying) return
    rt.stop()
    setNoPlayer(false)
    if (!rt.start()) {
      playingAtom.set(false)
      setPlaying(false)
      setState(IDLE)
      setNoPlayer(true)
      return
    }
    playingAtom.set(true)
    setPlaying(true)
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
  const lost = playing && state.status === 'lost'

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
        {playing && (
          <button
            className="eng-btn eng-restart"
            onClick={handleRestart}
            title="Restart this level from the beginning"
          >
            ↻ Restart
          </button>
        )}
        <button className="eng-btn eng-reset" onClick={handleReset} title="Reset to the default level">
          ↺ Reset
        </button>
        {playing && (
          // Score/lives/timer live in the HUD (top-center); the topbar keeps only
          // the controls hint.
          <span className="eng-controls">← → move · ↑ jump</span>
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
          <div className="eng-banner-sub">Score {state.score} · {formatTime(state.timeMs)}</div>
          <div className="eng-banner-actions">
            <button className="eng-btn eng-play" onClick={handleRestart} title="Play again">
              ↻ Play again
            </button>
            <button className="eng-btn" onClick={togglePlay}>
              Back to editing
            </button>
          </div>
        </div>
      )}

      {lost && (
        <div className="eng-banner">
          <div className="eng-banner-title">💀 Game over</div>
          <div className="eng-banner-sub">Score {state.score}</div>
          <div className="eng-banner-actions">
            <button className="eng-btn eng-play" onClick={handleRestart} title="Try again">
              ↻ Try again
            </button>
            <button className="eng-btn" onClick={togglePlay}>
              Back to editing
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** mm:ss from milliseconds (for the win/lose banner). */
function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
