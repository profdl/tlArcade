import { describe, expect, it } from 'vitest'
import { TEMPLATES } from './index'
import { moverPosition, sinePosition } from '../entities/step'
import { springLaunchV, blinkSolidAt } from '../entities/props'

// Tier-1 template integration checks (PLAN §4.7): the Underground + Factory
// templates are the exit test for the Tier-1 primitives. These assert that each
// template actually USES its intended primitives and that the meta configs it ships
// drive the pure motion/effect functions sensibly — so a mis-authored template
// (a mover with no path, a blink with a zero period, a plant that never moves)
// fails here rather than silently sitting still in the running game.

describe('Underground template — uses the Tier-1 underground primitives', () => {
  const level = TEMPLATES.underground.level

  it('bonkable ?-blocks (T1b), at least one containing a token', () => {
    const blocks = level.filter((p) => p.role === 'block')
    expect(blocks.length).toBeGreaterThanOrEqual(2)
    expect(blocks.some((b) => b.meta?.contains === 'token')).toBe(true)
  })

  it('a warp-pipe pair on a shared channel (T1c)', () => {
    const portals = level.filter((p) => p.role === 'portal')
    expect(portals).toHaveLength(2)
    // Both ends share the same channel so the runtime can pair them.
    expect(portals[0].meta?.channel).toBe(portals[1].meta?.channel)
  })

  it('an oscillating plant enemy (T1d) whose sine actually moves it', () => {
    const plant = level.find((p) => p.role === 'enemy' && p.meta?.sine)
    expect(plant).toBeDefined()
    const sine = plant!.meta!.sine!
    const params = { sine, sineBase: { x: plant!.x, y: plant!.y } }
    // Over a quarter period it displaces by the amplitude (not stuck in place).
    const quarter = 1 / (4 * sine.frequency)
    const moved = sinePosition(params, quarter)!
    expect(Math.abs(moved.y - plant!.y)).toBeGreaterThan(sine.amplitude * 0.9)
  })

  it('has real pits (multiple floor runs) for the T0 kill-plane', () => {
    const floors = level.filter((p) => p.role === 'wall' && (p.h ?? 0) >= 120 && (p.w ?? 0) >= 300)
    expect(floors.length).toBeGreaterThanOrEqual(2) // split floor ⇒ a gap between
  })
})

describe('Factory template — uses the Tier-1 factory primitives', () => {
  const level = TEMPLATES.factory.level

  it('a moving platform (T1e) with a non-degenerate path', () => {
    const mover = level.find((p) => p.role === 'platform' && p.meta?.path)
    expect(mover).toBeDefined()
    const path = mover!.meta!.path!
    expect(path.speed).toBeGreaterThan(0)
    // The path actually spans a distance (A ≠ B), so it really travels.
    const start = moverPosition(path, 0)!
    const later = moverPosition(path, 1)!
    expect(Math.hypot(later.x - start.x, later.y - start.y)).toBeGreaterThan(1)
  })

  it('a blink-platform gauntlet (T1f) whose pads phase on and off', () => {
    const blinkers = level.filter((p) => p.role === 'platform' && p.meta?.blink)
    expect(blinkers.length).toBeGreaterThanOrEqual(3)
    // Each blinker has a valid (non-degenerate) on/off period.
    for (const b of blinkers) {
      const { onMs, offMs } = b.meta!.blink!
      expect(onMs + offMs).toBeGreaterThan(0)
    }
    // Staggered phases mean at least two pads differ in solidity at some instant.
    const solidAt = (tSec: number) =>
      blinkers.map((b) => blinkSolidAt(tSec, b.meta!.blink!.onMs, b.meta!.blink!.offMs, b.meta!.blink!.phaseMs))
    const anyStaggered = [0, 0.5, 1, 1.5, 2].some((tSec) => {
      const s = solidAt(tSec)
      return s.some((v) => v !== s[0])
    })
    expect(anyStaggered).toBe(true)
  })

  it('a crumble pad (T1f)', () => {
    expect(level.some((p) => p.role === 'platform' && p.meta?.crumbleMs != null)).toBe(true)
  })

  it('an angled spring (T1a) that launches with horizontal component', () => {
    const spring = level.find((p) => p.role === 'spring' && p.meta?.launchAngle)
    expect(spring).toBeDefined()
    const v = springLaunchV(860, spring!.meta!.launchAngle)
    expect(Math.abs(v.vx)).toBeGreaterThan(0) // angled ⇒ real sideways launch
    expect(v.vy).toBeLessThan(0) // still launches upward
  })
})
