/**
 * Engine — the DEFAULT rig for the builder player (R2).
 *
 * A pure function producing a Tier-A `Rig` for the hand-drawn builder
 * (game/builder.ts), so the default player is pre-rigged and its limbs animate the
 * moment you Play — no manual bone-drawing needed. This is the data half of "the
 * default player walks"; the procedural walk (walk.ts) supplies the live pose.
 *
 * Coordinates are ENTITY-LOCAL (page px relative to the figure's bounds top-left),
 * the same frame the evaluator + runtime use. Joint positions are expressed in
 * NORMALIZED figure coords (0..1 of the figure's width/height — the `nx/ny` frame
 * builder.ts already uses) and multiplied by the figure's px size, so the rig scales
 * with the player automatically.
 *
 * Skeleton (flat, one level — enough for a walk): a static `torso` ROOT plus four
 * limb bones — `armL`, `armR`, `legL`, `legR` — each pivoting at its shoulder/hip
 * joint and driving its builder draw-shape. The head/torso/eyes ride the root
 * (unanimated). The pivots are placed at the anatomical joints so a limb swings
 * about its shoulder/hip (the whole point of the pivot-at-the-end model).
 */
import type { Bone, Rig, Slot, Attachment } from './types'

/**
 * The builder's limb draw-shape leaf ids, in the roles the rig drives. The caller
 * (createBuilderPlayer) passes the real created ids; this module knows only which
 * anatomical part each is.
 */
export interface BuilderLimbIds {
  armL: string
  armR: string
  legL: string
  legR: string
}

/**
 * Each limb as a NORMALIZED (0..1 figure) segment from its JOINT (where it attaches
 * to the body — the shoulder/hip) to its free TIP. Measured from the builder art's
 * REAL per-limb bounding boxes (via the editor), so the bone's pivot sits at the
 * body attachment and the bone LIES OVER the limb:
 *   armR bbox x[.72,1] y[.43,.50] → shoulder at the LEFT (inner) end, tip out-right
 *   armL bbox x[0,.34] y[.46,.54] → shoulder at the RIGHT (inner) end, tip out-left
 *   legR bbox x[.54,.65] y[.77,.99] → hip at the TOP, tip down
 *   legL bbox x[.31,.42] y[.78,1] → hip at the TOP, tip down
 */
const LIMBS = {
  armR: { joint: { x: 0.73, y: 0.45 }, tip: { x: 1.0, y: 0.5 } },
  armL: { joint: { x: 0.34, y: 0.47 }, tip: { x: 0.02, y: 0.53 } },
  legR: { joint: { x: 0.6, y: 0.77 }, tip: { x: 0.6, y: 0.99 } },
  legL: { joint: { x: 0.36, y: 0.78 }, tip: { x: 0.36, y: 1.0 } },
} as const

function limbBone(
  id: string,
  seg: { joint: { x: number; y: number }; tip: { x: number; y: number } },
  figW: number,
  figH: number,
): Bone {
  // Pivot = the joint, in entity-local px, relative to the torso root (at 0,0).
  const jx = seg.joint.x * figW
  const jy = seg.joint.y * figH
  const tx = seg.tip.x * figW
  const ty = seg.tip.y * figH
  // Rest angle = the joint→tip direction, so the bone lies along the limb and the
  // walk swing rotates about the joint in the limb's own frame.
  const rotation = Math.atan2(ty - jy, tx - jx)
  const length = Math.hypot(tx - jx, ty - jy)
  return {
    id,
    parentId: 'torso',
    x: jx,
    y: jy,
    rotation,
    scaleX: 1,
    scaleY: 1,
    shearX: 0,
    shearY: 0,
    length,
    inherit: 'normal',
  }
}

/**
 * Build the default builder rig. `figW`/`figH` are the figure's px size (so the rig
 * is in entity-local px); `limbs` are the real leaf ids of the four limb shapes.
 */
export function builderRig(figW: number, figH: number, limbs: BuilderLimbIds): Rig {
  const torso: Bone = {
    id: 'torso',
    parentId: null,
    x: 0,
    y: 0,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    shearX: 0,
    shearY: 0,
    length: 0,
    inherit: 'normal',
  }
  const bones: Bone[] = [
    torso,
    limbBone('armL', LIMBS.armL, figW, figH),
    limbBone('armR', LIMBS.armR, figW, figH),
    limbBone('legL', LIMBS.legL, figW, figH),
    limbBone('legR', LIMBS.legR, figW, figH),
  ]

  // One rigid slot per limb bone → its draw shape. (Head/torso/eyes are NOT slotted,
  // so they aren't rig-driven — they ride the static torso root and stay put.)
  const pairs: [string, string][] = [
    ['armL', limbs.armL],
    ['armR', limbs.armR],
    ['legL', limbs.legL],
    ['legR', limbs.legR],
  ]
  const slots: Slot[] = []
  const skin: Record<string, Attachment> = {}
  pairs.forEach(([boneId, leafId], i) => {
    const slotId = `slot_${i}`
    slots.push({ id: slotId, boneId, drawOrder: i, attachment: slotId })
    skin[slotId] = { kind: 'rigid', leafId }
  })

  return {
    version: 1,
    root: 'torso',
    bones,
    slots,
    skins: { default: skin },
    constraints: [],
    bindInverse: {},
  }
}

/** The four bone ids the walk animation drives (kept in sync with builderRig). */
export const BUILDER_LIMB_BONES = ['armL', 'armR', 'legL', 'legR'] as const
