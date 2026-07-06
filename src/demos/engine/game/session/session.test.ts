import { describe, it, expect } from 'vitest'
import {
  newSession,
  tickTime,
  onCollect,
  onStomp,
  onDeath,
  onWin,
  remainingMs,
  type SessionRules,
} from './session'

const rules: SessionRules = {
  lives: 3,
  tokenScore: 100,
  stompScore: 200,
  timeBonusPerSec: 10,
}

describe('session — scoring', () => {
  it('collect and stomp add score', () => {
    const s = newSession(rules)
    onCollect(s)
    onStomp(s)
    expect(s.score).toBe(300)
  })

  it('does not score once ended', () => {
    const s = newSession(rules)
    s.status = 'won'
    onCollect(s)
    expect(s.score).toBe(0)
  })
})

describe('session — lives & death', () => {
  it('a death costs a life and allows respawn while lives remain', () => {
    const s = newSession(rules)
    expect(onDeath(s)).toEqual({ respawn: true })
    expect(s.lives).toBe(2)
    expect(s.status).toBe('playing')
  })

  it('the final death empties lives and loses', () => {
    const s = newSession({ ...rules, lives: 1 })
    expect(onDeath(s)).toEqual({ respawn: false })
    expect(s.lives).toBe(0)
    expect(s.status).toBe('lost')
  })
})

describe('session — timer', () => {
  it('counts up with no limit and never loses on time', () => {
    const s = newSession(rules)
    tickTime(s, 5000)
    expect(s.elapsedMs).toBe(5000)
    expect(remainingMs(s)).toBeUndefined()
    expect(s.status).toBe('playing')
  })

  it('a countdown loses at zero', () => {
    const s = newSession({ ...rules, timeLimitMs: 3000 })
    tickTime(s, 2000)
    expect(remainingMs(s)).toBe(1000)
    expect(s.status).toBe('playing')
    tickTime(s, 1500)
    expect(remainingMs(s)).toBe(0)
    expect(s.status).toBe('lost')
  })
})

describe('session — win + time bonus', () => {
  it('awards a per-second bonus from remaining time', () => {
    const s = newSession({ ...rules, timeLimitMs: 10000, timeBonusPerSec: 10 })
    tickTime(s, 3000) // 7000 ms remaining = 7 s
    onWin(s)
    expect(s.status).toBe('won')
    expect(s.score).toBe(70) // 7 s * 10
  })

  it('no bonus when no time limit', () => {
    const s = newSession({ ...rules, timeBonusPerSec: 10 })
    tickTime(s, 3000)
    onWin(s)
    expect(s.score).toBe(0)
  })
})
