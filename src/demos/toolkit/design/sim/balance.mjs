// balance.mjs — the balance harness. Runs every bot vs every other bot over many
// seeds and prints a win-rate matrix + pacing stats. THIS is the "is it fun /
// is it balanced" loop: edit tuning.mjs, re-run `node balance.mjs`, read the table.
//
// Usage:  node design/sim/balance.mjs [matchesPerPair]
//
// Read the output like this:
//  - No bot should win >~65% across the board (some strategy dominates -> unfun).
//  - 'idle' should LOSE to everything (sanity: doing nothing must be bad).
//  - 'combo' should beat 'spam' (combos must reward over brute force = the thesis).
//  - 'disruptor' should be able to beat whatever brute-forces (counterplay exists).
//  - avg seconds should land in a fun window (not all timeouts, not all 10s blowouts).

import { runMatch } from './match.mjs'
import { BOTS } from './bots.mjs'
import { TUNING as T } from './tuning.mjs'

const N = Number(process.argv[2] ?? 40)
const names = Object.keys(BOTS)

// tally: wins[a][b] = times a beat b
const wins = {}
const totalWins = {}
const totalGames = {}
let secSum = 0
let secN = 0
let timeouts = 0
let draws = 0

for (const a of names) {
  wins[a] = {}
  totalWins[a] = 0
  totalGames[a] = 0
}

for (const a of names) {
  for (const b of names) {
    if (a === b) continue
    let aWins = 0
    for (let i = 0; i < N; i++) {
      // vary seed per match; A=a, B=b
      const seed = (hash(a) ^ (hash(b) << 1) ^ (i * 2654435761)) >>> 0
      const res = runMatch(seed, BOTS[a], BOTS[b])
      secSum += res.seconds
      secN++
      if (res.seconds >= T.match.maxSeconds - 0.001) timeouts++
      if (res.winner === 'A') aWins++
      else if (res.winner === 'draw') draws++
      totalGames[a]++
      totalGames[b]++
      if (res.winner === 'A') totalWins[a]++
      else if (res.winner === 'B') totalWins[b]++
    }
    wins[a][b] = aWins / N
  }
}

// ----- print win-rate matrix (row beats column, as A vs B) --------------------
console.log(`\nCURRENT — balance harness   (${N} matches per ordered pair)\n`)
const pad = (s, n) => String(s).padStart(n)
const colw = 9
process.stdout.write(pad('A\\B', 10))
for (const b of names) process.stdout.write(pad(b, colw))
console.log('   |  overall')
console.log('-'.repeat(10 + colw * names.length + 12))
for (const a of names) {
  process.stdout.write(pad(a, 10))
  for (const b of names) {
    if (a === b) process.stdout.write(pad('--', colw))
    else process.stdout.write(pad((wins[a][b] * 100).toFixed(0) + '%', colw))
  }
  const wr = totalGames[a] ? (totalWins[a] / totalGames[a]) * 100 : 0
  console.log('   |  ' + wr.toFixed(1) + '%')
}

console.log('\nReading: cell = how often ROW (as player A) beat COLUMN (as player B).')
console.log('overall = win-rate across all games as either side.\n')

// ----- pacing ------------------------------------------------------------------
console.log('Pacing:')
console.log('  avg match length :', (secSum / secN).toFixed(1), 's   (cap', T.match.maxSeconds + 's)')
console.log('  timeouts         :', ((timeouts / secN) * 100).toFixed(0) + '%   (high = stalemate-y, tune capture/spawn)')
console.log('  draws            :', draws)
console.log('')

// ----- automatic design flags -------------------------------------------------
const flags = []
for (const a of names) {
  const wr = totalGames[a] ? totalWins[a] / totalGames[a] : 0
  if (a !== 'idle' && wr > 0.66) flags.push(`  ⚠ '${a}' dominates (${(wr * 100).toFixed(0)}% overall) — nerf its strategy's tools`)
  if (a !== 'idle' && wr < 0.30) flags.push(`  ⚠ '${a}' is weak (${(wr * 100).toFixed(0)}% overall) — its tools may be underpowered`)
}
const idleWr = totalWins['idle'] / totalGames['idle']
if (idleWr > 0.15) flags.push(`  ⚠ 'idle' wins ${(idleWr * 100).toFixed(0)}% — doing nothing shouldn't work; field/economy too weak`)
const comboVsSpam = wins['combo']?.['spam']
if (comboVsSpam !== undefined && comboVsSpam < 0.5) flags.push(`  ⚠ combo loses to spam as A (${(comboVsSpam * 100).toFixed(0)}%) — combos must beat brute force (the thesis!)`)
if (timeouts / secN > 0.5) flags.push(`  ⚠ ${((timeouts / secN) * 100).toFixed(0)}% timeouts — matches stalemate; raise spawn/field or lower captureGoal`)

console.log('Design flags:')
console.log(flags.length ? flags.join('\n') : '  ✓ none — balance looks reasonable. Now eyeball a match: node design/sim/watch.mjs combo disruptor')
console.log('')

function hash(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}
