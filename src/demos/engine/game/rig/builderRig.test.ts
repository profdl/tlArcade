/**
 * Engine — default builder rig structure tests (Phase 1' chain skeleton).
 */
import { describe, expect, it } from 'vitest'
import { builderRig, BUILDER_LIMB_BONES, BUILDER_BODY_BONES } from './builderRig'
import { evaluateRig, evaluateBoneWorlds } from './evaluate'

const IDS = {
  armL: 'aL', armR: 'aR', legL: 'lL', legR: 'lR',
  torso: 'to', head: 'hd', smile: 'sm', eyeL: 'eL', eyeR: 'eR',
}

describe('builderRig', () => {
  it('is a pelvis→spine→head chain with the four limbs hanging off the spine', () => {
    const rig = builderRig(60, 120, IDS)
    expect(rig.root).toBe('pelvis')
    expect(rig.bones.map((b) => b.id).sort()).toEqual(
      ['pelvis', 'spine', 'head', ...BUILDER_LIMB_BONES].sort(),
    )
    // Exactly one root.
    expect(rig.bones.filter((b) => b.parentId === null).map((b) => b.id)).toEqual(['pelvis'])
    // The chain.
    expect(rig.bones.find((b) => b.id === 'spine')!.parentId).toBe('pelvis')
    expect(rig.bones.find((b) => b.id === 'head')!.parentId).toBe('spine')
    // Limbs hang off the spine so they follow the body's bob/lean.
    for (const id of BUILDER_LIMB_BONES) {
      expect(rig.bones.find((b) => b.id === id)!.parentId).toBe('spine')
    }
  })

  it('drives torso off the spine and head+smile+eyes off the head bone', () => {
    const rig = builderRig(60, 120, IDS)
    const skin = rig.skins.default
    // boneId → [leafIds] driven by it.
    const byBone: Record<string, string[]> = {}
    for (const s of rig.slots) {
      const att = skin[s.attachment]
      if (att.kind === 'rigid') (byBone[s.boneId] ??= []).push(att.leafId)
    }
    expect(byBone.spine).toEqual(['to'])
    expect(byBone.head.sort()).toEqual(['eL', 'eR', 'hd', 'sm'].sort())
    expect(byBone.armL).toEqual(['aL'])
    expect(byBone.legR).toEqual(['lR'])
  })

  it('places limb pivots at scaled joint positions (arms above legs, sides split)', () => {
    const rig = builderRig(100, 200, IDS)
    const segs = evaluateBoneWorlds(rig, {})
    const byId = Object.fromEntries(segs.map((s) => [s.id, s]))
    // Arms higher (smaller world-y pivot) than legs.
    expect(byId.armL.pivot.y).toBeLessThan(byId.legL.pivot.y)
    // Left limbs left of right limbs.
    expect(byId.armL.pivot.x).toBeLessThan(byId.armR.pivot.x)
    expect(byId.legL.pivot.x).toBeLessThan(byId.legR.pivot.x)
  })

  it('places each limb pivot at its measured attachment joint (world space)', () => {
    // evaluateBoneWorlds gives entity-local pivots; the chain composes to the same
    // anatomical joints regardless of the pelvis/spine offsets.
    const rig = builderRig(100, 200, IDS)
    const byId = Object.fromEntries(evaluateBoneWorlds(rig, {}).map((s) => [s.id, s]))
    // Shoulders ~ (0.73·100, 0.45·200) and (0.34·100, 0.47·200).
    expect(byId.armR.pivot.x).toBeCloseTo(0.73 * 100, 0)
    expect(byId.armR.pivot.y).toBeCloseTo(0.45 * 200, 0)
    expect(byId.armL.pivot.x).toBeCloseTo(0.34 * 100, 0)
    // Hips ~ (·, 0.77·200) and (·, 0.78·200), at the top of each leg.
    expect(byId.legR.pivot.y).toBeCloseTo(0.77 * 200, 0)
    expect(byId.legL.pivot.y).toBeCloseTo(0.78 * 200, 0)
  })

  it('each limb bone lies ALONG its limb (rest tip points down/out, not criss-cross)', () => {
    const rig = builderRig(100, 200, IDS)
    const byId = Object.fromEntries(evaluateBoneWorlds(rig, {}).map((s) => [s.id, s]))
    const { armL, armR, legL, legR } = byId
    // Arms extend OUTWARD horizontally.
    expect(armL.tip.x).toBeLessThan(armL.pivot.x)
    expect(armR.tip.x).toBeGreaterThan(armR.pivot.x)
    // Legs extend DOWNWARD.
    expect(legL.tip.y).toBeGreaterThan(legL.pivot.y)
    expect(legR.tip.y).toBeGreaterThan(legR.pivot.y)
  })

  it('at rest evaluates to identity deltas for EVERY driven leaf (figure looks as drawn)', () => {
    const rig = builderRig(60, 120, IDS)
    const deltas = evaluateRig(rig, {})
    for (const leaf of Object.values(IDS)) {
      const d = deltas.get(leaf)!
      expect(d.a).toBeCloseTo(1, 9)
      expect(d.d).toBeCloseTo(1, 9)
      expect(d.tx).toBeCloseTo(0, 9)
      expect(d.ty).toBeCloseTo(0, 9)
    }
  })

  it('swinging a leg bone orbits its leaf about the hip, not the leaf center', () => {
    const rig = builderRig(100, 200, IDS)
    const hip = Object.fromEntries(evaluateBoneWorlds(rig, {}).map((s) => [s.id, s])).legL.pivot
    const d = evaluateRig(rig, { legL: { rotation: Math.PI / 2 } }).get('lL')!
    // A point AT the hip pivot is unmoved by the swing.
    const moved = { x: d.a * hip.x + d.c * hip.y + d.tx, y: d.b * hip.x + d.d * hip.y + d.ty }
    expect(moved.x).toBeCloseTo(hip.x, 6)
    expect(moved.y).toBeCloseTo(hip.y, 6)
  })

  it('leaning the spine carries the limbs AND the head (whole-body motion)', () => {
    const rig = builderRig(100, 200, IDS)
    // A spine rotation should move the arm leaf (it hangs off the spine) and the head.
    const posed = evaluateRig(rig, { spine: { rotation: 0.3 } })
    const arm = posed.get('aR')!
    const head = posed.get('hd')!
    // Non-identity: the spine lean propagates to both.
    expect(Math.abs(arm.tx) + Math.abs(arm.ty)).toBeGreaterThan(0.5)
    expect(Math.abs(head.tx) + Math.abs(head.ty)).toBeGreaterThan(0.5)
  })
})
