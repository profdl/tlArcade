/**
 * Engine — bone-authoring helpers (draw bones, tip-snap chains, auto-attach, bake).
 */
import { describe, expect, it } from 'vitest'
import {
  bakeDraft,
  nearestBone,
  snapParentForStart,
  snappedStart,
  type DraftRig,
} from './authoring'
import { evaluateRig } from './evaluate'
import { apply } from './mat2d'

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps
const closePt = (p: { x: number; y: number }, x: number, y: number, eps = 1e-6) =>
  close(p.x, x, eps) && close(p.y, y, eps)

/** upper arm shoulder(100,100)→elbow(160,100); forearm starts at the elbow. */
function armDraft(): DraftRig {
  return {
    bones: [
      { id: 'upper', parentId: null, pivot: { x: 100, y: 100 }, tip: { x: 160, y: 100 }, leafIds: ['upperArm'] },
      { id: 'fore', parentId: 'upper', pivot: { x: 160, y: 100 }, tip: { x: 210, y: 100 }, leafIds: ['forearm'] },
    ],
  }
}

describe('tip-snap parenting', () => {
  it('a start near an existing tip snaps to that bone as parent', () => {
    const draft: DraftRig = {
      bones: [{ id: 'upper', parentId: null, pivot: { x: 100, y: 100 }, tip: { x: 160, y: 100 }, leafIds: [] }],
    }
    // Start close to the tip (160,100).
    expect(snapParentForStart(draft, { x: 162, y: 101 }, 12)).toBe('upper')
    // Start far away → no parent (a new root).
    expect(snapParentForStart(draft, { x: 100, y: 300 }, 12)).toBeNull()
  })

  it('snappedStart returns the exact parent tip so the chain is seamless', () => {
    const draft: DraftRig = {
      bones: [{ id: 'upper', parentId: null, pivot: { x: 100, y: 100 }, tip: { x: 160, y: 100 }, leafIds: [] }],
    }
    expect(snappedStart(draft, { x: 163, y: 98 }, 12)).toEqual({ x: 160, y: 100 })
    // No snap → the raw start.
    expect(snappedStart(draft, { x: 100, y: 300 }, 12)).toEqual({ x: 100, y: 300 })
  })
})

describe('auto-attach by nearest bone segment', () => {
  it('a part over the upper arm attaches to the upper bone; over the forearm, the fore bone', () => {
    const draft = armDraft()
    // Clear the pre-set leaves to test attachment picking.
    draft.bones.forEach((b) => (b.leafIds = []))
    expect(nearestBone(draft, { x: 130, y: 103 })).toBe('upper') // midway along upper arm
    expect(nearestBone(draft, { x: 190, y: 98 })).toBe('fore') // along the forearm
  })
})

describe('bakeDraft → Rig', () => {
  it('the pivot is the bone START, not the part center', () => {
    const draft = armDraft()
    const rig = bakeDraft(draft)!
    const upper = rig.bones.find((b) => b.id === 'upper')!
    // Root bone: local == world pivot (shoulder), NOT the arm's center (130).
    expect(closePt({ x: upper.x, y: upper.y }, 100, 100)).toBe(true)
  })

  it('a child bone is parented and stored relative to its parent pivot', () => {
    const rig = bakeDraft(armDraft())!
    const fore = rig.bones.find((b) => b.id === 'fore')!
    expect(fore.parentId).toBe('upper')
    // forearm pivot (160,100) minus upper pivot (100,100) = (60,0).
    expect(closePt({ x: fore.x, y: fore.y }, 60, 0)).toBe(true)
  })

  it('rotating the shoulder swings the WHOLE arm about the shoulder (FK chain)', () => {
    const rig = bakeDraft(armDraft())!
    // Swing the upper (root) bone +90° (y-down). The forearm leaf, drawn along
    // (160..210, 100), must orbit the SHOULDER (100,100), not its own center.
    const deltas = evaluateRig(rig, { upper: { rotation: Math.PI / 2 } })
    const foreDelta = deltas.get('forearm')!
    // The forearm's near end at (160,100) is 60px +x of the shoulder → swings to
    // 60px +y: (100,160).
    expect(closePt(apply(foreDelta, { x: 160, y: 100 }), 100, 160)).toBe(true)
    // Its far end at (210,100) is 110px +x → (100,210).
    expect(closePt(apply(foreDelta, { x: 210, y: 100 }), 100, 210)).toBe(true)
  })

  it('rotating only the elbow swings the forearm about the elbow, upper arm unmoved', () => {
    const rig = bakeDraft(armDraft())!
    const deltas = evaluateRig(rig, { fore: { rotation: Math.PI / 2 } })
    // Upper arm leaf is unaffected.
    const upperDelta = deltas.get('upperArm')!
    expect(closePt(apply(upperDelta, { x: 130, y: 100 }), 130, 100)).toBe(true)
    // Forearm swings about the ELBOW (160,100): far end (210,100) → (160,150).
    const foreDelta = deltas.get('forearm')!
    expect(closePt(apply(foreDelta, { x: 210, y: 100 }), 160, 150)).toBe(true)
  })

  it('returns null when nothing is attached', () => {
    const draft = armDraft()
    draft.bones.forEach((b) => (b.leafIds = []))
    expect(bakeDraft(draft)).toBeNull()
  })
})
