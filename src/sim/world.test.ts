/**
 * World-construction tests — buildWorld folds a SceneDef into a Miniplex world,
 * and dropEntity is the live-drop delegate over the character registry. These
 * pin the Busytown "verified roster" (the behavior-preservation anchor) and the
 * placement rules (roster entries cycle over the scene's props by kind).
 */
import { describe, it, expect } from 'vitest'
import { buildWorld, dropEntity } from './components'
import type { Entity } from './components'
import { busytown } from '../content/scenes/busytown'
import { pondside } from '../content/scenes/pondside'

const count = (world: ReturnType<typeof buildWorld>, kind: string) =>
  [...world.entities].filter((e: Entity) => e.kind === kind).length

describe('buildWorld — Busytown verified roster', () => {
  const world = buildWorld(busytown)

  it('instantiates every prop and roster entry at the documented counts', () => {
    expect(count(world, 'townsperson')).toBe(7)
    expect(count(world, 'bird')).toBe(4)
    expect(count(world, 'bench')).toBe(2)
    expect(count(world, 'stall')).toBe(1)
    expect(count(world, 'house')).toBe(3)
    expect(count(world, 'tree')).toBe(3)
    expect(count(world, 'van')).toBe(1)
  })

  it('gives townsfolk the mover/whim/dweller/interactor behavior components', () => {
    const person = [...world.entities].find((e) => e.kind === 'townsperson')!
    expect(person.mover).toBeDefined()
    expect(person.whim).toBeDefined()
    expect(person.dweller).toBeDefined()
    expect(person.interactor).toBeDefined()
  })

  it('places townsfolk onto the scene houses (atKind cycling)', () => {
    const houses = busytown.props.filter((p) => p.kind === 'house').map((p) => `${p.at.x},${p.at.y}`)
    const folk = [...world.entities].filter((e) => e.kind === 'townsperson')
    for (const p of folk) expect(houses).toContain(`${p.position.x},${p.position.y}`)
  })

  it('copies placement points (no shared Vec2 references between instances)', () => {
    const folk = [...world.entities].filter((e) => e.kind === 'townsperson')
    folk[0].position.x += 12345
    expect(folk.some((p, i) => i !== 0 && p.position.x === folk[0].position.x)).toBe(false)
  })
})

describe('buildWorld — a second scene', () => {
  it('builds Pondside with its own props (the new drink affordance + a dog)', () => {
    const world = buildWorld(pondside)
    const hasDrink = [...world.entities].some((e) => e.affordance?.tags.includes('drink'))
    expect(hasDrink).toBe(true)
    expect(count(world, 'dog')).toBeGreaterThan(0)
  })
})

describe('dropEntity', () => {
  it('adds a registered kind to the world and returns the new entity', () => {
    const world = buildWorld(busytown)
    const before = count(world, 'bench')
    const dropped = dropEntity(world, 'bench', { x: 10, y: 20 })
    expect(dropped).not.toBeNull()
    expect(dropped!.kind).toBe('bench')
    expect(dropped!.position).toEqual({ x: 10, y: 20 })
    expect(count(world, 'bench')).toBe(before + 1)
  })

  it('returns null for an unregistered kind and adds nothing', () => {
    const world = buildWorld(busytown)
    const before = [...world.entities].length
    expect(dropEntity(world, 'nope', { x: 0, y: 0 })).toBeNull()
    expect([...world.entities].length).toBe(before)
  })
})
