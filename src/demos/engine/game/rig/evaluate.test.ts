/**
 * Engine — rig evaluator (Tier A) unit tests.
 *
 * Proves the load-bearing invariants: rest/empty pose = identity deltas (so an
 * unrigged player is byte-identical to today), and a bone rotation rotates its
 * leaf's delta rigidly about the bone's world origin — the FK + rigid-deform
 * behavior R1 promises.
 */
import { describe, expect, it } from 'vitest'
import { apply, type Mat2D } from './mat2d'
import { evaluateRig, type Pose } from './evaluate'
import { makeBone, type Rig } from './types'

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps
const closePt = (p: { x: number; y: number }, x: number, y: number, eps = 1e-6) =>
  close(p.x, x, eps) && close(p.y, y, eps)

/** A minimal one-bone rig: root bone at (rootX, 0), one rigid leaf 'leaf'. */
function oneBoneRig(rootX = 0): Rig {
  const root = { ...makeBone('root', null), x: rootX, y: 0 }
  return {
    version: 1,
    root: 'root',
    bones: [root],
    slots: [{ id: 'slot0', boneId: 'root', drawOrder: 0, attachment: 'a' }],
    skins: { default: { slot0: { kind: 'rigid', leafId: 'leaf' } } },
    constraints: [],
    bindInverse: {},
  }
}

describe('evaluateRig — Tier A rigid', () => {
  it('empty pose yields an identity delta (rest = no-op)', () => {
    const deltas = evaluateRig(oneBoneRig(50))
    const d = deltas.get('leaf')!
    // Identity: a point maps to itself.
    expect(closePt(apply(d, { x: 7, y: 11 }), 7, 11)).toBe(true)
  })

  it('a bone pose that leaves the bone at rest still yields identity', () => {
    const deltas = evaluateRig(oneBoneRig(), { root: {} })
    expect(closePt(apply(deltas.get('leaf')!, { x: 3, y: 4 }), 3, 4)).toBe(true)
  })

  it('rotating the root bone 90° rotates the delta about the bone origin', () => {
    const rig = oneBoneRig(100) // bone world origin at (100, 0)
    const pose: Pose = { root: { rotation: Math.PI / 2 } }
    const d = evaluateRig(rig, pose).get('leaf')!
    // A leaf point at the bone origin is unchanged; a point offset from it orbits.
    expect(closePt(apply(d, { x: 100, y: 0 }), 100, 0)).toBe(true)
    // A point 10px to the +x of the bone → +y (y-down 90°): (110,0) → (100,10).
    expect(closePt(apply(d, { x: 110, y: 0 }), 100, 10)).toBe(true)
  })

  it('a two-bone chain: the child leaf follows both bones (FK)', () => {
    // root at origin; child offset +50 in x, parented to root. Rotating the root
    // swings the whole chain; the child leaf orbits the ROOT origin.
    const root = { ...makeBone('root', null), x: 0, y: 0 }
    const child = { ...makeBone('child', 'root'), x: 50, y: 0 }
    const rig: Rig = {
      version: 1,
      root: 'root',
      bones: [root, child],
      slots: [{ id: 's', boneId: 'child', drawOrder: 0, attachment: 'a' }],
      skins: { default: { s: { kind: 'rigid', leafId: 'childLeaf' } } },
      constraints: [],
      bindInverse: {},
    }
    const d = evaluateRig(rig, { root: { rotation: Math.PI / 2 } }).get('childLeaf')!
    // The child bone's rest world origin is (50,0). After a +90° root rotation it
    // moves to (0,50). A leaf point at the child origin should land there.
    expect(closePt(apply(d, { x: 50, y: 0 }), 0, 50)).toBe(true)
  })

  it('bones out of parent-first order still resolve (iterative FK)', () => {
    const child = { ...makeBone('child', 'root'), x: 50, y: 0 }
    const root = { ...makeBone('root', null), x: 0, y: 0 }
    const rig: Rig = {
      version: 1,
      root: 'root',
      bones: [child, root], // child BEFORE its parent
      slots: [{ id: 's', boneId: 'child', drawOrder: 0, attachment: 'a' }],
      skins: { default: { s: { kind: 'rigid', leafId: 'childLeaf' } } },
      constraints: [],
      bindInverse: {},
    }
    const d = evaluateRig(rig, { root: { rotation: Math.PI / 2 } }).get('childLeaf')!
    expect(closePt(apply(d, { x: 50, y: 0 }), 0, 50)).toBe(true)
  })

  it('a missing bone-world yields identity rather than throwing', () => {
    const rig = oneBoneRig()
    // Point a slot at a non-existent bone.
    rig.slots[0].boneId = 'ghost'
    const d = evaluateRig(rig).get('leaf')
    expect(d).toBeDefined()
    expect(closePt(apply(d as Mat2D, { x: 1, y: 2 }), 1, 2)).toBe(true)
  })
})
