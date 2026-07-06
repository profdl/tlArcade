import { describe, it, expect, beforeEach } from 'vitest'
import { applyTunables } from './autoTune'
import { makeTunables } from '../physics'
import { tunablesAtom } from '../state'

describe('applyTunables', () => {
  beforeEach(() => tunablesAtom.set(makeTunables()))

  it('merges a partial patch over the current tunables', () => {
    const before = tunablesAtom.get()
    const merged = applyTunables({ jumpSpeed: 950 })
    expect(merged.jumpSpeed).toBe(950)
    // Untouched knobs keep their prior value.
    expect(merged.gravity).toBe(before.gravity)
    // The atom now reflects the merge (runtime reads this each substep).
    expect(tunablesAtom.get().jumpSpeed).toBe(950)
  })

  it('clamps values to each knob panel range', () => {
    // jumpSpeed panel range is 200..1600 (see TUNABLE_GROUPS).
    expect(applyTunables({ jumpSpeed: 99999 }).jumpSpeed).toBe(1600)
    expect(applyTunables({ jumpSpeed: -5 }).jumpSpeed).toBe(200)
  })

  it('ignores undefined values in a patch', () => {
    const before = tunablesAtom.get().moveSpeed
    const merged = applyTunables({ moveSpeed: undefined })
    expect(merged.moveSpeed).toBe(before)
  })

  it('applies several knobs at once', () => {
    const merged = applyTunables({ gravity: 1800, jumpCut: 0.6, coyoteTime: 0.15 })
    expect(merged.gravity).toBe(1800)
    expect(merged.jumpCut).toBe(0.6)
    expect(merged.coyoteTime).toBe(0.15)
  })
})
