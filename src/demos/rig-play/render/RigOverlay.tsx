/**
 * rig-play — RigOverlay: render + control the bone-drawing rig editor, and the
 * play-time skeleton toggle.
 *
 * Two parts:
 *  - AUTHORING (gated on rigModeAtom): an SVG over the canvas drawing the DRAFT rig
 *    (bone lines pivot→tip, pivot/tip dots) tracking the camera, plus a small panel
 *    (auto-attach parts, bake to character, done).
 *  - PLAY DEBUG (gated on playing + a live rig): a 🦴 Bones button that toggles the
 *    live skeleton overlay so you can SEE the rig evaluating under WASD.
 *
 * Copied from the Engine demo's RigOverlay and rewired to rig-play's atoms. Mounted in
 * InFrontOfTheCanvas (App.tsx).
 */
import {
  useEditor,
  useValue,
  type Editor,
  type TLShapeId,
  type TLShapePartial,
} from 'tldraw'
import { bakeDraft, nearestBone, type DraftRig, type Vec2 } from '../rig/authoring'
import { draftRigAtom, dragBoneAtom, rigModeAtom, rigTargetAtom } from './rigState'
import { playingAtom, rigDebugAtom, showRigDebugAtom } from '../game/state'

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

  const active = useValue('rig mode', () => rigModeAtom.get() && !playingAtom.get(), [])
  const draft = useValue('draft rig', () => draftRigAtom.get(), [])
  const dragBone = useValue('drag bone', () => dragBoneAtom.get(), [])
  const targetId = useValue('rig target', () => rigTargetAtom.get(), [])
  const camera = useValue('camera', () => editor.getCamera(), [editor])
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
      meta: { ...shape.meta, rig: rig as unknown as Record<string, never> },
    } as TLShapePartial)
    exit()
  }

  const origin = targetOrigin(editor, targetId)
  const attachedCount = draft.bones.reduce((n, b) => n + b.leafIds.length, 0)

  return (
    <>
      {/* Play-time control: toggle the bone overlay on/off (its own pointer-events island). */}
      {playing && rigDebug && (
        <div style={{ position: 'absolute', right: 12, bottom: 12, zIndex: 360, pointerEvents: 'all' }}>
          <button
            type="button"
            className="rigplay-btn"
            onClick={() => showRigDebugAtom.set(!showRigDebugAtom.get())}
            style={{ background: showDebug ? '#12b886' : undefined, color: showDebug ? '#fff' : undefined }}
          >
            {showDebug ? '🦴 Bones: on' : '🦴 Bones: off'}
          </button>
        </div>
      )}

      {/* DEBUG: the live skeleton during play. */}
      {playing && showDebug && rigDebug && (
        <svg
          data-cam={`${camera.x},${camera.y},${camera.z}`}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 350 }}
        >
          {rigDebug.bones.map((b, i) => {
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
          {/* pageToViewport (container-relative), not pageToScreen (window-relative). */}
          {draft.bones.map((b) => {
            const p = editor.pageToViewport({ x: b.pivot.x + origin.x, y: b.pivot.y + origin.y })
            const t = editor.pageToViewport({ x: b.tip.x + origin.x, y: b.tip.y + origin.y })
            const attached = b.leafIds.length > 0
            return (
              <g key={b.id}>
                <line x1={p.x} y1={p.y} x2={t.x} y2={t.y} stroke={attached ? '#2b8a3e' : '#e8590c'} strokeWidth={3} strokeLinecap="round" />
                <circle cx={p.x} cy={p.y} r={6} fill="#e03131" stroke="#fff" strokeWidth={1.5} />
                <circle cx={t.x} cy={t.y} r={4} fill="#fff" stroke="#e03131" strokeWidth={1.5} />
              </g>
            )
          })}
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
        <div className="rigplay-rig-panel">
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Rig — draw the skeleton</div>
          <div style={{ opacity: 0.7, marginBottom: 8 }}>
            Drag a bone from a joint (e.g. shoulder) to its tip (elbow). Start a bone on another
            bone’s tip to chain it. {draft.bones.length} bone(s), {attachedCount} part(s) attached.
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className="rigplay-btn" onClick={autoAttach} disabled={draft.bones.length === 0}>
              Auto-attach parts
            </button>
            <button type="button" className="rigplay-btn" onClick={bake} disabled={attachedCount === 0}>
              Bake to character
            </button>
            <button type="button" className="rigplay-btn" onClick={exit}>
              Done
            </button>
          </div>
        </div>
      )}
    </>
  )
}
