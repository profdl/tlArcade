/**
 * Pure-sim tests — the sim/ layer is the source of truth and, by design,
 * tldraw-free and deterministic given Math.random. We build minimal worlds by
 * hand (not buildWorld) so each case exercises exactly one system, and we stub
 * Math.random only where a system rolls one. Timing is in ticks; `*.until` fields
 * hold ABSOLUTE ticks compared against the `tick` passed in.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { World } from 'miniplex'
import type { Entity } from './components'
import {
  moveSystem,
  arriveSystem,
  dwellSystem,
  greetSystem,
  whimSystem,
  birdSystem,
  vanSystem,
  truckSystem,
  gardenerSystem,
  TRUCK,
  FACTORY_DOCK_Y,
  tally,
  runScene,
  type SimContext,
} from './systems'
import { MOVE, TIMING, STALL_MAX } from './config'

const ctx: SimContext = { bounds: { w: 2000, h: 1400 } }

afterEach(() => vi.restoreAllMocks())

function walker(pos: { x: number; y: number }, target: { x: number; y: number } | null): Entity {
  return {
    kind: 'townsperson',
    position: { ...pos },
    sprite: { shape: 'townsperson' },
    mover: { speed: MOVE.WALK, target: target && { ...target }, arrived: false },
    whim: { kind: 'wander', target: null },
    dweller: { state: 'walk', until: 0, bench: null },
    interactor: { state: 'none', partner: null, until: 0, cooldownUntil: 0 },
  }
}

describe('moveSystem', () => {
  it('steps a walker toward its target by exactly one speed unit', () => {
    const world = new World<Entity>()
    const p = world.add(walker({ x: 0, y: 0 }, { x: 1000, y: 0 }))
    moveSystem(world)
    expect(p.position.x).toBeCloseTo(MOVE.WALK, 5)
    expect(p.position.y).toBeCloseTo(0, 5)
    expect(p.mover!.arrived).toBe(false)
  })

  it('snaps to the target and flags arrival within ARRIVE_EPS', () => {
    const world = new World<Entity>()
    const target = { x: MOVE.ARRIVE_EPS - 1, y: 0 }
    const p = world.add(walker({ x: 0, y: 0 }, target))
    moveSystem(world)
    expect(p.position).toEqual(target)
    expect(p.mover!.arrived).toBe(true)
  })

  it('ignores non-walking dwellers', () => {
    const world = new World<Entity>()
    const p = world.add(walker({ x: 0, y: 0 }, { x: 1000, y: 0 }))
    p.dweller!.state = 'idle'
    moveSystem(world)
    expect(p.position).toEqual({ x: 0, y: 0 })
  })
})

describe('arriveSystem', () => {
  it('rest whim → sits, with a bench dwell timer scheduled in the future', () => {
    const world = new World<Entity>()
    const p = world.add(walker({ x: 5, y: 5 }, null))
    p.mover!.arrived = true
    p.whim!.kind = 'rest'
    arriveSystem(world, 100)
    expect(p.dweller!.state).toBe('sit')
    expect(p.dweller!.until).toBeGreaterThanOrEqual(100 + TIMING.DWELL_BENCH[0])
    expect(p.dweller!.until).toBeLessThanOrEqual(100 + TIMING.DWELL_BENCH[1])
    expect(p.mover!.target).toBeNull()
  })

  it('shop whim → decrements stall stock and enters the shop dwell', () => {
    const world = new World<Entity>()
    const stall = world.add({
      kind: 'stall',
      position: { x: 5, y: 5 },
      affordance: { tags: ['shop'], capacity: 99, occupants: 0 },
      stock: { amount: STALL_MAX, max: STALL_MAX },
    })
    const p = world.add(walker({ x: 5, y: 5 }, null))
    p.mover!.arrived = true
    p.whim!.kind = 'shop'
    arriveSystem(world, 50)
    expect(stall.stock!.amount).toBe(STALL_MAX - 1)
    expect(p.dweller!.state).toBe('shop')
  })

  it('shop whim with an empty stall → goes idle instead of shopping', () => {
    const world = new World<Entity>()
    world.add({
      kind: 'stall',
      position: { x: 5, y: 5 },
      affordance: { tags: ['shop'], capacity: 99, occupants: 0 },
      stock: { amount: 0, max: STALL_MAX },
    })
    const p = world.add(walker({ x: 5, y: 5 }, null))
    p.mover!.arrived = true
    p.whim!.kind = 'shop'
    arriveSystem(world, 50)
    expect(p.dweller!.state).toBe('idle')
  })
})

describe('dwellSystem', () => {
  it('ends a seated dwell, releases the bench seat, and returns to idle', () => {
    const world = new World<Entity>()
    const bench = world.add({
      kind: 'bench',
      position: { x: 0, y: 0 },
      affordance: { tags: ['sit'], capacity: 2, occupants: 1 },
    })
    const p = world.add(walker({ x: 0, y: 0 }, null))
    p.dweller!.state = 'sit'
    p.dweller!.until = 100
    p.dweller!.bench = bench
    dwellSystem(world, 100) // tick >= until
    expect(p.dweller!.state).toBe('idle')
    expect(p.dweller!.bench).toBeNull()
    expect(bench.affordance!.occupants).toBe(0)
  })

  it('leaves a seated dwell alone before its timer elapses', () => {
    const world = new World<Entity>()
    const p = world.add(walker({ x: 0, y: 0 }, null))
    p.dweller!.state = 'sit'
    p.dweller!.until = 100
    dwellSystem(world, 99)
    expect(p.dweller!.state).toBe('sit')
  })
})

describe('greetSystem', () => {
  it('two walkers within GREET_RADIUS both enter a greeting', () => {
    const world = new World<Entity>()
    const a = world.add(walker({ x: 0, y: 0 }, { x: 1, y: 0 }))
    const b = world.add(walker({ x: TIMING.GREET_RADIUS - 1, y: 0 }, { x: 1, y: 0 }))
    greetSystem(world, 10)
    expect(a.interactor!.state).toBe('greet')
    expect(b.interactor!.state).toBe('greet')
    expect(a.interactor!.partner).toBe(b)
    expect(a.interactor!.until).toBe(10 + TIMING.GREET_DUR)
  })

  it('does not greet outside GREET_RADIUS', () => {
    const world = new World<Entity>()
    const a = world.add(walker({ x: 0, y: 0 }, { x: 1, y: 0 }))
    const b = world.add(walker({ x: TIMING.GREET_RADIUS + 1, y: 0 }, { x: 1, y: 0 }))
    greetSystem(world, 10)
    expect(a.interactor!.state).toBe('none')
    expect(b.interactor!.state).toBe('none')
  })

  it('respects the per-person greet cooldown', () => {
    const world = new World<Entity>()
    const a = world.add(walker({ x: 0, y: 0 }, { x: 1, y: 0 }))
    world.add(walker({ x: 1, y: 0 }, { x: 1, y: 0 })) // a second walker in range
    a.interactor!.cooldownUntil = 999
    greetSystem(world, 10)
    expect(a.interactor!.state).toBe('none')
  })

  it('expires a greeting once its timer elapses', () => {
    const world = new World<Entity>()
    const a = world.add(walker({ x: 0, y: 0 }, { x: 1, y: 0 }))
    const b = world.add(walker({ x: 1, y: 0 }, null))
    a.interactor!.state = 'greet'
    a.interactor!.partner = b
    a.interactor!.until = 20
    greetSystem(world, 20)
    expect(a.interactor!.state).toBe('none')
    expect(a.interactor!.partner).toBeNull()
  })
})

describe('whimSystem', () => {
  it('an idle townsperson past cooldown rolls "rest" and reserves a bench seat', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5) // shop .4 < .5 < .75 → rest
    const world = new World<Entity>()
    const bench = world.add({
      kind: 'bench',
      position: { x: 500, y: 500 },
      affordance: { tags: ['sit'], capacity: 2, occupants: 0 },
    })
    const p = world.add(walker({ x: 0, y: 0 }, null))
    p.dweller!.state = 'idle'
    p.dweller!.until = 0
    whimSystem(world, 10, ctx)
    expect(p.whim!.kind).toBe('rest')
    expect(p.dweller!.state).toBe('walk')
    expect(p.dweller!.bench).toBe(bench)
    expect(bench.affordance!.occupants).toBe(1)
  })

  it('falls back to wandering when the only bench is full', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5) // would-be rest
    const world = new World<Entity>()
    world.add({
      kind: 'bench',
      position: { x: 500, y: 500 },
      affordance: { tags: ['sit'], capacity: 2, occupants: 2 }, // full
    })
    const p = world.add(walker({ x: 0, y: 0 }, null))
    p.dweller!.state = 'idle'
    p.dweller!.until = 0
    whimSystem(world, 10, ctx)
    expect(p.whim!.kind).toBe('wander')
    expect(p.whim!.target).not.toBeNull()
  })

  it('leaves a townsperson still on cooldown untouched', () => {
    const world = new World<Entity>()
    const p = world.add(walker({ x: 0, y: 0 }, null))
    p.dweller!.state = 'idle'
    p.dweller!.until = 100
    whimSystem(world, 10, ctx) // tick < until
    expect(p.dweller!.state).toBe('idle')
  })
})

describe('birdSystem', () => {
  it('a calm perched bird bolts when a walker enters FLEE_RADIUS', () => {
    const world = new World<Entity>()
    world.add({ ...walker({ x: 100, y: 100 }, { x: 1, y: 0 }) }) // a threat (walking)
    const bird = world.add({
      kind: 'bird',
      position: { x: 100 + TIMING.FLEE_RADIUS - 1, y: 100 },
      perch: { state: 'perch' as const, until: 9999 },
    })
    birdSystem(world, 10, ctx)
    expect(bird.perch!.state).toBe('flee')
    expect(bird.perch!.until).toBe(10 + TIMING.FLEE_DUR)
  })

  it('a seated feeder overrides skittishness — the bird stays calm and flies in', () => {
    const world = new World<Entity>()
    const seated = world.add(walker({ x: 500, y: 500 }, null))
    seated.dweller!.state = 'sit'
    const bird = world.add({
      kind: 'bird',
      position: { x: 0, y: 0 },
      perch: { state: 'flee' as const, until: 9999 },
    })
    birdSystem(world, 10, ctx)
    expect(bird.perch!.state).toBe('perch')
    // It moved toward the feeder's feet rather than fleeing up-and-right.
    expect(bird.position.x).toBeGreaterThan(0)
    expect(bird.position.y).toBeGreaterThan(0)
  })
})

describe('vanSystem', () => {
  it('drives forward and refills the stall through a restock cycle', () => {
    const world = new World<Entity>()
    const stall = world.add({
      kind: 'stall',
      position: { x: 100, y: 350 },
      affordance: { tags: ['shop'], capacity: 99, occupants: 0 },
      stock: { amount: 0, max: STALL_MAX },
    })
    const van = world.add({
      kind: 'van',
      position: { x: 100, y: 350 }, // already at the stall
      vehicle: { state: 'drive' as const, speed: 10, until: 0 },
    })
    vanSystem(world, 100, ctx) // at stall, tick >= until → restock
    expect(van.vehicle!.state).toBe('restock')
    vanSystem(world, 100 + TIMING.VAN_RESTOCK_DUR, ctx) // restock window elapsed → refill
    expect(stall.stock!.amount).toBe(STALL_MAX)
    expect(van.vehicle!.state).toBe('drive')
  })

  it('loops back to the left edge after driving off the right', () => {
    const world = new World<Entity>()
    const van = world.add({
      kind: 'van',
      position: { x: ctx.bounds.w + 1000, y: 350 },
      vehicle: { state: 'drive' as const, speed: 10, until: 0 },
    })
    vanSystem(world, 5, ctx)
    expect(van.position.x).toBeLessThan(0)
  })
})

describe('truckSystem', () => {
  function truckAt(pos: { x: number; y: number }): Entity {
    return {
      kind: 'truck',
      position: { ...pos },
      sprite: { shape: 'truck' },
      deliver: { state: 'load', speed: 20, until: 0, load: 0, drop: null },
    }
  }
  function factoryAt(world: World<Entity>, pos: { x: number; y: number }): Entity {
    return world.add({
      kind: 'factory',
      position: { ...pos },
      affordance: { tags: ['supply'], capacity: 99, occupants: 0 },
    })
  }
  function pileBrickAt(world: World<Entity>, pos: { x: number; y: number }): Entity {
    return world.add({ kind: 'brick', position: { ...pos }, brick: { state: 'pile' as const } })
  }

  it('departs the factory with a load when the pile is nearly dry', () => {
    const world = new World<Entity>()
    factoryAt(world, { x: 1800, y: 200 })
    // Parked AT the dock (below the factory), loaded, no bricks anywhere.
    const t = world.add(truckAt({ x: 1800, y: 200 + FACTORY_DOCK_Y }))
    truckSystem(world, 10, ctx)
    expect(t.deliver!.state).toBe('haul')
    expect(t.deliver!.load).toBe(TRUCK.LOAD)
    expect(t.deliver!.drop).not.toBeNull()
    expect(t.deliver!.drop!.x).toBeGreaterThanOrEqual(0)
    expect(t.deliver!.drop!.x).toBeLessThanOrEqual(ctx.bounds.w)
  })

  it('holds at the factory while the crew is still stocked', () => {
    const world = new World<Entity>()
    factoryAt(world, { x: 1800, y: 200 })
    for (let i = 0; i <= TRUCK.LOW_WATER; i++) pileBrickAt(world, { x: 500, y: 500 }) // one over the mark
    const t = world.add(truckAt({ x: 1800, y: 200 }))
    truckSystem(world, 10, ctx)
    expect(t.deliver!.state).toBe('load')
    expect(t.deliver!.load).toBe(0)
  })

  it('dumps its load at the drop point as fresh pile bricks', () => {
    const world = new World<Entity>()
    factoryAt(world, { x: 1800, y: 200 })
    const t = world.add(truckAt({ x: 500, y: 500 }))
    t.deliver!.state = 'haul'
    t.deliver!.load = TRUCK.LOAD
    t.deliver!.drop = { x: 500, y: 500 } // already there
    truckSystem(world, 10, ctx) // arrival → dump pause
    expect(t.deliver!.state).toBe('dump')
    expect(t.deliver!.until).toBe(10 + TRUCK.DUMP_DUR)
    truckSystem(world, 10 + TRUCK.DUMP_DUR, ctx) // pause over → tip the load off
    const piles = [...world.with('brick')].filter((e) => e.brick!.state === 'pile')
    expect(piles.length).toBe(TRUCK.LOAD)
    expect(t.deliver!.state).toBe('return')
    expect(t.deliver!.load).toBe(0)
  })

  it('rounds a tower corner it is standing one step short of (no ping-pong)', () => {
    // Regression: the avoidance walk used to SKIP any corner within one step,
    // so a truck stopped just shy of the goal-side corner fell back to the
    // backward corner and oscillated there forever, starving the crew.
    const world = new World<Entity>()
    factoryAt(world, { x: 900, y: 300 })
    world.add({
      kind: 'brick',
      position: { x: 500, y: 500 }, // a placed tower between truck and factory
      brick: { state: 'placed' as const, w: 96, h: 44, slot: 0 },
    })
    const t = world.add(truckAt({ x: 560, y: 553 })) // just shy of the tower's low-right corner
    t.deliver!.state = 'return'
    let homeAt = 0
    for (let tick = 1; tick <= 60 && !homeAt; tick++) {
      truckSystem(world, tick, ctx)
      if (t.deliver!.state === 'load') homeAt = tick
    }
    expect(homeAt).toBeGreaterThan(0) // made it home instead of oscillating
    expect(homeAt).toBeLessThan(40) // and by a direct route around the corner
  })

  it('returns to the factory and starts reloading', () => {
    const world = new World<Entity>()
    factoryAt(world, { x: 1800, y: 200 })
    const t = world.add(truckAt({ x: 1800, y: 200 + FACTORY_DOCK_Y })) // already at the dock
    t.deliver!.state = 'return'
    truckSystem(world, 50, ctx)
    expect(t.deliver!.state).toBe('load')
    expect(t.deliver!.until).toBe(50 + TRUCK.LOAD_DUR)
  })

  it('parks under the factory (at the dock, below its centre), not on top of it', () => {
    const world = new World<Entity>()
    factoryAt(world, { x: 1800, y: 200 })
    for (let i = 0; i <= TRUCK.LOW_WATER; i++) pileBrickAt(world, { x: 500, y: 500 }) // stocked → truck holds at the dock
    const t = world.add(truckAt({ x: 1800, y: 200 })) // dropped ON the factory centre
    // It should drive DOWN to the dock and wait there, below the factory.
    for (let tick = 1; tick <= 40; tick++) truckSystem(world, tick, ctx)
    expect(t.deliver!.state).toBe('load') // still parked (stocked crew)
    expect(t.position.y).toBeGreaterThan(200) // ended up below the factory centre
    expect(Math.abs(t.position.y - (200 + FACTORY_DOCK_Y))).toBeLessThanOrEqual(MOVE.ARRIVE_EPS)
    expect(Math.abs(t.position.x - 1800)).toBeLessThanOrEqual(MOVE.ARRIVE_EPS)
  })

  it('drives in straight axis-aligned legs, never diagonally', () => {
    const world = new World<Entity>()
    factoryAt(world, { x: 1800, y: 200 })
    const t = world.add(truckAt({ x: 400, y: 900 })) // far corner → a long haul home
    t.deliver!.state = 'return'
    let diagonalSteps = 0
    for (let tick = 1; tick <= 200; tick++) {
      const before = { x: t.position.x, y: t.position.y }
      truckSystem(world, tick, ctx)
      const movedX = Math.abs(t.position.x - before.x) > 1e-6
      const movedY = Math.abs(t.position.y - before.y) > 1e-6
      if (movedX && movedY) diagonalSteps++ // a single tick moved on BOTH axes
      if (t.deliver!.state === 'load') break
    }
    expect(diagonalSteps).toBe(0)
  })
})

describe('gardenerSystem', () => {
  function flowerAt(world: World<Entity>, base: { x: number; y: number }): Entity {
    return world.add({
      kind: 'flower',
      position: { x: base.x, y: base.y - 6 },
      sprite: { shape: 'flower' },
      plant: {
        variety: 'flower' as const,
        grow: 0,
        rate: 0.1,
        base: { ...base },
        minW: 10,
        maxW: 64,
        minH: 12,
        maxH: 90,
        w: 10,
        h: 12,
      },
    })
  }
  function gardenerAt(world: World<Entity>, pos: { x: number; y: number }): Entity {
    return world.add({
      kind: 'gardener',
      position: { ...pos },
      sprite: { shape: 'gardener' },
      garden: { state: 'idle' as const, target: null, variety: null, speed: MOVE.WALK, until: 0, wander: 0 },
    })
  }
  function placedBrick(world: World<Entity>, pos: { x: number; y: number }): Entity {
    return world.add({
      kind: 'brick',
      position: { ...pos },
      brick: { state: 'placed' as const, w: 96, h: 44, slot: 0 },
    })
  }

  it('grows a plant toward full size while pinning its base foot in place', () => {
    const world = new World<Entity>()
    const base = { x: 500, y: 500 }
    const f = flowerAt(world, base)
    gardenerSystem(world, 1, ctx) // growth runs even with no gardener present
    expect(f.plant!.grow).toBeCloseTo(0.1, 5)
    expect(f.plant!.h).toBeGreaterThan(12) // taller than the seedling
    expect(f.plant!.base).toEqual(base) // foot never moves
    // Its centre rides up so the bottom edge stays on the base.
    expect(f.position.y).toBeCloseTo(base.y - f.plant!.h / 2, 5)
    // Growth is monotonic and saturates at full.
    for (let t = 2; t <= 40; t++) gardenerSystem(world, t, ctx)
    expect(f.plant!.grow).toBe(1)
    expect(f.plant!.h).toBeCloseTo(90, 5)
  })

  it("walks to the plot, sows the first crop, and stakes that row's label sign", () => {
    const world = new World<Entity>()
    gardenerAt(world, { x: 1000, y: 700 })
    let planted = 0
    for (let t = 1; t <= 400 && planted === 0; t++) {
      gardenerSystem(world, t, ctx)
      planted = [...world.with('plant')].length
    }
    expect(planted).toBeGreaterThan(0)
    // Rows fill in order, so the first crop sown is the plot's first row: carrots.
    const sown = [...world.with('plant')][0]
    expect(sown.plant!.variety).toBe('carrot')
    // ...and that row gets exactly one labelled signpost staked at its head.
    const signs = [...world.with('sign')]
    expect(signs).toHaveLength(1)
    expect(signs[0].sign!.variety).toBe('carrot')
    expect(signs[0].sign!.label).toBe('CARROTS')
  })

  it('runs a vine up the tower: its height chases the tower top', () => {
    const world = new World<Entity>()
    // A three-course tower foot near y=500, climbing up to y≈380.
    placedBrick(world, { x: 500, y: 500 })
    placedBrick(world, { x: 500, y: 456 })
    placedBrick(world, { x: 500, y: 412 })
    // A vine planted at the tower foot.
    const vine = world.add({
      kind: 'vine',
      position: { x: 500, y: 512 },
      sprite: { shape: 'vine' },
      plant: {
        variety: 'vine' as const,
        grow: 0,
        rate: 1, // full-grown immediately, so h == maxH
        base: { x: 500, y: 522 },
        minW: 24,
        maxW: 46,
        minH: 20,
        maxH: 20, // placeholder — growPlant should overwrite it toward the tower top
        w: 24,
        h: 20,
      },
    })
    gardenerSystem(world, 1, ctx)
    // maxH stretched to reach past the tower top (base.y − tower.minY + margin).
    const towerTop = 412 - 22 // topmost brick centre minus half its height
    expect(vine.plant!.maxH).toBeGreaterThan(vine.plant!.base.y - towerTop)
    // Fully grown, it's as tall as that ceiling and reaches above the tower top.
    expect(vine.plant!.h).toBeCloseTo(vine.plant!.maxH, 5)
    expect(vine.position.y - vine.plant!.h / 2).toBeLessThan(towerTop)
  })
})

describe('tally', () => {
  it('counts a bench chat only when two people share one bench', () => {
    const world = new World<Entity>()
    const bench = world.add({
      kind: 'bench',
      position: { x: 0, y: 0 },
      affordance: { tags: ['sit'], capacity: 2, occupants: 2 },
    })
    for (let i = 0; i < 2; i++) {
      const p = world.add(walker({ x: 0, y: 0 }, null))
      p.dweller!.state = 'sit'
      p.dweller!.bench = bench
    }
    expect(tally(world).bench).toBe(1)
  })

  it('counts a greeting pair as a single interaction', () => {
    const world = new World<Entity>()
    for (let i = 0; i < 2; i++) {
      const p = world.add(walker({ x: 0, y: 0 }, null))
      p.interactor!.state = 'greet'
    }
    const t = tally(world)
    expect(t.greet).toBe(1)
    expect(t.total).toBe(1)
  })

  it('sums every interaction kind into total', () => {
    const world = new World<Entity>()
    const shopper = world.add(walker({ x: 0, y: 0 }, null))
    shopper.dweller!.state = 'shop' // buy: 1
    const flee = world.add({ kind: 'bird', position: { x: 0, y: 0 }, perch: { state: 'flee' as const, until: 0 } }) // flee: 1
    expect(flee.perch!.state).toBe('flee')
    const t = tally(world)
    expect(t.buy).toBe(1)
    expect(t.flee).toBe(1)
    expect(t.total).toBe(2)
  })
})

describe('runScene', () => {
  it('folds a pipeline in order and returns the tally', () => {
    const world = new World<Entity>()
    const p = world.add(walker({ x: 0, y: 0 }, { x: 1000, y: 0 }))
    const t = runScene(world, 1, ctx, [moveSystem])
    expect(p.position.x).toBeCloseTo(MOVE.WALK, 5) // moveSystem ran
    expect(t).toHaveProperty('total')
  })
})
