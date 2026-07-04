// watch.mjs — ASCII match viewer. Watch a single match play out in the terminal
// so you can EYEBALL whether the field/creatures look fun, not just read win-rates.
//
// Usage:  node design/sim/watch.mjs [botA] [botB] [seed]
//   e.g.  node design/sim/watch.mjs combo disruptor 7
//
// Renders the board each frame: A's emitters in their half, B's in theirs,
// creatures as dots, goal bands at the edges, plus energy/score HUD.

import { newMatch, step } from './match.mjs'
import { BOTS } from './bots.mjs'
import { TUNING as T } from './tuning.mjs'

const aName = process.argv[2] ?? 'combo'
const bName = process.argv[3] ?? 'disruptor'
const seed = Number(process.argv[4] ?? 7)
if (!BOTS[aName] || !BOTS[bName]) {
  console.error('unknown bot. choose from:', Object.keys(BOTS).join(', '))
  process.exit(1)
}

const COLS = 70
const ROWS = 24
const { w, h } = T.board
const sx = (x) => Math.max(0, Math.min(COLS - 1, Math.round((x / w) * (COLS - 1))))
const sy = (y) => Math.max(0, Math.min(ROWS - 1, Math.round((y / h) * (ROWS - 1))))

const state = newMatch(seed)
const dt = 1 / T.match.tickHz
const renderEvery = Math.round(T.match.tickHz / 12) // ~12 fps display
let frame = 0

const emitterGlyph = { current: '→', vortex: '@', heat: '*' }
const emitterGlyphB = { current: '←', vortex: '@', heat: '*' }

function render() {
  const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(' '))
  // goal bands
  const gl = sx(T.goal.width)
  const gr = sx(w - T.goal.width)
  for (let r = 0; r < ROWS; r++) {
    grid[r][0] = '|'
    grid[r][gl] = ':'
    grid[r][gr] = ':'
    grid[r][COLS - 1] = '|'
  }
  // creatures
  for (const c of state.creatures) grid[sy(c.y)][sx(c.x)] = '·'
  // emitters (drawn over creatures)
  for (const e of state.emitters) {
    if (!e.active) continue
    const g = e.owner === 'A' ? emitterGlyph[e.kind] : emitterGlyphB[e.kind]
    grid[sy(e.y)][sx(e.x)] = g
  }

  const lines = grid.map((row) => row.join(''))
  // HUD
  const pa = state.players.A
  const pb = state.players.B
  const bar = (v, max) => {
    const n = Math.round((v / max) * 12)
    return '█'.repeat(Math.max(0, n)) + '░'.repeat(Math.max(0, 12 - n))
  }
  const ownCount = (o) => state.emitters.filter((e) => e.owner === o && e.active).length

  console.clear()
  console.log(`CURRENT   A:${aName}  vs  B:${bName}   seed ${seed}   t=${state.t.toFixed(1)}s / ${T.match.maxSeconds}s`)
  console.log(
    `A ⚡${bar(pa.energy, T.economy.maxEnergy)} ${pa.energy.toFixed(0).padStart(3)}  emit:${ownCount('A')}  score:${state.score.A}` +
      `      B ⚡${bar(pb.energy, T.economy.maxEnergy)} ${pb.energy.toFixed(0).padStart(3)}  emit:${ownCount('B')}  score:${state.score.B}   (goal ${T.match.captureGoal})`,
  )
  console.log('+' + '-'.repeat(COLS) + '+')
  for (const l of lines) console.log(l)
  console.log('+' + '-'.repeat(COLS) + '+')
  console.log("A scores → right edge   B scores → left edge   ·=creature  →←=current @=vortex *=heat")
}

// step + render loop using setInterval so it animates in the terminal
const timer = setInterval(() => {
  for (let i = 0; i < renderEvery; i++) {
    if (state.winner) break
    step(state, dt, BOTS[aName], BOTS[bName])
  }
  render()
  frame++
  if (state.winner) {
    clearInterval(timer)
    console.log(`\n*** WINNER: ${state.winner}   final ${state.score.A}-${state.score.B}  in ${state.t.toFixed(1)}s ***`)
  }
}, 80)
