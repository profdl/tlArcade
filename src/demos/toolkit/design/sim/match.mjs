// match.mjs — the headless match engine. Pure simulation, no editor / DOM / WebGL.
// Ties together: resolveField + sampleField (field.mjs), the economy (economy.mjs),
// creatures (particles), goal capture, and the clock. Two bot strategies drive
// the two players. Runs thousands of ticks/sec.
//
// A seeded PRNG makes every match reproducible (pass the same seed -> same match).

import { TUNING as T } from './tuning.mjs'
import { resolveField, sampleField } from './field.mjs'
import { newPlayer, canPlace, chargePlacement, tickEconomy } from './economy.mjs'

// ----- tiny seeded PRNG (mulberry32) ------------------------------------------
export function makeRng(seed) {
  let s = seed >>> 0
  return function rng() {
    s |= 0
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ----- initial state ----------------------------------------------------------
export function newMatch(seed) {
  const rng = makeRng(seed)
  const { w, h } = T.board
  const creatures = []
  for (let i = 0; i < T.creatures.count; i++) {
    creatures.push({
      x: w / 2 + (rng() - 0.5) * w * 0.2,
      y: h / 2 + (rng() - 0.5) * h * T.creatures.spawnBand,
      vx: 0,
      vy: 0,
      heading: rng() * Math.PI * 2,
      captured: null, // 'A' | 'B' once it reaches a goal
    })
  }
  return {
    rng,
    t: 0, // seconds elapsed
    emitters: [], // all emitters, both owners
    players: { A: newPlayer('A'), B: newPlayer('B') },
    creatures,
    score: { A: 0, B: 0 },
    nextEmitterId: 1,
    winner: null,
  }
}

// place an emitter for a player if affordable. `spec` = {kind,x,y,angle,strength}
export function tryPlace(state, owner, spec) {
  const own = state.emitters.filter((e) => e.owner === owner)
  if (!canPlace(state.players[owner], spec.kind, own.length)) return false
  chargePlacement(state.players[owner], spec.kind)
  state.emitters.push({
    id: state.nextEmitterId++,
    owner,
    kind: spec.kind,
    x: spec.x,
    y: spec.y,
    angle: spec.angle ?? 0,
    strength: spec.strength ?? 1,
    active: true,
  })
  return true
}

// ----- one simulation tick ----------------------------------------------------
export function step(state, dt, botA, botB) {
  if (state.winner) return

  // 1. bots act (they may place/toggle emitters via the helpers above)
  botA(state, 'A')
  botB(state, 'B')

  // 2. economy
  tickEconomy(state.players.A, state.emitters.filter((e) => e.owner === 'A'), dt)
  tickEconomy(state.players.B, state.emitters.filter((e) => e.owner === 'B'), dt)

  // 3. resolve the field (the "graph execution")
  const field = resolveField(state.emitters)
  state.field = field // expose for the viewer

  // 4. move creatures by the field + wander; check captures
  const { w, h } = T.board
  const C = T.creatures
  for (const c of state.creatures) {
    if (c.captured) continue
    const { fx, fy } = sampleField(field, c.x, c.y)

    // wander heading drift
    c.heading += (state.rng() - 0.5) * C.wander
    const wx = Math.cos(c.heading) * C.speed
    const wy = Math.sin(c.heading) * C.speed

    // blend free-swim + field force
    c.vx = c.vx * C.drag + (wx + fx * C.fieldGain) * (1 - C.drag)
    c.vy = c.vy * C.drag + (wy + fy * C.fieldGain) * (1 - C.drag)

    // clamp speed
    const sp = Math.hypot(c.vx, c.vy)
    if (sp > C.maxSpeed) {
      c.vx = (c.vx / sp) * C.maxSpeed
      c.vy = (c.vy / sp) * C.maxSpeed
    }

    c.x += c.vx * dt
    c.y += c.vy * dt

    // bounce off top/bottom
    if (c.y < 0) { c.y = 0; c.vy = Math.abs(c.vy) }
    if (c.y > h) { c.y = h; c.vy = -Math.abs(c.vy) }

    // capture: reaching the LEFT band scores for B, RIGHT band scores for A.
    // (you pull creatures toward the opponent's edge = your goal)
    if (c.x <= T.goal.width) { c.captured = 'B'; state.score.B++ }
    else if (c.x >= w - T.goal.width) { c.captured = 'A'; state.score.A++ }
  }

  // 5. respawn captured creatures at center (keeps the swarm flowing)
  for (const c of state.creatures) {
    if (c.captured) {
      c.x = w / 2 + (state.rng() - 0.5) * w * 0.2
      c.y = h / 2 + (state.rng() - 0.5) * h * C.spawnBand
      c.vx = 0
      c.vy = 0
      c.heading = state.rng() * Math.PI * 2
      c.captured = null
    }
  }

  // 6. clock + win checks
  state.t += dt
  if (state.score.A >= T.match.captureGoal) state.winner = 'A'
  else if (state.score.B >= T.match.captureGoal) state.winner = 'B'
  else if (state.t >= T.match.maxSeconds) {
    state.winner = state.score.A === state.score.B ? 'draw' : state.score.A > state.score.B ? 'A' : 'B'
  }
}

// run a full match headless, return the result + final state
export function runMatch(seed, botA, botB) {
  const state = newMatch(seed)
  const dt = 1 / T.match.tickHz
  let guard = 0
  while (!state.winner && guard++ < T.match.tickHz * (T.match.maxSeconds + 2)) {
    step(state, dt, botA, botB)
  }
  return { winner: state.winner, score: { ...state.score }, seconds: state.t, state }
}
