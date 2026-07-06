/**
 * Engine — the on-screen HUD overlay (M8-HUD).
 *
 * A compact status row (mounted via components.InFrontOfTheCanvas alongside the
 * tray and physics panel) that shows ONLY during play and mirrors the live
 * GameState the runtime emits: lives, tokens collected, score, and an elapsed
 * timer. It's purely display-only — no interaction — so the container keeps
 * `pointer-events: none` and canvas panning passes straight through it.
 *
 * Like the tray and physics panel, it reads atoms (not props) so App's
 * `components` object keeps stable identity (see App.tsx / game/state.ts). It sits
 * in the pointer-events:none InFrontOfTheCanvas layer and, being non-interactive,
 * simply leaves them off. It reads `playingAtom` to hide itself while editing and
 * `gameStateAtom` for the live values.
 */
import { useValue } from 'tldraw'
import { gameStateAtom, playingAtom } from '../game/state'

export function Hud() {
  const playing = useValue('hud: playing', () => playingAtom.get(), [])
  const state = useValue('hud: gameState', () => gameStateAtom.get(), [])

  if (!playing) return null

  // Default defensively — older/partial state (e.g. an emit before M1's session
  // rules) may omit lives/score/timeMs, and the HUD must never throw on them.
  const lives = state.lives ?? 0
  const score = state.score ?? 0
  const timeMs = state.timeMs ?? 0
  const collected = state.collected ?? 0
  const total = state.total ?? 0

  return (
    <div className="eng-hud">
      <span className="eng-hud-stat">❤️ {lives}</span>
      <span className="eng-hud-stat">⭐ {total > 0 ? `${collected}/${total}` : '—'}</span>
      <span className="eng-hud-stat">🏆 {score}</span>
      <span className="eng-hud-stat">⏱ {formatTime(timeMs)}</span>
    </div>
  )
}

/** Format elapsed milliseconds as mm:ss (zero-padded seconds). */
function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
