/**
 * Builder scene soak — the scene's PROMISE, tested end to end through the pure
 * sim. The Builder scene's feel is a supply chain balanced on a knife edge:
 * the truck's just-in-time trigger (TRUCK.LOW_WATER) should keep the snails
 * always nearly out of bricks but rarely actually idle. This runs the real
 * scene (buildWorld + its pipeline) for 20k ticks (~33 sim-minutes) and pins
 * that behaviour: the truck never stalls or vanishes, the tower never stops
 * growing, and whole-crew breaks stay short and rare. Measured over seeds
 * (3-snail crew): ~265 bricks placed, rest fraction 0.35–0.50%, longest dry
 * spell 67–95 ticks — the bounds below leave comfortable headroom over that.
 */
import { describe, it, expect } from 'vitest'
import { buildWorld } from '../../sim/components'
import { runScene } from '../../sim/systems'
import { builder } from './builder'

describe('builder scene soak', () => {
  it('20k ticks: the truck keeps delivering and the snails rarely idle', () => {
    const world = buildWorld(builder)
    const ctx = { bounds: builder.bounds }
    const crewSize = builder.roster.find((r) => r.kind === 'builder')?.count ?? 0
    let restTicks = 0 // ticks where the WHOLE crew is on break
    let maxDrySpell = 0
    let dry = 0
    let placedAt10k = 0
    for (let tick = 1; tick <= 20000; tick++) {
      runScene(world, tick, ctx, builder.pipeline)
      const ents = [...world.entities]
      expect(ents.find((e) => e.deliver), `truck missing at tick ${tick}`).toBeTruthy()
      const resting = ents.filter((e) => e.build && e.build.state === 'rest').length
      if (resting === crewSize) {
        restTicks++
        dry++
        maxDrySpell = Math.max(maxDrySpell, dry)
      } else {
        dry = 0
      }
      if (tick === 10000) placedAt10k = ents.filter((e) => e.brick?.state === 'placed').length
    }
    const placed = [...world.entities].filter((e) => e.brick?.state === 'placed').length
    // The tower keeps growing through the whole run — no stall, no deadlock.
    expect(placedAt10k).toBeGreaterThan(100)
    expect(placed).toBeGreaterThan(placedAt10k + 50)
    // "Rarely get a break": the whole crew idles < 15% of the time, and never
    // for more than ~20 s at a stretch.
    expect(restTicks / 20000).toBeLessThan(0.15)
    expect(maxDrySpell).toBeLessThan(200)
  })
})
