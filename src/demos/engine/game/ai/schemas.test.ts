import { describe, it, expect } from 'vitest'
import { LevelLayoutSchema, TunablesPatchSchema, RoleSchema } from './schemas'
import { PHYSICS_DEFAULTS } from '../physics'
import { ROLE_LIST } from '../roles'

describe('RoleSchema', () => {
  it('accepts every registered role and nothing else', () => {
    for (const role of ROLE_LIST) expect(RoleSchema.safeParse(role).success).toBe(true)
    expect(RoleSchema.safeParse('enemy').success).toBe(false)
    expect(RoleSchema.safeParse('').success).toBe(false)
  })
})

describe('LevelLayoutSchema', () => {
  it('parses a valid level', () => {
    const level = {
      version: 1,
      placements: [
        { role: 'player', x: 90, y: 360 },
        { role: 'wall', x: 40, y: 440, w: 820, h: 32 },
        { role: 'goal', x: 792, y: 368 },
      ],
    }
    expect(LevelLayoutSchema.safeParse(level).success).toBe(true)
  })

  it('rejects an unknown role', () => {
    const bad = { version: 1, placements: [{ role: 'dragon', x: 0, y: 0 }] }
    expect(LevelLayoutSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects a non-finite coordinate and a missing version', () => {
    expect(
      LevelLayoutSchema.safeParse({ version: 1, placements: [{ role: 'wall', x: 'left', y: 0 }] })
        .success,
    ).toBe(false)
    expect(LevelLayoutSchema.safeParse({ placements: [] }).success).toBe(false)
  })

  it('rejects non-positive w/h (a zero-size shape is unplayable)', () => {
    const bad = { version: 1, placements: [{ role: 'wall', x: 0, y: 0, w: 0, h: 10 }] }
    expect(LevelLayoutSchema.safeParse(bad).success).toBe(false)
  })
})

describe('TunablesPatchSchema', () => {
  it('accepts a partial patch of known knobs', () => {
    expect(TunablesPatchSchema.safeParse({ jumpSpeed: 950, gravity: 1800 }).success).toBe(true)
    expect(TunablesPatchSchema.safeParse({}).success).toBe(true)
  })

  it('rejects an unknown knob (strict)', () => {
    expect(TunablesPatchSchema.safeParse({ notAKnob: 1 }).success).toBe(false)
  })

  it('covers every real tunable key', () => {
    const full = Object.fromEntries(Object.keys(PHYSICS_DEFAULTS).map((k) => [k, 1]))
    expect(TunablesPatchSchema.safeParse(full).success).toBe(true)
  })

  it('rejects a non-number value', () => {
    expect(TunablesPatchSchema.safeParse({ gravity: 'high' }).success).toBe(false)
  })
})
