import { describe, expect, it } from 'vitest'
import { ROLES, ROLE_LIST, ROLE_CATEGORIES, roleForColor, shapeForRole } from './roles'

// Pins the role registry's load-bearing invariants: unique behavior-colors, the
// platform's grey+dashed+marker rendering (so it's not misread as a wall), and that
// every role is reachable from a tray category (all tray items have a home).

describe('role colors', () => {
  it('every role has a unique color EXCEPT platform, which reuses grey', () => {
    // Color is behavior, so colors must be unique — the one intentional exception is
    // `platform`, which is grey like a wall and disambiguated by a meta.role marker.
    const colorToRoles = new Map<string, string[]>()
    for (const role of ROLE_LIST) {
      const c = ROLES[role].color
      colorToRoles.set(c, [...(colorToRoles.get(c) ?? []), role])
    }
    const shared = [...colorToRoles.entries()].filter(([, roles]) => roles.length > 1)
    expect(shared).toEqual([['grey', ['wall', 'platform']]])
  })

  it('roleForColor maps grey to WALL (the platform relies on a marker instead)', () => {
    expect(roleForColor('grey')).toBe('wall')
  })

  it('roleForColor resolves each non-grey role color back to that role', () => {
    for (const role of ROLE_LIST) {
      if (ROLES[role].color === 'grey') continue
      expect(roleForColor(ROLES[role].color)).toBe(role)
    }
  })
})

describe('shapeForRole', () => {
  it('a platform is grey, dashed, and carries the role marker (so grey ≠ wall)', () => {
    const s = shapeForRole('platform') as {
      props: { color: string; dash: string }
      meta?: { role?: string }
    }
    expect(s.props.color).toBe('grey')
    expect(s.props.dash).toBe('dashed')
    expect(s.meta?.role).toBe('platform')
  })

  it('a wall is grey, solid, and carries NO marker (plain terrain)', () => {
    const s = shapeForRole('wall') as { props: { color: string; dash: string }; meta?: unknown }
    expect(s.props.color).toBe('grey')
    expect(s.props.dash).toBe('solid')
    expect(s.meta).toBeUndefined()
  })

  it('a solid role gets a solid fill; a trigger gets a semi fill', () => {
    expect((shapeForRole('wall') as { props: { fill: string } }).props.fill).toBe('solid')
    expect((shapeForRole('token') as { props: { fill: string } }).props.fill).toBe('semi')
  })
})

describe('tray categories', () => {
  it('every role appears in exactly one category (no orphans, no dupes)', () => {
    const categorized = ROLE_CATEGORIES.flatMap((c) => c.roles)
    expect([...categorized].sort()).toEqual([...ROLE_LIST].sort())
    expect(categorized.length).toBe(ROLE_LIST.length) // no role listed twice
  })
})
