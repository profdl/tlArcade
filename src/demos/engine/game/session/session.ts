/**
 * Engine — the game session (M1, lean: single-level rules + win/lose).
 *
 * The runtime (engine.ts) plays ONE level's sim; this module holds the game-level
 * rules on top of it: lives, score, and a play timer, plus the win/lose decision.
 * It is a small, PURE reducer over plain data — no editor, no tldraw — so it's
 * unit-testable and the runtime just calls it on the right events.
 *
 * Lean scope (per the v1 decision): a single level with lives/score/timer and a
 * proper win + game-over. A multi-level GameDef sequence is a later addition; the
 * shape here (`SessionRules`, `Session`) is forward-compatible with it.
 */

/** The tunable rules for a session. Authored per level (later: per GameDef). */
export interface SessionRules {
  /** Starting lives. A kill costs one; 0 ⇒ game over. */
  lives: number
  /** Points per token collected. */
  tokenScore: number
  /** Points per enemy stomped. */
  stompScore: number
  /**
   * Optional countdown, ms. When set, time counts DOWN and hitting 0 is a loss.
   * When undefined, the timer counts UP (elapsed) and never loses on time.
   */
  timeLimitMs?: number
  /** Points awarded per remaining second on win (0 to disable). */
  timeBonusPerSec: number
}

export const DEFAULT_RULES: SessionRules = {
  lives: 3,
  tokenScore: 100,
  stompScore: 200,
  timeLimitMs: undefined,
  timeBonusPerSec: 0,
}

/** The mutable session state carried across an attempt. */
export interface Session {
  rules: SessionRules
  lives: number
  score: number
  /** Elapsed ms (counts up). With a time limit, `remainingMs` is derived. */
  elapsedMs: number
  status: 'playing' | 'won' | 'lost'
}

/** A fresh session from rules (lives full, score 0, clock 0, playing). */
export function newSession(rules: SessionRules = DEFAULT_RULES): Session {
  return { rules, lives: rules.lives, score: 0, elapsedMs: 0, status: 'playing' }
}

/** Remaining ms for a countdown session, else undefined. */
export function remainingMs(s: Session): number | undefined {
  if (s.rules.timeLimitMs == null) return undefined
  return Math.max(0, s.rules.timeLimitMs - s.elapsedMs)
}

/**
 * Advance the clock by `dtMs`. If a time limit is set and it hits 0, the session
 * is lost. Returns the (mutated) session for chaining. No-op once ended.
 */
export function tickTime(s: Session, dtMs: number): Session {
  if (s.status !== 'playing') return s
  s.elapsedMs += dtMs
  if (s.rules.timeLimitMs != null && s.elapsedMs >= s.rules.timeLimitMs) {
    s.status = 'lost'
  }
  return s
}

/** Collect a token: add score. */
export function onCollect(s: Session): Session {
  if (s.status !== 'playing') return s
  s.score += s.rules.tokenScore
  return s
}

/** Stomp an enemy: add score. */
export function onStomp(s: Session): Session {
  if (s.status !== 'playing') return s
  s.score += s.rules.stompScore
  return s
}

/**
 * The player died (hazard/enemy kill). Costs a life; if that empties lives the
 * session is lost. Returns whether the player may respawn (still has lives).
 */
export function onDeath(s: Session): { respawn: boolean } {
  if (s.status !== 'playing') return { respawn: false }
  s.lives -= 1
  if (s.lives <= 0) {
    s.lives = 0
    s.status = 'lost'
    return { respawn: false }
  }
  return { respawn: true }
}

/**
 * Reached the goal (all tokens already collected — the runtime gates that). Awards
 * the time bonus and marks the session won. No-op if not playing.
 */
export function onWin(s: Session): Session {
  if (s.status !== 'playing') return s
  if (s.rules.timeBonusPerSec > 0) {
    const rem = remainingMs(s)
    const bonusSec = rem != null ? Math.floor(rem / 1000) : 0
    s.score += bonusSec * s.rules.timeBonusPerSec
  }
  s.status = 'won'
  return s
}
