/**
 * rig-play — a focused rig playground.
 *
 * Draw a character (or drop the pre-rigged builder figure), draw bones on it (pivot→tip),
 * auto-attach the parts, bake to `meta.rig`, then hit Play and drive it with the keyboard:
 *
 *   A / D            move left / right (and flip facing)
 *   W / Space        jump (a simple gravity hop; a single floor catches it)
 *   S                crouch (held)
 *   E                wave (one-shot)
 *
 * The character walks / jumps / falls / idles via the pure procedural state machine
 * (rig/walk.ts) evaluated by the pure rig evaluator (rig/evaluate.ts) — no physics sim,
 * no terrain, no collision. This is the Engine demo's rig, lifted out of the platformer
 * and driven directly by WASD. Fully self-contained (copies of the rig core), unique
 * persistenceKey + `.rigplay-*` CSS, per the shell CLAUDE.md rules.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Tldraw, useValue, type Editor, type TLComponents } from 'tldraw'
import 'tldraw/tldraw.css'
import './App.css'
import { TLDRAW_LICENSE_KEY } from '../licenseKey'
import { RigOverlay } from './render/RigOverlay'
import { RigTool } from './render/RigTool'
import { enterRigMode } from './render/rigState'
import { createBuilderCharacter } from './game/builder'
import { isCharacterMarked } from './game/body'
import { RigRuntime, type InputState } from './game/runtime'
import { legModeAtom, playingAtom } from './game/state'

// Registering the StateNode via `tools` is enough for setCurrentTool('rig') to resolve;
// the tool has no toolbar item — it's entered programmatically from the "Rig" button.
const tools = [RigTool]

// One InFrontOfTheCanvas slot for the rig overlay (draft bones + play-time skeleton).
function InFrontOfTheCanvas() {
  return <RigOverlay />
}
const components: TLComponents = { InFrontOfTheCanvas }

/** Drop the character this far above viewport center so the standing figure is framed. */
const SPAWN_OFFSET_Y = 80

function addCharacter(editor: Editor) {
  const center = editor.getViewportPageBounds().center
  createBuilderCharacter(editor, center.x - 30, center.y - SPAWN_OFFSET_Y)
}

/** The current held-keys state, mapped from a keyboard event set. */
function readInput(keys: Set<string>): InputState {
  return {
    left: keys.has('a') || keys.has('arrowleft'),
    right: keys.has('d') || keys.has('arrowright'),
    jump: keys.has('w') || keys.has('arrowup') || keys.has(' '),
    crouch: keys.has('s') || keys.has('arrowdown'),
  }
}

export default function App() {
  const editorRef = useRef<Editor | null>(null)
  const runtimeRef = useRef<RigRuntime | null>(null)
  const keysRef = useRef<Set<string>>(new Set())
  const [playing, setPlaying] = useState(false)
  const legMode = useValue('legMode', () => legModeAtom.get(), [])

  const handleMount = useCallback((editor: Editor) => {
    editorRef.current = editor
    runtimeRef.current = new RigRuntime(editor)
    // Guard against StrictMode's double mount seeding two figures.
    if (!editor.getCurrentPageShapes().some((s) => isCharacterMarked(s))) {
      addCharacter(editor)
      editor.zoomToFit({ animation: { duration: 0 } })
    }
    if (import.meta.env.DEV) {
      ;(window as unknown as { __editor: Editor }).__editor = editor
      ;(window as unknown as { __rigplay: unknown }).__rigplay = {
        runtime: () => runtimeRef.current,
        enterRigMode,
        playingAtom,
      }
    }
    return () => {
      runtimeRef.current?.stop()
      playingAtom.set(false)
    }
  }, [])

  // Keyboard: feed WASD/Space to the runtime while playing; E fires a one-shot wave.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (!runtimeRef.current?.isRunning) return
      const k = e.key.toLowerCase()
      // Space/arrows scroll the page / pan the canvas otherwise — claim them during play.
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd', 'e'].includes(k)) {
        e.preventDefault()
      }
      if (k === 'e') {
        runtimeRef.current.triggerWave()
        return
      }
      if (!keysRef.current.has(k)) {
        keysRef.current.add(k)
        runtimeRef.current.setInput(readInput(keysRef.current))
      }
    }
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase()
      if (keysRef.current.delete(k)) {
        runtimeRef.current?.setInput(readInput(keysRef.current))
      }
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  const togglePlay = () => {
    const rt = runtimeRef.current
    if (!rt) return
    if (rt.isRunning) {
      rt.stop()
      keysRef.current.clear()
      playingAtom.set(false)
      setPlaying(false)
    } else {
      editorRef.current?.selectNone()
      const ok = rt.start()
      if (!ok) {
        alert('No character to play. Click "Add figure" first (or draw one and Rig it).')
        return
      }
      keysRef.current.clear()
      rt.setInput(readInput(keysRef.current))
      playingAtom.set(true)
      setPlaying(true)
    }
  }

  return (
    <div className="rigplay-root">
      <Tldraw
        licenseKey={TLDRAW_LICENSE_KEY}
        persistenceKey="rig-play"
        tools={tools}
        components={components}
        onMount={handleMount}
      />
      <div className="rigplay-toolbar">
        <button
          className="rigplay-btn rigplay-btn--play"
          onClick={togglePlay}
          title="Play the character (drive it with WASD)"
        >
          {playing ? '■ Stop' : '▶ Play'}
        </button>
        {!playing && (
          <>
            <button
              className="rigplay-btn"
              onClick={() => editorRef.current && addCharacter(editorRef.current)}
              title="Drop a pre-rigged builder figure"
            >
              Add figure
            </button>
            <button
              className="rigplay-btn"
              onClick={() => editorRef.current && enterRigMode(editorRef.current)}
              title="Draw bones on the selected figure"
            >
              Rig
            </button>
            <button
              className="rigplay-btn"
              onClick={() => legModeAtom.set(legMode === 'ik' ? 'straight' : 'ik')}
              title="Toggle bending-knee IK legs vs straight legs"
            >
              Legs: {legMode === 'ik' ? 'IK' : 'straight'}
            </button>
          </>
        )}
        {playing && <span className="rigplay-hint">A/D move · W/Space jump · S crouch · E wave</span>}
      </div>
    </div>
  )
}
