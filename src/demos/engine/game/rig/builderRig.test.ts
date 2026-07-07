/**
 * Engine — default builder rig structure tests.
 */
import { describe, expect, it } from 'vitest'
import { builderRig, BUILDER_LIMB_BONES } from './builderRig'
import { evaluateRig, evaluateBoneWorlds } from './evaluate'

const LIMBS = { armL: 'aL', armR: 'aR', legL: 'lL', legR: 'lR' }

describe('builderRig', () => {
  it('has a torso root plus one bone per limb', () => {
    const rig = builderRig(60, 120, LIMBS)
    expect(rig.root).toBe('torso')
    expect(rig.bones.map((b) => b.id).sort()).toEqual(['armL', 'armR', 'legL', 'legR', 'torso'].sort())
    // The torso is the only root; every limb hangs off it.
    expect(rig.bones.filter((b) => b.parentId === null).map((b) => b.id)).toEqual(['torso'])
    for (const id of BUILDER_LIMB_BONES) {
      expect(rig.bones.find((b) => b.id === id)!.parentId).toBe('torso')
    }
  })

  it('attaches each limb bone to its passed leaf id via a rigid slot', () => {
    const rig = builderRig(60, 120, LIMBS)
    const skin = rig.skins.default
    const byBone = Object.fromEntries(
      rig.slots.map((s) => {
        const att = skin[s.id]
        return [s.boneId, att.kind === 'rigid' ? att.leafId : null]
      }),
    )
    expect(byBone).toEqual({ armL: 'aL', armR: 'aR', legL: 'lL', legR: 'lR' })
  })

  it('places limb pivots at scaled joint positions (arms above legs, sides split)', () => {
    const rig = builderRig(100, 200, LIMBS)
    const b = Object.fromEntries(rig.bones.map((x) => [x.id, x]))
    // Arms higher (smaller y) than legs.
    expect(b.armL.y).toBeLessThan(b.legL.y)
    // Left limbs left of right limbs.
    expect(b.armL.x).toBeLessThan(b.armR.x)
    expect(b.legL.x).toBeLessThan(b.legR.x)
    // Scales with figure size (200-tall figure → pivots in that px range).
    expect(b.armL.y).toBeGreaterThan(0)
    expect(b.armL.y).toBeLessThan(200)
  })

  it('places each limb pivot at its ATTACHMENT joint (measured from the art)', () => {
    // Figure 100×200 → pivots in px. Joints are normalized·size (builderRig LIMBS).
    const rig = builderRig(100, 200, LIMBS)
    const b = Object.fromEntries(rig.bones.map((x) => [x.id, x]))
    // Shoulders: near the top of the torso (~0.45·200 = 90px), inboard.
    expect(b.armR.y).toBeCloseTo(0.45 * 200, 0) // ~90
    expect(b.armL.y).toBeCloseTo(0.47 * 200, 0)
    // Right shoulder inboard-left of the right arm (joint x < the arm's right edge).
    expect(b.armR.x).toBeCloseTo(0.73 * 100, 0)
    expect(b.armL.x).toBeCloseTo(0.34 * 100, 0)
    // Hips: near the bottom of the torso (~0.77·200 = 154px), at the TOP of each leg.
    expect(b.legR.y).toBeCloseTo(0.77 * 200, 0)
    expect(b.legL.y).toBeCloseTo(0.78 * 200, 0)
  })

  it('each bone lies ALONG its limb (rest tip points down/out, not criss-cross)', () => {
    const rig = builderRig(100, 200, LIMBS)
    const segs = evaluateBoneWorlds(rig, {})
    // 4 limb bones only (the zero-length torso root is skipped).
    expect(segs.length).toBe(4)
    // Order: armL, armR, legL, legR (rig.bones order minus torso).
    const [armL, armR, legL, legR] = segs
    // Arms extend OUTWARD horizontally: left arm tip further LEFT than its pivot;
    // right arm tip further RIGHT than its pivot.
    expect(armL.tip.x).toBeLessThan(armL.pivot.x)
    expect(armR.tip.x).toBeGreaterThan(armR.pivot.x)
    // Legs extend DOWNWARD: tip y below the pivot (hip).
    expect(legL.tip.y).toBeGreaterThan(legL.pivot.y)
    expect(legR.tip.y).toBeGreaterThan(legR.pivot.y)
  })

  it('at rest evaluates to identity deltas (figure looks as drawn)', () => {
    const rig = builderRig(60, 120, LIMBS)
    const deltas = evaluateRig(rig, {})
    for (const leaf of ['aL', 'aR', 'lL', 'lR']) {
      const d = deltas.get(leaf)!
      // identity: a,d ≈ 1; b,c,tx,ty ≈ 0
      expect(d.a).toBeCloseTo(1, 9)
      expect(d.d).toBeCloseTo(1, 9)
      expect(d.tx).toBeCloseTo(0, 9)
      expect(d.ty).toBeCloseTo(0, 9)
    }
  })

  it('swinging a leg bone orbits its leaf about the hip, not the leaf center', () => {
    const rig = builderRig(100, 200, LIMBS)
    const hip = rig.bones.find((x) => x.id === 'legL')!
    const d = evaluateRig(rig, { legL: { rotation: Math.PI / 2 } }).get('lL')!
    // A point AT the hip pivot is unmoved by the swing.
    const px = hip.x
    const py = hip.y
    const moved = { x: d.a * px + d.c * py + d.tx, y: d.b * px + d.d * py + d.ty }
    expect(moved.x).toBeCloseTo(px, 6)
    expect(moved.y).toBeCloseTo(py, 6)
  })
})
