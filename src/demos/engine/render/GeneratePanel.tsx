/**
 * Engine — the single "✨ Generate" AI door (PLAN §7.5).
 *
 * One affordance, not one button per converter: a ✨ button in the custom top
 * panel (App.tsx, after the template dropdown) drops down a small prompt form with
 * a TARGET selector (this level / the feel). The result lands as editable data — a
 * level becomes native shapes on the canvas; a feel patch merges onto the live
 * tunables (which the physics panel reflects). New converters add a target here.
 *
 * It takes the `editor` as a PROP (not useEditor()) because the topbar renders
 * outside tldraw's context. App only mounts it when not playing (generation is an
 * authoring action).
 */
import { useCallback, useRef, useState } from 'react'
import { type Editor } from 'tldraw'
import { autoLevel, type LevelMode } from '../game/ai/autoLevel'
import { autoTune } from '../game/ai/autoTune'
import { AiError } from '../game/ai/client'

type Target = 'level' | 'feel'

const PLACEHOLDERS: Record<Target, string> = {
  level: 'a 3-screen level with a dash gap and two hazards to jump',
  feel: 'floaty like Celeste with a big, high jump',
}

/**
 * The single "✨ Generate" AI door (PLAN §7.5). Lives in the custom top panel
 * (App.tsx), so it takes the editor as a prop rather than useEditor() — the topbar
 * renders OUTSIDE tldraw's context. App hides it during play (generation is an
 * authoring action). The result lands as editable data: a level → native shapes;
 * a feel patch → the live tunables.
 */
export function GeneratePanel({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<Target>('level')
  const [levelMode, setLevelMode] = useState<LevelMode>('replace')
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const submit = useCallback(async () => {
    const text = prompt.trim()
    if (!text || busy) return
    setBusy(true)
    setError(null)
    setNote(null)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      if (target === 'level') {
        const count = await autoLevel(editor, text, levelMode, { signal: controller.signal })
        setNote(`Added ${count} shape${count === 1 ? '' : 's'}. Edit or press Play.`)
      } else {
        await autoTune(text, { signal: controller.signal })
        setNote('Feel updated. Play to feel it; fine-tune in the physics panel.')
      }
    } catch (e) {
      setError(e instanceof AiError ? e.message : `Generation failed: ${(e as Error).message}`)
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }, [prompt, busy, target, levelMode, editor])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    setBusy(false)
  }, [])

  // The trigger button lives in the topbar; the form pops OVER the canvas below it.
  if (!open) {
    return (
      <button
        className="eng-btn eng-generate-open"
        onClick={() => setOpen(true)}
        title="Generate a level or tune the feel with AI"
      >
        ✨ Generate
      </button>
    )
  }

  return (
    <div className="eng-generate">
      <div className="eng-generate-head">
        <span className="eng-generate-title">✨ Generate</span>
        <button className="eng-generate-x" onClick={() => setOpen(false)} title="Close">
          ✕
        </button>
      </div>

      <div className="eng-generate-targets">
        <button
          className={target === 'level' ? 'eng-generate-tab on' : 'eng-generate-tab'}
          onClick={() => setTarget('level')}
        >
          This level
        </button>
        <button
          className={target === 'feel' ? 'eng-generate-tab on' : 'eng-generate-tab'}
          onClick={() => setTarget('feel')}
        >
          The feel
        </button>
      </div>

      {target === 'level' && (
        <div className="eng-generate-targets">
          <button
            className={levelMode === 'replace' ? 'eng-generate-tab on' : 'eng-generate-tab'}
            onClick={() => setLevelMode('replace')}
            title="Clear the canvas and generate a fresh level"
          >
            Replace
          </button>
          <button
            className={levelMode === 'extend' ? 'eng-generate-tab on' : 'eng-generate-tab'}
            onClick={() => setLevelMode('extend')}
            title="Keep the current drawing and add to it"
          >
            Extend
          </button>
        </div>
      )}

      <textarea
        className="eng-generate-input"
        value={prompt}
        placeholder={PLACEHOLDERS[target]}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit()
        }}
        rows={3}
        disabled={busy}
      />

      <div className="eng-generate-actions">
        {busy ? (
          <button className="eng-btn" onClick={cancel}>
            Cancel
          </button>
        ) : (
          <button className="eng-btn eng-play" onClick={() => void submit()} disabled={!prompt.trim()}>
            Generate
          </button>
        )}
        <span className="eng-generate-hint">⌘⏎</span>
      </div>

      {busy && <div className="eng-generate-status">Generating…</div>}
      {error && <div className="eng-generate-error">{error}</div>}
      {note && !error && <div className="eng-generate-note">{note}</div>}
    </div>
  )
}
