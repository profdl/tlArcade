// bots.mjs — strategies that drive a player. Each bot is a function
// (state, owner) => void, called every tick. They place/toggle emitters via
// tryPlace. Bots are intentionally simple & legible — they exist to STRESS the
// design: if any one bot dominates the field, the mechanics aren't balanced yet.
//
// Convention: a bot pulls creatures toward ITS goal edge.
//   owner 'A' scores at the RIGHT edge  -> wants currents pointing +x (angle 0)
//   owner 'B' scores at the LEFT edge   -> wants currents pointing -x (angle PI)

import { TUNING as T } from './tuning.mjs'
import { tryPlace } from './match.mjs'

const goalAngle = (owner) => (owner === 'A' ? 0 : Math.PI)
const lane = (owner, frac, h) => ({ // a point in the player's half, at height frac
  x: owner === 'A' ? T.board.w * 0.35 : T.board.w * 0.65,
  y: h * frac,
})

function ownEmitters(state, owner) {
  return state.emitters.filter((e) => e.owner === owner)
}

// Would placing `kind` keep this player's drain SUSTAINABLE (regen covers it)?
// A good (human-like) player doesn't over-extend into a brown-out. Bots that
// respect this play coherent builds instead of spamming until they collapse.
function sustainable(state, owner, kind) {
  const drain = ownEmitters(state, owner)
    .filter((e) => e.active)
    .reduce((s, e) => s + T.economy.drainPerSec[e.kind], 0)
  return drain + T.economy.drainPerSec[kind] <= T.economy.regenPerSec
}

// throttle so bots act on a cadence, not every single tick
function shouldAct(state, owner, everySec) {
  const key = `_lastAct_${owner}`
  if (state[key] === undefined) state[key] = -999
  if (state.t - state[key] >= everySec) {
    state[key] = state.t
    return true
  }
  return false
}

// 1. SPAM-CURRENT: just keeps placing currents aimed at its goal. The baseline
//    "brute force" strategy. Combos/vortex/cancel should beat this.
export function botSpamCurrent(state, owner) {
  if (!shouldAct(state, owner, 1.2)) return
  if (!sustainable(state, owner, 'current')) return
  const h = T.board.h
  const own = ownEmitters(state, owner)
  const frac = 0.25 + (own.length % 3) * 0.25
  const p = lane(owner, frac, h)
  tryPlace(state, owner, { kind: 'current', x: p.x, y: p.y, angle: goalAngle(owner), strength: 1 })
}

// 2. COMBO-BUILDER: places a current, then a vortex NEXT TO it to amplify, then
//    more currents that agree (merge). Tries to build an efficient machine.
export function botComboBuilder(state, owner) {
  if (!shouldAct(state, owner, 1.0)) return
  const h = T.board.h
  const own = ownEmitters(state, owner)
  const p = lane(owner, 0.5, h)
  const g = goalAngle(owner)
  if (own.length === 0) {
    tryPlace(state, owner, { kind: 'current', x: p.x, y: p.y, angle: g, strength: 1 })
  } else if (own.length === 1) {
    // vortex right next to the current to amplify it (the signature combo)
    if (sustainable(state, owner, 'vortex')) {
      tryPlace(state, owner, { kind: 'vortex', x: p.x + 60, y: p.y + 50, angle: g, strength: 1 })
    }
  } else if (sustainable(state, owner, 'current')) {
    // stack agreeing currents nearby to merge
    const frac = 0.35 + (own.length % 3) * 0.15
    const q = lane(owner, frac, h)
    tryPlace(state, owner, { kind: 'current', x: q.x, y: q.y, angle: g, strength: 1 })
  }
}

// 3. DISRUPTOR: plays defense — drops vortices where the ENEMY's currents are,
//    to scatter them, and a couple of currents of its own. Tests counterplay.
export function botDisruptor(state, owner) {
  if (!shouldAct(state, owner, 1.1)) return
  const h = T.board.h
  const own = ownEmitters(state, owner)
  const g = goalAngle(owner)
  // find the strongest enemy current and drop a vortex on it
  const enemy = state.emitters.filter((e) => e.owner !== owner && e.kind === 'current' && e.active)
  if (enemy.length && own.filter((e) => e.kind === 'vortex').length < 2 && sustainable(state, owner, 'vortex')) {
    const target = enemy.reduce((a, b) => (b.strength > a.strength ? b : a))
    tryPlace(state, owner, { kind: 'vortex', x: target.x, y: target.y, angle: g, strength: 1 })
  } else if (sustainable(state, owner, 'current')) {
    const p = lane(owner, 0.3 + (own.length % 3) * 0.2, h)
    tryPlace(state, owner, { kind: 'current', x: p.x, y: p.y, angle: g, strength: 1 })
  }
}

// 4. HEAT-SUPPORT: cheap heat to bend currents + a couple currents. Tests whether
//    the cheap support kind is viable or useless.
export function botHeatSupport(state, owner) {
  if (!shouldAct(state, owner, 0.9)) return
  const h = T.board.h
  const own = ownEmitters(state, owner)
  const g = goalAngle(owner)
  const curCount = own.filter((e) => e.kind === 'current').length
  if (curCount < 3 && sustainable(state, owner, 'current')) {
    const p = lane(owner, 0.3 + curCount * 0.2, h)
    tryPlace(state, owner, { kind: 'current', x: p.x, y: p.y, angle: g, strength: 1 })
  } else if (sustainable(state, owner, 'heat')) {
    // heat placed DOWNSTREAM and OFF-AXIS so it bends a current toward the
    // center lane (where creatures mill) — heat's real value is redirection.
    const cur = own.find((e) => e.kind === 'current')
    if (cur) {
      const hx = cur.x + (owner === 'A' ? 120 : -120)
      const hy = h / 2 // pull the current toward the central swarm
      tryPlace(state, owner, { kind: 'heat', x: hx, y: hy, angle: g, strength: 1 })
    }
  }
}

// 5. IDLE: does nothing. Control group.
export function botIdle() {}

export const BOTS = {
  spam: botSpamCurrent,
  combo: botComboBuilder,
  disruptor: botDisruptor,
  heat: botHeatSupport,
  idle: botIdle,
}
