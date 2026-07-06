/**
 * Engine — autoLevel grid snapping.
 *
 * The AI emits a LevelLayout in continuous page pixels, but the rest of the game
 * (level.ts, templates, the tray) lives on the 60px TILE grid. `snapToTile` is the
 * safety net in `applyLevelLayout` that lands even off-grid model output ON the
 * grid, so an AI level reads as clean as a hand-built one. The apply path itself is
 * editor-bound (createShape/run/zoomToFit) and isn't unit-tested; this pins the
 * pure rounding it relies on.
 */
import { describe, it, expect } from 'vitest'
import { snapToTile } from './autoLevel'
import { TILE } from '../roles'

describe('snapToTile', () => {
  it('leaves on-grid values untouched', () => {
    expect(snapToTile(0)).toBe(0)
    expect(snapToTile(TILE)).toBe(TILE)
    expect(snapToTile(12 * TILE)).toBe(12 * TILE)
  })

  it('rounds off-grid values to the nearest whole tile', () => {
    expect(snapToTile(TILE * 0.4)).toBe(0) // 24 → 0
    expect(snapToTile(TILE * 0.6)).toBe(TILE) // 36 → 60
    expect(snapToTile(487)).toBe(480) // a stray "ground ~480" snaps to row 8
    expect(snapToTile(133)).toBe(120) // → 2 tiles
  })

  it('always returns a whole multiple of TILE', () => {
    for (const v of [1, 29, 31, 59, 61, 455, 903, -37]) {
      expect(Math.abs(snapToTile(v) % TILE)).toBe(0) // abs() normalizes JS's -0
    }
  })

  it('snaps negative page coordinates too (levels can extend left of origin)', () => {
    expect(snapToTile(-TILE)).toBe(-TILE)
    expect(snapToTile(-133)).toBe(-120)
  })
})
