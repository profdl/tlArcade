import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { Tldraw, type Editor } from 'tldraw'
import 'tldraw/tldraw.css'
import type { World } from 'miniplex'
import { buildWorld, dropEntity, type Entity, type EntityKind } from './sim/components'
import { SpriteShapeUtil } from './render/SpriteShapeUtil'
import { startBridge, type Bridge } from './render/bridge'
import { CHARACTERS } from './content/characters'
import { resetSpeech } from './content/characters/speech'
import { SCENES, SCENE_LIST, DEFAULT_SCENE_ID } from './content/scenes'
import { Icon } from './render/icons'
import { SKIN_OPTIONS, DEFAULT_SKIN } from './render/doodles'
import { TLDRAW_LICENSE_KEY } from '../licenseKey'
import type { InteractionTally } from './sim/systems'

const shapeUtils = [SpriteShapeUtil]

/** A palette button, derived from a scene's `palette` list × the registry. */
type PaletteItem = { kind: string; label: string; icon: ReactNode }

export default function App() {
  const editorRef = useRef<Editor | null>(null)
  const worldRef = useRef<World<Entity> | null>(null)
  const bridgeRef = useRef<Bridge | null>(null)
  const [sceneId, setSceneId] = useState(DEFAULT_SCENE_ID)
  const sceneIdRef = useRef(sceneId)
  const [tally, setTally] = useState<InteractionTally | null>(null)
  const [paused, setPaused] = useState(false)

  // Tear down the current world+bridge (if any) and build the scene by id.
  const startScene = useCallback((editor: Editor, id: string) => {
    bridgeRef.current?.stop()
    resetSpeech() // a rebuilt town starts its seminar fresh (no lines carried over)
    const scene = SCENES[id]
    const world = buildWorld(scene)
    worldRef.current = world
    if (import.meta.env.DEV) {
      const w = window as unknown as { __editor?: Editor; __world?: World<Entity> }
      w.__editor = editor
      w.__world = world
    }
    bridgeRef.current = startBridge(
      editor,
      world,
      { ctx: { bounds: scene.bounds }, pipeline: scene.pipeline },
      setTally,
    )
  }, [])

  const handleMount = useCallback(
    (editor: Editor) => {
      editorRef.current = editor
      startScene(editor, sceneIdRef.current)
      return () => {
        bridgeRef.current?.stop()
        bridgeRef.current = null
      }
    },
    [startScene],
  )

  const changeScene = useCallback(
    (id: string) => {
      if (id === sceneIdRef.current) return
      sceneIdRef.current = id
      setSceneId(id)
      setPaused(false)
      setTally(null)
      setSkins({})
      if (editorRef.current) startScene(editorRef.current, id)
    },
    [startScene],
  )

  const togglePause = useCallback(() => {
    setPaused((p) => {
      const next = !p
      bridgeRef.current?.setPaused(next)
      return next
    })
  }, [])

  // Active skin per kind, for kinds that declare more than one (see
  // render/doodles.ts → SKIN_OPTIONS). Reset on scene change since a fresh
  // bridge starts every kind back on its default skin.
  const [skins, setSkins] = useState<Record<string, string>>({})

  const cycleSkin = useCallback(
    (kind: string) => {
      const opts = SKIN_OPTIONS[kind]
      if (!opts || opts.length < 2) return
      const current = skins[kind] ?? DEFAULT_SKIN[kind]
      const idx = opts.findIndex((o) => o.id === current)
      const next = opts[(idx + 1) % opts.length].id
      bridgeRef.current?.setSkin(kind, next)
      setSkins((prev) => ({ ...prev, [kind]: next }))
    },
    [skins],
  )

  const drop = useCallback((kind: EntityKind) => {
    const world = worldRef.current
    if (!world) return
    const { bounds } = SCENES[sceneIdRef.current]
    // Jitter around the scene centre so repeated drops don't stack.
    const at = {
      x: bounds.w / 2 + (Math.random() - 0.5) * bounds.w * 0.2,
      y: bounds.h / 2 + (Math.random() - 0.5) * bounds.h * 0.22,
    }
    dropEntity(world, kind, at)
  }, [])

  // The droppable palette for the active scene (kinds that carry a CharacterDef
  // palette entry), in the scene's declared order.
  const palette = useMemo<PaletteItem[]>(
    () =>
      SCENES[sceneId].palette
        .map((kind) => {
          const p = CHARACTERS[kind]?.palette
          return p ? { kind, label: p.label, icon: p.icon } : null
        })
        .filter((x): x is PaletteItem => x !== null),
    [sceneId],
  )

  // Kinds in the active scene that have more than one selectable appearance —
  // these get a skin-switcher control in the HUD (see render/doodles.ts →
  // SKIN_OPTIONS, render/bridge.ts → Bridge.setSkin).
  const skinnedKinds = useMemo(
    () => SCENES[sceneId].palette.filter((kind) => SKIN_OPTIONS[kind]),
    [sceneId],
  )

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Tldraw licenseKey={TLDRAW_LICENSE_KEY} shapeUtils={shapeUtils} onMount={handleMount} />
      <Hud
        tally={tally}
        paused={paused}
        onTogglePause={togglePause}
        onDrop={drop}
        palette={palette}
        sceneId={sceneId}
        onSceneChange={changeScene}
        skinnedKinds={skinnedKinds}
        skins={skins}
        onCycleSkin={cycleSkin}
      />
    </div>
  )
}

// tldraw-panel-like surface (our HUD lives outside .tl-container, so the
// theme CSS vars don't reach it — match the light theme by hand).
const PANEL = '#fcfcfc'
const BORDER = 'rgba(0,0,0,0.07)'
const SHADOW = '0 1px 3px rgba(0,0,0,0.10), 0 1px 2px rgba(0,0,0,0.06)'
const TEXT = '#1d1d1d'
const MUTED = '#9c9aa3'
const ACCENT = '#2f80ed'

function IconButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 32,
        height: 32,
        padding: 0,
        border: 'none',
        borderRadius: 7,
        cursor: 'pointer',
        background: active ? ACCENT : 'transparent',
        color: active ? '#fff' : TEXT,
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.background = 'rgba(0,0,0,0.06)'
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.background = 'transparent'
      }}
    >
      {children}
    </button>
  )
}

/** Cycles a kind through its alternate appearances (see render/doodles.ts →
 *  SKIN_OPTIONS). Shows the CURRENT skin's own label — clicking swaps to the
 *  next one, live-reskinning every instance of that kind already on the
 *  canvas (see render/bridge.ts → Bridge.setSkin). */
function SkinToggle({ kind, skin, onClick }: { kind: string; skin: string; onClick: () => void }) {
  const label = SKIN_OPTIONS[kind]?.find((o) => o.id === skin)?.label ?? skin
  return (
    <button
      type="button"
      title={`Switch appearance (currently ${label})`}
      aria-label={`Switch appearance (currently ${label})`}
      onClick={onClick}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: 32,
        padding: '0 10px',
        border: 'none',
        borderRadius: 7,
        cursor: 'pointer',
        background: 'transparent',
        color: TEXT,
        fontSize: 12,
        fontWeight: 600,
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(0,0,0,0.06)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      {label}
    </button>
  )
}

function Divider() {
  return <div style={{ width: 1, alignSelf: 'stretch', background: BORDER, margin: '0 2px' }} />
}

function SceneSelect({
  sceneId,
  onSceneChange,
}: {
  sceneId: string
  onSceneChange: (id: string) => void
}) {
  return (
    <select
      value={sceneId}
      onChange={(e) => onSceneChange(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      title="Scene"
      aria-label="Scene"
      style={{
        height: 32,
        border: 'none',
        borderRadius: 7,
        background: 'transparent',
        color: TEXT,
        fontSize: 13,
        fontWeight: 600,
        fontFamily: 'inherit',
        padding: '0 6px',
        cursor: 'pointer',
      }}
    >
      {SCENE_LIST.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  )
}

function Hud({
  tally,
  paused,
  onTogglePause,
  onDrop,
  palette,
  sceneId,
  onSceneChange,
  skinnedKinds,
  skins,
  onCycleSkin,
}: {
  tally: InteractionTally | null
  paused: boolean
  onTogglePause: () => void
  onDrop: (kind: EntityKind) => void
  palette: PaletteItem[]
  sceneId: string
  onSceneChange: (id: string) => void
  skinnedKinds: string[]
  skins: Record<string, string>
  onCycleSkin: (kind: string) => void
}) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 300,
        pointerEvents: 'none',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <div
        style={{
          pointerEvents: 'auto',
          background: PANEL,
          border: `1px solid ${BORDER}`,
          borderRadius: 10,
          boxShadow: SHADOW,
          padding: 4,
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <SceneSelect sceneId={sceneId} onSceneChange={onSceneChange} />
          <Divider />
          <IconButton label={paused ? 'Play' : 'Pause'} active={paused} onClick={onTogglePause}>
            <Icon name={paused ? 'play' : 'pause'} />
          </IconButton>
          <Divider />
          {palette.map((d) => (
            <IconButton key={d.kind} label={`Add ${d.label}`} onClick={() => onDrop(d.kind)}>
              {d.icon}
            </IconButton>
          ))}
          {skinnedKinds.length > 0 ? (
            <>
              <Divider />
              {skinnedKinds.map((kind) => (
                <SkinToggle
                  key={kind}
                  kind={kind}
                  skin={skins[kind] ?? DEFAULT_SKIN[kind]}
                  onClick={() => onCycleSkin(kind)}
                />
              ))}
            </>
          ) : null}
          <Divider />
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: paused ? ACCENT : TEXT,
              padding: '0 8px',
              whiteSpace: 'nowrap',
            }}
          >
            {paused ? 'Paused' : `${tally?.total ?? 0} active`}
          </span>
        </div>
        <div style={{ fontSize: 11, color: MUTED, padding: '0 4px 2px', whiteSpace: 'nowrap' }}>
          {paused
            ? 'Drag, resize, or delete elements — then play.'
            : `buy ${tally?.buy ?? 0} · bench ${tally?.bench ?? 0} · greet ${tally?.greet ?? 0} · restock ${tally?.restock ?? 0} · flee ${tally?.flee ?? 0}`}
        </div>
      </div>
    </div>
  )
}
