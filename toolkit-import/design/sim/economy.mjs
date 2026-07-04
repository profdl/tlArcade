// economy.mjs — pure energy/economy rules. No editor / no DOM.
// The regenerating-pool model: energy refills over time, emitters cost to place
// and drain while active. This is the scarcity that creates the core decision
// ("spend now or bank for a bigger play").

import { TUNING as T } from './tuning.mjs'

export function newPlayer(owner) {
  return { owner, energy: T.economy.startEnergy }
}

// can this player afford to place an emitter of `kind` right now?
export function canPlace(player, kind, currentEmitterCount) {
  if (currentEmitterCount >= T.economy.maxEmittersPerPlayer) return false
  return player.energy >= T.economy.placeCost[kind]
}

// charge the one-time placement cost (call only after canPlace was true)
export function chargePlacement(player, kind) {
  player.energy -= T.economy.placeCost[kind]
}

// per-tick economy update: regen the pool, drain for each active emitter.
// If a player can't afford the drain, their cheapest emitters auto-deactivate
// (so you can over-extend and brown out — a real decision).
export function tickEconomy(player, ownEmitters, dt) {
  // drain
  let drain = 0
  for (const e of ownEmitters) if (e.active) drain += T.economy.drainPerSec[e.kind]
  player.energy -= drain * dt
  // regen
  player.energy += T.economy.regenPerSec * dt
  player.energy = Math.min(T.economy.maxEnergy, player.energy)

  // brown-out: if negative, deactivate cheapest emitters until non-negative
  if (player.energy < 0) {
    const byDrain = ownEmitters
      .filter((e) => e.active)
      .sort((a, b) => T.economy.drainPerSec[a.kind] - T.economy.drainPerSec[b.kind])
    for (const e of byDrain) {
      e.active = false
      player.energy += T.economy.drainPerSec[e.kind] * dt
      if (player.energy >= 0) break
    }
    player.energy = Math.max(0, player.energy)
  }
}
