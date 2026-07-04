/**
 * No-repeat speech ledger — so the town never says the same sentence twice
 * (until it has run out of fresh ones).
 * -----------------------------------------------------------------------------
 * The barb pools (builder.tsx) used to be sampled with a bare `pool[seed % len]`,
 * which lets two snails echo the same line, and lets a line recur every time the
 * seed happens to land on its slot again. This ledger hands out a line the pool
 * has NOT already spoken, across the whole crew, until every line has been used
 * once — then the used-set recycles and the pool starts fresh.
 *
 * Two invariants it must honour:
 *  1. STABILITY. thought() is a pure derivation called ~10×/sec; the bubble only
 *     redraws when its text changes (render/bridge.ts diffs `lastThought`). So a
 *     given (poolKey, seed) must ALWAYS map to the same line — otherwise the
 *     bubble would flicker frame to frame. We guarantee this by memoising
 *     seed→line: the FIRST call for a seed chooses (and reserves) a line; every
 *     later call with that seed returns the cached one.
 *  2. NO REPEATS. Distinct seeds are handed distinct lines (probing forward from
 *     the seed's slot for the first line not yet spoken) until the pool is spent.
 *
 * The ledger is module-global and shared across every entity that draws from a
 * pool, so de-dup is town-wide, not per-character. Call resetSpeech() on scene
 * teardown so a rebuilt world starts its seminar over (and the caches don't
 * outlive it).
 */

type Ledger = {
  used: Set<string> // lines already handed out since the last recycle
  cache: Map<number, string> // seed → chosen line (keeps thought() stable)
}

const ledgers = new Map<string, Ledger>()

function ledgerFor(poolKey: string): Ledger {
  let l = ledgers.get(poolKey)
  if (!l) {
    l = { used: new Set(), cache: new Map() }
    ledgers.set(poolKey, l)
  }
  return l
}

/** Pick a line for a STABLE integer seed, never repeating a line the pool has
 *  already handed out until every line has been spoken once (then it recycles).
 *  Same (poolKey, seed) always returns the same line — no per-frame flicker. */
export function pickUnique(poolKey: string, pool: string[], seed: number): string {
  if (pool.length === 0) return ''
  const l = ledgerFor(poolKey)
  const s = Math.abs(Math.round(seed))
  const cached = l.cache.get(s)
  if (cached !== undefined) return cached
  // The pool is spoken out — let every line be fair game again.
  if (l.used.size >= pool.length) l.used.clear()
  // Probe forward from the seed's slot for the first line not yet spoken; if
  // somehow all are taken (shouldn't happen after the clear above), fall back to
  // the seed's own slot.
  let line = pool[s % pool.length]
  for (let i = 0; i < pool.length; i++) {
    const cand = pool[(s + i) % pool.length]
    if (!l.used.has(cand)) {
      line = cand
      break
    }
  }
  l.used.add(line)
  l.cache.set(s, line)
  return line
}

/** Forget every spoken line — called on scene teardown/rebuild so a fresh town
 *  starts its seminar over and the seed→line caches don't outlive the world. */
export function resetSpeech(): void {
  ledgers.clear()
}
