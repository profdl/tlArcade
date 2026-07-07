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
  DefaultStylePanel,
  Tldraw,
  useValue,
  type TLComponents,
  type Editor,
} from 'tldraw'
import 'tldraw/tldraw.css'
import { Tray } from './render/Tray'
import { PlayerToolbar } from './render/PlayerToolbar'
import { RigOverlay } from './render/RigOverlay'
import { RigTool } from './render/RigTool'
import { PhysicsPanel } from './render/PhysicsPanel'
import { GeneratePanel } from './render/GeneratePanel'
import { Hud } from './render/Hud'
import { GameRuntime, type GameState } from './game/engine'
import { loadLevel } from './game/level'
import { playingAtom, tunablesAtom } from './game/state'
import { draftRigAtom, dragBoneAtom, rigDebugAtom, rigModeAtom, rigTargetAtom, showRigDebugAtom } from './game/rig/state'
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
      <RigOverlay />
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

const components: TLComponents = {
  InFrontOfTheCanvas: InFront,
  StylePanel,
}

// The bone-drawing rig tool (R1). A custom StateNode so bone-drawing owns the
// pointer while active (tldraw-v5-native-ui: full editors are tools, not overlays).
// Module-level for stable identity, like `components`.
const tools = [RigTool]

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
  // Also in state so the topbar (which renders the editor-bound ✨ Generate) shows
  // it once the editor is ready — a ref alone wouldn't trigger that re-render.
  const [editor, setEditor] = useState<Editor | null>(null)

  const handleMount = useCallback((editor: Editor) => {
    editorRef.current = editor
    setEditor(editor)
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
      // Expose rig-authoring atoms for the Playwright bone-drawing e2e check.
      ;(window as unknown as { __rig?: unknown }).__rig = { draftRigAtom, rigModeAtom, rigTargetAtom, dragBoneAtom, rigDebugAtom, showRigDebugAtom }
      // Expose the runtime so e2e can drive Play/Stop directly (headless can't rely
      // on the audio-gated Play click).
      ;(window as unknown as { __runtime?: unknown }).__runtime = runtimeRef.current
    }
    return () => {
      runtimeRef.current?.stop()
      runtimeRef.current?.disposeAudio()
      runtimeRef.current = null
      setEditor(null)
      playingAtom.set(false)
    }
  }, [])

  // Load a bundled template (from the topbar dropdown): stop play, reset feel to
  // defaults, apply the template's rules, and lay its level down as native shapes.
  const handleLoadTemplate = useCallback((templateKey: string) => {
    const editor = editorRef.current
    if (!editor) return
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
    // Resume audio here: this click is the user gesture Tone requires to start its
    // AudioContext (and to kick off the async sample load on first play).
    rt.resumeAudio()
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
      <Tldraw
        persistenceKey="tlArcade-engine-native"
        components={components}
        tools={tools}
        onMount={handleMount}
      />

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
        {!playing && (
          <>
            {/* Load a bundled starter game (§5.5). Authoring-only. */}
            <select
              className="eng-template-select"
              value=""
              onChange={(e) => {
                if (e.target.value) handleLoadTemplate(e.target.value)
                e.target.value = '' // reset so the same template can be re-picked
              }}
              title="Load a template level"
            >
              <option value="" disabled>
                📦 Template…
              </option>
              {TEMPLATE_LIST.map(({ key, template }) => (
                <option key={key} value={key}>
                  {template.name}
                </option>
              ))}
            </select>
            {/* The single ✨ Generate AI door, right after the template dropdown. */}
            {editor && <GeneratePanel editor={editor} />}
          </>
        )}
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
