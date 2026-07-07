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
 * Joint pivots in NORMALIZED figure coords (0..1), tuned to the builder art's REAL
 * geometry (limb centers measured via the editor). A limb pivots at its ATTACHMENT
 * end (shoulder/hip), inward toward the torso from the limb's own center:
 *   arms:  centers ~(0.17, 0.5) L / (0.86, 0.46) R → shoulders pulled in + up
 *   legs:  centers ~(0.36, 0.89) L / (0.60, 0.88) R → hips pulled in + up (top of leg)
 */
const JOINTS = {
  armL: { x: 0.4, y: 0.44 },
  armR: { x: 0.6, y: 0.44 },
  legL: { x: 0.44, y: 0.72 },
  legR: { x: 0.56, y: 0.72 },
} as const

/** Rough limb LENGTHS in normalized figure-height units (descriptive; for IK later). */
const LIMB_LEN = { arm: 0.28, leg: 0.3 } as const

function limbBone(
  id: string,
  joint: { x: number; y: number },
  figW: number,
  figH: number,
  lengthNorm: number,
): Bone {
  return {
    id,
    parentId: 'torso',
    // Pivot relative to the torso root (which is at the figure origin, 0/0), so the
    // limb's local x,y IS its joint position in entity-local px.
    x: joint.x * figW,
    y: joint.y * figH,
    rotation: 0, // rest = as-drawn; the walk pose adds a swing on top
    scaleX: 1,
    scaleY: 1,
    shearX: 0,
    shearY: 0,
    length: lengthNorm * figH,
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
    limbBone('armL', JOINTS.armL, figW, figH, LIMB_LEN.arm),
    limbBone('armR', JOINTS.armR, figW, figH, LIMB_LEN.arm),
    limbBone('legL', JOINTS.legL, figW, figH, LIMB_LEN.leg),
    limbBone('legR', JOINTS.legR, figW, figH, LIMB_LEN.leg),
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
