/**
 * No-repeat speech ledger (speech.ts). Guards the two invariants thought()
 * relies on: a stable seed always maps to one line (no bubble flicker), and no
 * line recurs until the pool is exhausted (no two snails echoing).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { pickUnique, resetSpeech } from './speech'

const POOL = ['a', 'b', 'c', 'd']

describe('pickUnique', () => {
  beforeEach(() => resetSpeech())

  it('returns the same line every time for a stable seed (no flicker)', () => {
    const first = pickUnique('p', POOL, 7)
    for (let i = 0; i < 20; i++) expect(pickUnique('p', POOL, 7)).toBe(first)
  })

  it('hands out every line once before any repeats (town-wide de-dup)', () => {
    // Distinct seeds → distinct lines until the pool is spent.
    const said = POOL.map((_, i) => pickUnique('p', POOL, i * 100 + 1))
    expect(new Set(said).size).toBe(POOL.length)
    expect([...said].sort()).toEqual([...POOL].sort())
  })

  it('recycles the pool only after every line has been spoken', () => {
    // 8 fresh seeds over a pool of 4 ⇒ two full, repeat-free passes.
    const said = Array.from({ length: 8 }, (_, i) => pickUnique('p', POOL, i + 1))
    expect(new Set(said.slice(0, 4)).size).toBe(4)
    expect(new Set(said.slice(4, 8)).size).toBe(4)
  })

  it('keeps separate pools independent', () => {
    // Same seed in two pools draws from each pool's own ledger.
    expect(pickUnique('rest', ['x'], 0)).toBe('x')
    expect(pickUnique('dump', ['y'], 0)).toBe('y')
  })

  it('resetSpeech clears the ledger so a rebuilt town starts fresh', () => {
    for (let i = 0; i < POOL.length; i++) pickUnique('p', POOL, i + 1)
    resetSpeech()
    // After reset, the first seed's slot is available again from a clean set.
    expect(pickUnique('p', POOL, 1000)).toBe(POOL[1000 % POOL.length])
  })

  it('is safe on an empty pool', () => {
    expect(pickUnique('empty', [], 3)).toBe('')
  })
})
