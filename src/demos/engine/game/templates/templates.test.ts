import { describe, it, expect } from 'vitest'
import { TEMPLATE_LIST } from './index'
import { LevelLayoutSchema } from '../ai/schemas'
import { ROLES } from '../roles'

// Templates are frozen, hand-authored level data + rules (PLAN §5.5). These tests
// are their regression fixtures: every template must be structurally winnable —
// exactly one player, a goal, valid roles, and sane rules — so a refactor that
// breaks the role vocabulary or the level shape fails here, loudly.

describe('templates — structural validity', () => {
  for (const { key, template } of TEMPLATE_LIST) {
    describe(`${key} (${template.name})`, () => {
      it('has exactly one player', () => {
        const players = template.level.filter((p) => p.role === 'player')
        expect(players).toHaveLength(1)
      })

      it('has a goal (the win condition is reachable)', () => {
        expect(template.level.some((p) => p.role === 'goal')).toBe(true)
      })

      it('uses only real roles', () => {
        for (const p of template.level) {
          expect(ROLES[p.role]).toBeDefined()
        }
      })

      it('is a valid LevelLayout when wrapped', () => {
        const layout = { version: 1 as const, placements: template.level }
        expect(LevelLayoutSchema.safeParse(layout).success).toBe(true)
      })

      it('has sane session rules (positive lives)', () => {
        expect(template.rules.lives).toBeGreaterThan(0)
        expect(template.rules.tokenScore).toBeGreaterThanOrEqual(0)
      })
    })
  }
})
