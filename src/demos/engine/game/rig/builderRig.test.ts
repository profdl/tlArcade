/**
 * Engine — default builder rig structure tests (chain skeleton + Phase B leg chains).
 */
import { describe, expect, it } from 'vitest'
import { builderRig, BUILDER_LIMB_BONES } from './builderRig'
import { evaluateRig, evaluateBoneWorlds } from './evaluate'

const IDS = {
  armL: 'aL', armR: 'aR',
  thighL: 'tL', shinL: 'sL', thighR: 'tR', shinR: 'sR',
  torso: 'to', head: 'hd', smile: 'sm', eyeL: 'eL', eyeR: 'eR',
}

describe('builderRig', () => {
  it('is a pelvis→spine→head chain with arms + two-bone leg chains', () => {
    const rig = builderRig(60, 120, IDS)
    expect(rig.root).toBe('pelvis')
    expect(rig.bones.map((b) => b.id).sort()).toEqual(
      ['pelvis', 'spine', 'head', ...BUILDER_LIMB_BONES].sort(),
    )
    // Exactly one root.
    expect(rig.bones.filter((b) => b.parentId === null).map((b) => b.id)).toEqual(['pelvis'])
    // The body chain.
    expect(rig.bones.find((b) => b.id === 'spine')!.parentId).toBe('pelvis')
    expect(rig.bones.find((b) => b.id === 'head')!.parentId).toBe('spine')
    // Arms + THIGHS hang off the spine (follow the body's bob/lean).
    for (const id of ['armL', 'armR', 'thighL', 'thighR']) {
      expect(rig.bones.find((b) => b.id === id)!.parentId).toBe('spine')
    }
    // SHINS are children of their thigh (the knee joint) — the chain that bends.
    expect(rig.bones.find((b) => b.id === 'shinL')!.parentId).toBe('thighL')
    expect(rig.bones.find((b) => b.id === 'shinR')!.parentId).toBe('thighR')
  })

  it('drives torso off spine, head+smile+eyes off head, each leg thigh+shin off its bone', () => {
    const rig = builderRig(60, 120, IDS)
    const skin = rig.skins.default
    const byBone: Record<string, string[]> = {}
    for (const s of rig.slots) {
      const att = skin[s.attachment]
      if (att.kind === 'rigid') (byBone[s.boneId] ??= []).push(att.leafId)
    }
    expect(byBone.spine).toEqual(['to'])
    expect(byBone.head.sort()).toEqual(['eL', 'eR', 'hd', 'sm'].sort())
    expect(byBone.armL).toEqual(['aL'])
    expect(byBone.thighL).toEqual(['tL'])
    expect(byBone.shinL).toEqual(['sL'])
    expect(byBone.thighR).toEqual(['tR'])
    expect(byBone.shinR).toEqual(['sR'])
  })

  it('places thigh pivots at scaled hip positions (arms above hips, sides split)', () => {
    const rig = builderRig(100, 200, IDS)
    const byId = Object.fromEntries(evaluateBoneWorlds(rig, {}).map((s) => [s.id, s]))
    // Arms higher (smaller world-y pivot) than hips (thigh pivots).
    expect(byId.armL.pivot.y).toBeLessThan(byId.thighL.pivot.y)
    expect(byId.armL.pivot.x).toBeLessThan(byId.armR.pivot.x)
    expect(byId.thighL.pivot.x).toBeLessThan(byId.thighR.pivot.x)
    // Hips ~ 0.77/0.78 · 200.
    expect(byId.thighR.pivot.y).toBeCloseTo(0.77 * 200, 0)
    expect(byId.thighL.pivot.y).toBeCloseTo(0.78 * 200, 0)
  })

  it('the leg chain reaches the foot: shin tip lands at the measured foot anchor', () => {
    const rig = builderRig(100, 200, IDS)
    const byId = Object.fromEntries(evaluateBoneWorlds(rig, {}).map((s) => [s.id, s]))
    // Left foot anchor ~ (0.31·100, 1.0·200); the shin tip should reach it.
    expect(byId.shinL.tip.x).toBeCloseTo(0.31 * 100, 0)
    expect(byId.shinL.tip.y).toBeCloseTo(1.0 * 200, 0)
    // The knee (shin pivot) sits between hip and foot, lower than the hip.
    expect(byId.shinL.pivot.y).toBeGreaterThan(byId.thighL.pivot.y)
    expect(byId.shinL.pivot.y).toBeLessThan(byId.shinL.tip.y)
  })

  it('legs extend DOWNWARD (thigh + shin both point down)', () => {
    const rig = builderRig(100, 200, IDS)
    const byId = Object.fromEntries(evaluateBoneWorlds(rig, {}).map((s) => [s.id, s]))
    expect(byId.thighL.tip.y).toBeGreaterThan(byId.thighL.pivot.y)
    expect(byId.shinL.tip.y).toBeGreaterThan(byId.shinL.pivot.y)
    expect(byId.thighR.tip.y).toBeGreaterThan(byId.thighR.pivot.y)
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

  it('swinging a thigh orbits its leaf about the hip, not the leaf center', () => {
    const rig = builderRig(100, 200, IDS)
    const hip = Object.fromEntries(evaluateBoneWorlds(rig, {}).map((s) => [s.id, s])).thighL.pivot
    const d = evaluateRig(rig, { thighL: { rotation: Math.PI / 2 } }).get('tL')!
    // A point AT the hip pivot is unmoved by the swing.
    const moved = { x: d.a * hip.x + d.c * hip.y + d.tx, y: d.b * hip.x + d.d * hip.y + d.ty }
    expect(moved.x).toBeCloseTo(hip.x, 6)
    expect(moved.y).toBeCloseTo(hip.y, 6)
  })

  it('bending the knee (shin rotation) carries the shin but not the thigh', () => {
    const rig = builderRig(100, 200, IDS)
    const posed = evaluateRig(rig, { shinL: { rotation: 0.5 } })
    const shin = posed.get('sL')!
    const thigh = posed.get('tL')!
    // The shin moves (knee bent); the thigh stays at rest (identity).
    expect(Math.abs(shin.tx) + Math.abs(shin.ty)).toBeGreaterThan(0.5)
    expect(thigh.a).toBeCloseTo(1, 9)
    expect(thigh.tx).toBeCloseTo(0, 9)
  })

  it('swinging the thigh carries the shin with it (FK chain: knee follows the hip)', () => {
    const rig = builderRig(100, 200, IDS)
    // Rotating the thigh should move the shin leaf too (it hangs off the thigh).
    const posed = evaluateRig(rig, { thighL: { rotation: 0.4 } })
    const shin = posed.get('sL')!
    expect(Math.abs(shin.tx) + Math.abs(shin.ty)).toBeGreaterThan(0.5)
  })

  it('leaning the spine carries the limbs AND the head (whole-body motion)', () => {
    const rig = builderRig(100, 200, IDS)
    const posed = evaluateRig(rig, { spine: { rotation: 0.3 } })
    const arm = posed.get('aR')!
    const head = posed.get('hd')!
    const shin = posed.get('sL')!
    // Non-identity: the spine lean propagates to arm, head, AND the far end of the leg.
    expect(Math.abs(arm.tx) + Math.abs(arm.ty)).toBeGreaterThan(0.5)
    expect(Math.abs(head.tx) + Math.abs(head.ty)).toBeGreaterThan(0.5)
    expect(Math.abs(shin.tx) + Math.abs(shin.ty)).toBeGreaterThan(0.5)
  })
})
