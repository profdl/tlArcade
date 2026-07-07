/**
 * Engine — rig round-trip integration (R1).
 *
 * Reproduces what the runtime does per frame (engine.ts writeRigPart) WITHOUT the
 * editor: evaluate a rig at a pose → apply the resulting delta to a leaf's rest
 * origin exactly as writeRigPart does (posed = D · restOrigin), and assert the leaf
 * lands where hand-computed geometry says. This pins the one piece the pure
 * evaluator tests don't directly cover — that applying the delta to the leaf's rest
 * origin (offX, offY) yields the correct posed position for a leaf OFFSET from its
 * bone (the realistic "a hand shape hangs off the elbow joint" case).
 */
import { describe, expect, it } from 'vitest'
import { compose, fromTRS, type Mat2D } from './mat2d'
import { evaluateRig } from './evaluate'
import { makeBone, type Rig } from './types'

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps

/** Mirror writeRigPart: posed leaf origin (entity-local) = D applied to rest origin. */
function posedOrigin(delta: Mat2D, offX: number, offY: number) {
  const m = compose(delta, fromTRS(offX, offY, 0))
  return { x: m.tx, y: m.ty }
}

describe('rig round-trip — leaf offset from its bone', () => {
  it('a leaf offset from a swinging joint orbits the joint', () => {
    // Joint (bone) at entity-local (100, 100). Leaf rest origin 40px below it.
    const bone = { ...makeBone('elbow', null), x: 100, y: 100 }
    const rig: Rig = {
      version: 1,
      root: 'elbow',
      bones: [bone],
      slots: [{ id: 's', boneId: 'elbow', drawOrder: 0, attachment: 'a' }],
      skins: { default: { s: { kind: 'rigid', leafId: 'hand' } } },
      constraints: [],
      bindInverse: {},
    }
    const offX = 100
    const offY = 140 // leaf rest origin at (100, 140): 40px below the joint

    // Rest pose → leaf stays put.
    const restDelta = evaluateRig(rig).get('hand')!
    const atRest = posedOrigin(restDelta, offX, offY)
    expect(close(atRest.x, 100)).toBe(true)
    expect(close(atRest.y, 140)).toBe(true)

    // Swing the joint +90° (y-down): the leaf, 40px below the joint, swings to 40px
    // to the -x of the joint → (100-40, 100) = (60, 100).
    const swungDelta = evaluateRig(rig, { elbow: { rotation: Math.PI / 2 } }).get('hand')!
    const swung = posedOrigin(swungDelta, offX, offY)
    expect(close(swung.x, 60)).toBe(true)
    expect(close(swung.y, 100)).toBe(true)
  })

  it('the leaf delta carries a rotation equal to the joint swing', () => {
    const bone = { ...makeBone('j', null), x: 0, y: 0 }
    const rig: Rig = {
      version: 1,
      root: 'j',
      bones: [bone],
      slots: [{ id: 's', boneId: 'j', drawOrder: 0, attachment: 'a' }],
      skins: { default: { s: { kind: 'rigid', leafId: 'leaf' } } },
      constraints: [],
      bindInverse: {},
    }
    const d = evaluateRig(rig, { j: { rotation: 0.4 } }).get('leaf')!
    // writeRigPart reads the delta's rotation as atan2(b, a).
    expect(close(Math.atan2(d.b, d.a), 0.4)).toBe(true)
  })

  it('two joints drive their own leaves independently', () => {
    const armBone = { ...makeBone('arm', null), x: 0, y: 0 }
    const legBone = { ...makeBone('leg', null), x: 0, y: 200 }
    const rig: Rig = {
      version: 1,
      root: 'arm',
      bones: [armBone, legBone],
      slots: [
        { id: 'sa', boneId: 'arm', drawOrder: 0, attachment: 'a' },
        { id: 'sl', boneId: 'leg', drawOrder: 1, attachment: 'l' },
      ],
      skins: { default: { sa: { kind: 'rigid', leafId: 'hand' }, sl: { kind: 'rigid', leafId: 'foot' } } },
      constraints: [],
      bindInverse: {},
    }
    // Swing only the arm; the foot must stay at rest.
    const deltas = evaluateRig(rig, { arm: { rotation: Math.PI / 2 } })
    const foot = posedOrigin(deltas.get('foot')!, 0, 200)
    expect(close(foot.x, 0)).toBe(true)
    expect(close(foot.y, 200)).toBe(true) // unmoved
    // The hand (at 20px +x of the arm joint) swings to +y.
    const hand = posedOrigin(deltas.get('hand')!, 20, 0)
    expect(close(hand.x, 0)).toBe(true)
    expect(close(hand.y, 20)).toBe(true)
  })
})
