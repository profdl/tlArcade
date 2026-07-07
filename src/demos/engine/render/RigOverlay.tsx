/**
 * Engine — RigOverlay (R1 redesign): render + control the bone-drawing rig editor.
 *
 * Two parts, both gated on Rig mode (rigModeAtom):
 *  - An SVG over the canvas that draws the DRAFT rig — bone lines (pivot→tip),
 *    pivot dots (joints), and tip dots — tracking the camera via pageToViewport.
 *  - A small control panel: enter/exit Rig mode, auto-attach parts to bones, and
 *    bake the draft into meta.rig on the character.
 *
 * Entered from the contextual toolbar ("Rig") on a selection / the marked player.
 * Mounted in InFrontOfTheCanvas (App.tsx). The tool (RigTool) writes bones; this
 * only reads/renders them + runs the whole-figure actions.
 */
import {
  useEditor,
  useValue,
  type Editor,
  type TLShapeId,
  type TLShapePartial,
} from 'tldraw'
import { bakeDraft, nearestBone, type DraftRig, type Vec2 } from '../game/rig/authoring'
import { draftRigAtom, dragBoneAtom, rigDebugAtom, rigModeAtom, rigTargetAtom, showRigDebugAtom } from '../game/rig/state'
import { playingAtom } from '../game/state'

/** Entity-local origin (target bounds top-left) for page↔local conversion. */
function targetOrigin(editor: Editor, id: TLShapeId | null): Vec2 | null {
  if (!id) return null
  const b = editor.getShapePageBounds(id)
  return b ? { x: b.minX, y: b.minY } : null
}

/** The character's drivable PART leaves (drawable descendants; skip groups). */
function partLeaves(editor: Editor, targetId: TLShapeId): TLShapeId[] {
  const out: TLShapeId[] = []
  for (const id of editor.getShapeAndDescendantIds([targetId])) {
    const s = editor.getShape(id)
    if (!s || s.type === 'group') continue
    out.push(id)
  }
  return out
}

/** A part's geometric center in entity-local space. */
function partCenterLocal(editor: Editor, id: TLShapeId, origin: Vec2): Vec2 {
  const b = editor.getShapeGeometry(id).bounds
  const c = editor.getShapePageTransform(id).applyToPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 })
  return { x: c.x - origin.x, y: c.y - origin.y }
}

export function RigOverlay() {
  const editor = useEditor()

  // Rig mode is ENTERED from the selection toolbar (game/rig/state.ts →
  // enterRigMode); this overlay only renders the draft + the edit panel while active.
  const active = useValue('rig mode', () => rigModeAtom.get() && !playingAtom.get(), [])
  const draft = useValue('draft rig', () => draftRigAtom.get(), [])
  const dragBone = useValue('drag bone', () => dragBoneAtom.get(), [])
  const targetId = useValue('rig target', () => rigTargetAtom.get(), [])
  // Recompute screen positions whenever the camera or draft changes.
  const camera = useValue('camera', () => editor.getCamera(), [editor])
  // DEBUG: the live play-time skeleton (page-space bone segments) + its toggle.
  const playing = useValue('playing', () => playingAtom.get(), [])
  const rigDebug = useValue('rig debug', () => rigDebugAtom.get(), [])
  const showDebug = useValue('show rig debug', () => showRigDebugAtom.get(), [])

  const exit = () => {
    rigModeAtom.set(false)
    rigTargetAtom.set(null)
    draftRigAtom.set({ bones: [] })
    editor.setCurrentTool('select')
  }

  // Assign each part leaf to its nearest bone segment (editable auto-attach).
  const autoAttach = () => {
    const origin = targetOrigin(editor, targetId)
    if (!origin || !targetId) return
    const current = draftRigAtom.get()
    if (current.bones.length === 0) return
    // Reset attachments, then assign each part to its nearest bone.
    const cleared: DraftRig = { bones: current.bones.map((b) => ({ ...b, leafIds: [] })) }
    for (const leafId of partLeaves(editor, targetId)) {
      const center = partCenterLocal(editor, leafId, origin)
      const boneId = nearestBone(cleared, center)
      if (!boneId) continue
      const bone = cleared.bones.find((b) => b.id === boneId)!
      bone.leafIds.push(leafId)
    }
    draftRigAtom.set(cleared)
  }

  const bake = () => {
    if (!targetId) return
    const rig = bakeDraft(draftRigAtom.get())
    if (!rig) return
    const shape = editor.getShape(targetId)
    if (!shape) return
    editor.markHistoryStoppingPoint('bake rig')
    editor.updateShape({
      id: targetId,
      type: shape.type,
      // Rig is plain data; cast through unknown to tldraw's JsonObject meta.
      meta: { ...shape.meta, rig: rig as unknown as Record<string, never> },
    } as TLShapePartial)
    exit()
  }

  const origin = targetOrigin(editor, targetId)
  const attachedCount = draft.bones.reduce((n, b) => n + b.leafIds.length, 0)

  return (
    <>
      {/* Play-time control: toggle the bone overlay on/off. Shown whenever a rig is
          evaluating (rigDebug is published only for a rigged player). Its own
          pointer-events:all island in the otherwise click-through overlay layer. */}
      {playing && rigDebug && (
        <div
          style={{
            // Bottom-RIGHT: the bottom-left corner holds tldraw's native minimap/zoom
            // menu, and the top-right holds the physics panel — this corner is clear
            // during play.
            position: 'absolute',
            right: 12,
            bottom: 12,
            zIndex: 360,
            pointerEvents: 'all',
          }}
        >
          <button
            type="button"
            onClick={() => showRigDebugAtom.set(!showRigDebugAtom.get())}
            style={{
              font: '12px/1.4 system-ui, sans-serif',
              padding: '5px 9px',
              borderRadius: 6,
              border: '1px solid var(--color-divider, #ddd)',
              background: showDebug ? '#12b886' : 'var(--color-panel, #fff)',
              color: showDebug ? '#fff' : 'inherit',
              cursor: 'pointer',
              boxShadow: '0 1px 4px rgba(0,0,0,.15)',
            }}
          >
            {showDebug ? '🦴 Bones: on' : '🦴 Bones: off'}
          </button>
        </div>
      )}

      {/* DEBUG: the live skeleton during play — proves the rig is evaluating. */}
      {playing && showDebug && rigDebug && (
        <svg
          data-cam={`${camera.x},${camera.y},${camera.z}`}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 350 }}
        >
          {rigDebug.bones.map((b, i) => {
            // pageToViewport (container-relative + zoom-correct), NOT pageToScreen —
            // the SVG fills the editor container, not the window (see the authoring
            // overlay below for the same fix).
            const p = editor.pageToViewport(b.pivot)
            const t = editor.pageToViewport(b.tip)
            return (
              <g key={i}>
                <line x1={p.x} y1={p.y} x2={t.x} y2={t.y} stroke="#12b886" strokeWidth={3} strokeLinecap="round" />
                <circle cx={p.x} cy={p.y} r={5} fill="#e03131" stroke="#fff" strokeWidth={1.5} />
                <circle cx={t.x} cy={t.y} r={3} fill="#fff" stroke="#12b886" strokeWidth={1.5} />
              </g>
            )
          })}
        </svg>
      )}

      {active && origin && (
        <svg
          data-cam={`${camera.x},${camera.y},${camera.z}`}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 300 }}
        >
          {/*
            The SVG fills `.tl-canvas__in-front`, whose origin is the editor
            container's top-left — NOT the browser window. So convert with
            pageToViewport (container-relative), not pageToScreen (window-
            relative): pageToScreen adds getViewportScreenBounds().x/y, which
            would shift every bone by the container's on-page offset whenever the
            editor isn't flush at window (0,0).
          */}
          {draft.bones.map((b) => {
            const p = editor.pageToViewport({ x: b.pivot.x + origin.x, y: b.pivot.y + origin.y })
            const t = editor.pageToViewport({ x: b.tip.x + origin.x, y: b.tip.y + origin.y })
            const attached = b.leafIds.length > 0
            return (
              <g key={b.id}>
                <line x1={p.x} y1={p.y} x2={t.x} y2={t.y} stroke={attached ? '#2b8a3e' : '#e8590c'} strokeWidth={3} strokeLinecap="round" />
                {/* pivot (joint) — a filled dot */}
                <circle cx={p.x} cy={p.y} r={6} fill="#e03131" stroke="#fff" strokeWidth={1.5} />
                {/* tip — a hollow dot (where a child snaps) */}
                <circle cx={t.x} cy={t.y} r={4} fill="#fff" stroke="#e03131" strokeWidth={1.5} />
              </g>
            )
          })}
          {/* Rubber-band: the bone currently being dragged. */}
          {dragBone &&
            (() => {
              const p = editor.pageToViewport({ x: dragBone.pivot.x + origin.x, y: dragBone.pivot.y + origin.y })
              const t = editor.pageToViewport({ x: dragBone.tip.x + origin.x, y: dragBone.tip.y + origin.y })
              return (
                <g>
                  <line x1={p.x} y1={p.y} x2={t.x} y2={t.y} stroke="#e8590c" strokeWidth={3} strokeLinecap="round" strokeDasharray="4 3" />
                  <circle cx={p.x} cy={p.y} r={6} fill="#e03131" stroke="#fff" strokeWidth={1.5} />
                </g>
              )
            })()}
        </svg>
      )}

      {active && (
        <div
          style={{
            position: 'absolute',
            // Bottom-center, above the draw-tools toolbar: clear of the tray (left),
            // the native minimap/zoom menu (bottom-left corner), the style panel
            // (top-right), and the Play/Template topbar (top-center).
            left: '50%',
            bottom: 76,
            transform: 'translateX(-50%)',
            zIndex: 400,
            pointerEvents: 'all',
            maxWidth: 460,
            background: 'var(--color-panel, #fff)',
            border: '1px solid var(--color-divider, #ddd)',
            borderRadius: 8,
            padding: '10px 12px',
            font: '12px/1.5 system-ui, sans-serif',
            boxShadow: '0 1px 4px rgba(0,0,0,.15)',
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Rig — draw the skeleton</div>
          <div style={{ opacity: 0.7, marginBottom: 8 }}>
            Drag a bone from a joint (e.g. shoulder) to its tip (elbow). Start a bone on another
            bone’s tip to chain it. {draft.bones.length} bone(s), {attachedCount} part(s) attached.
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" onClick={autoAttach} disabled={draft.bones.length === 0}>
              Auto-attach parts
            </button>
            <button type="button" onClick={bake} disabled={attachedCount === 0}>
              Bake to player
            </button>
            <button type="button" onClick={exit}>
              Done
            </button>
          </div>
        </div>
      )}
    </>
  )
}
