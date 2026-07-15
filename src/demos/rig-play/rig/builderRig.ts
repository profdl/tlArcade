/**
 * Engine — the DEFAULT rig for the builder player (R2).
 *
 * A pure function producing a Tier-A `Rig` for the hand-drawn builder
 * (game/builder.ts), so the default player is pre-rigged and its whole body animates
 * the moment you Play — no manual bone-drawing. This is the data half of "the default
 * player comes alive"; the state machine (walk.ts) supplies the live pose.
 *
 * Coordinates are ENTITY-LOCAL (page px relative to the figure's RENDERED bounds
 * top-left — the same frame the evaluator + runtime resolve leaves in, NOT the art's
 * tight bounds; see builder.ts). Anatomical anchors are expressed in NORMALIZED figure
 * coords (0..1 of the figure's width/height) and multiplied by the figure's px size,
 * so the rig scales with the player automatically.
 *
 * Skeleton (a real chain now, Phase 1'):
 *
 *     pelvis (root, hip center)
 *       └─ spine  → drives the TORSO silhouette
 *            ├─ head → drives HEAD + SMILE + both EYES (they nod/lean as one)
 *            ├─ armL / armR → drive the arm strokes (swing about the shoulder)
 *            └─ legL / legR → drive the leg strokes (swing about the hip)
 *
 * The limbs hang off the SPINE (not a static root), so when the spine bobs/leans the
 * arms and legs follow — the whole figure moves as a body. Each limb is still ONE
 * bone driving ONE stroke (the captured art draws each limb as a single filled loop
 * that can't be cleanly split); a true bending knee/elbow is a later art pass.
 */
import type { Bone, Rig, Slot, Attachment } from './types'

/**
 * The builder's leaf shape ids the rig drives, by anatomical role. The caller
 * (createBuilderPlayer) passes the real created ids; this module knows only which
 * part each is. `torso`, `head`, `smile`, `eyeL`, `eyeR` are new in Phase 1' — the
 * body/head that used to ride a static root and never move.
 */
export interface BuilderLimbIds {
  armL: string
  armR: string
  /**
   * Each leg is TWO leaves now (Phase B): a thigh (hip→knee) and a shin (knee→foot),
   * driven by a two-bone chain so the knee can bend for IK. In "straight" leg mode the
   * shin just stays inline with the thigh, so it reads exactly like the old one-piece
   * leg — same art, same rig, the walk pose picks whether the knee bends.
   */
  thighL: string
  shinL: string
  thighR: string
  shinR: string
  torso: string
  head: string
  smile: string
  eyeL: string
  eyeR: string
}

/**
 * Anatomical anchors in NORMALIZED figure coords (0..1), measured from the builder
 * art's REAL rendered geometry (via the editor — see the _idx/_center probes). Each
 * limb is a JOINT (where it attaches — shoulder/hip) → free TIP (hand/foot); the bone
 * pivots at the joint and lies along the limb. The body chain uses point anchors:
 *   pelvis  — hip center, the whole-body pivot
 *   neck    — top of the torso / base of the head (spine tip, head pivot)
 *   headMid — head ellipse center (descriptive; head bone length reaches it)
 */
const ANCHORS = {
  // Limb segments (joint → tip), from the measured per-limb bounding boxes.
  armR: { joint: { x: 0.73, y: 0.45 }, tip: { x: 1.0, y: 0.43 } },
  armL: { joint: { x: 0.34, y: 0.47 }, tip: { x: 0.0, y: 0.535 } },
  // Legs are hip → KNEE → foot now (two bones). The knee sits on the hip→foot line,
  // nudged slightly FORWARD (−x-ish / toward the body front) so the rest leg has a
  // hair of natural bend — that also fixes the IK bend side (a knee buckles forward,
  // never backward). knee.forward is the normalized forward nudge applied at the knee.
  legR: { joint: { x: 0.6, y: 0.77 }, knee: { x: 0.57, y: 0.88 }, tip: { x: 0.544, y: 0.986 } },
  legL: { joint: { x: 0.36, y: 0.78 }, knee: { x: 0.335, y: 0.89 }, tip: { x: 0.31, y: 1.0 } },
  // Body chain point anchors.
  pelvis: { x: 0.5, y: 0.77 },
  neck: { x: 0.5, y: 0.4 },
  headMid: { x: 0.52, y: 0.22 },
} as const

/**
 * The per-side leg anchors (hip / knee / foot, normalized figure coords), EXPORTED so
 * builder.ts generates the thigh + shin leaf art at exactly the positions the rig's
 * leg bones use — art and rig stay consistent by construction (no drift).
 */
export const LEG_ANCHORS = { L: ANCHORS.legL, R: ANCHORS.legR } as const

/** A bone at rest rotation 0 (upright), pivot at (px,py) entity-local. */
function structuralBone(id: string, parentId: string, px: number, py: number, parentPx: number, parentPy: number, length: number): Bone {
  return {
    id,
    parentId,
    // Pivot relative to the PARENT'S pivot (parent rest rotation is 0, so this is a
    // plain entity-local offset). FK composes parentWorld · local.
    x: px - parentPx,
    y: py - parentPy,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    shearX: 0,
    shearY: 0,
    length,
    inherit: 'normal',
  }
}

/**
 * A limb bone: pivot at its joint (parent-relative), rest angle = joint→tip direction
 * so the bone lies along the limb and a pose swing rotates about the joint. Parent is
 * the spine (rest rotation 0), so parent-relative pivot is a plain entity-local offset.
 */
function limbBone(
  id: string,
  seg: { joint: { x: number; y: number }; tip: { x: number; y: number } },
  figW: number,
  figH: number,
  parentPx: number,
  parentPy: number,
): Bone {
  const jx = seg.joint.x * figW
  const jy = seg.joint.y * figH
  const tx = seg.tip.x * figW
  const ty = seg.tip.y * figH
  return {
    id,
    parentId: 'spine',
    x: jx - parentPx,
    y: jy - parentPy,
    rotation: Math.atan2(ty - jy, tx - jx),
    scaleX: 1,
    scaleY: 1,
    shearX: 0,
    shearY: 0,
    length: Math.hypot(tx - jx, ty - jy),
    inherit: 'normal',
  }
}

/**
 * Build a leg CHAIN: thigh (hip→knee, child of the spine) + shin (knee→foot, child of
 * the thigh), so the knee bends. Bone convention (types.ts): a bone's local +x axis
 * lies ALONG it toward its tip, so the shin's pivot in the thigh's LOCAL frame is just
 * `(thighLength, 0)` and the shin's local rotation is the knee→foot direction minus the
 * hip→knee direction (the bend angle). The thigh pivots at the hip (parent-relative to
 * the spine pivot) with rest angle = hip→knee direction.
 *
 * `side` is 'L' | 'R' (bone ids `thighL/shinL/...`); anchors are normalized figure
 * coords; `parentPx/Py` is the spine pivot (the thigh's parent), entity-local px.
 */
function legChain(
  side: 'L' | 'R',
  seg: { joint: { x: number; y: number }; knee: { x: number; y: number }; tip: { x: number; y: number } },
  figW: number,
  figH: number,
  parentPx: number,
  parentPy: number,
): [Bone, Bone] {
  const hx = seg.joint.x * figW
  const hy = seg.joint.y * figH
  const kx = seg.knee.x * figW
  const ky = seg.knee.y * figH
  const fx = seg.tip.x * figW
  const fy = seg.tip.y * figH
  const thighAngle = Math.atan2(ky - hy, kx - hx)
  const shinAngle = Math.atan2(fy - ky, fx - kx)
  const thighLen = Math.hypot(kx - hx, ky - hy)
  const shinLen = Math.hypot(fx - kx, fy - ky)
  const thigh: Bone = {
    id: `thigh${side}`,
    parentId: 'spine',
    x: hx - parentPx,
    y: hy - parentPy,
    rotation: thighAngle,
    scaleX: 1, scaleY: 1, shearX: 0, shearY: 0,
    length: thighLen,
    inherit: 'normal',
  }
  const shin: Bone = {
    id: `shin${side}`,
    parentId: `thigh${side}`,
    // Knee is at the thigh's tip: (thighLen, 0) in the thigh's LOCAL frame.
    x: thighLen,
    y: 0,
    // Local rotation = world shin angle − world thigh angle (the rest knee bend).
    rotation: shinAngle - thighAngle,
    scaleX: 1, scaleY: 1, shearX: 0, shearY: 0,
    length: shinLen,
    inherit: 'normal',
  }
  return [thigh, shin]
}

/**
 * Build the default builder rig. `figW`/`figH` are the figure's RENDERED page-bounds
 * px size (so the rig is in the same entity-local frame the runtime resolves leaves
 * in — NOT the art's tight boundsW/boundsH, which the draw strokes overflow); `ids`
 * are the real leaf ids of the shapes the rig drives. `knees` optionally overrides the
 * per-side knee anchor (normalized) — the builder passes the ARC break point so the
 * shin bone pivots exactly where the drawn curve bends (leaf, stroke, and bone coincide).
 */
export function builderRig(
  figW: number,
  figH: number,
  ids: BuilderLimbIds,
  knees?: { L: { x: number; y: number }; R: { x: number; y: number } },
): Rig {
  // Body-chain pivots in entity-local px.
  const pelvisX = ANCHORS.pelvis.x * figW
  const pelvisY = ANCHORS.pelvis.y * figH
  const neckX = ANCHORS.neck.x * figW
  const neckY = ANCHORS.neck.y * figH
  const headMidX = ANCHORS.headMid.x * figW
  const headMidY = ANCHORS.headMid.y * figH

  const pelvis: Bone = {
    id: 'pelvis',
    parentId: null,
    x: pelvisX,
    y: pelvisY,
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    shearX: 0,
    shearY: 0,
    length: Math.hypot(neckX - pelvisX, neckY - pelvisY),
    inherit: 'normal',
  }
  // spine: pelvis → neck. head: neck → head center.
  const spine = structuralBone('spine', 'pelvis', neckX, neckY, pelvisX, pelvisY, Math.hypot(neckX - pelvisX, neckY - pelvisY))
  const head = structuralBone('head', 'spine', neckX, neckY, neckX, neckY, Math.hypot(headMidX - neckX, headMidY - neckY))

  // Use the caller's arc-derived knee if given (so the shin bone bends where the drawn
  // leg curve breaks), else the default anchor knee.
  const legLSeg = knees ? { ...ANCHORS.legL, knee: knees.L } : ANCHORS.legL
  const legRSeg = knees ? { ...ANCHORS.legR, knee: knees.R } : ANCHORS.legR
  const [thighL, shinL] = legChain('L', legLSeg, figW, figH, neckX, neckY)
  const [thighR, shinR] = legChain('R', legRSeg, figW, figH, neckX, neckY)
  const bones: Bone[] = [
    pelvis,
    spine,
    head,
    limbBone('armL', ANCHORS.armL, figW, figH, neckX, neckY),
    limbBone('armR', ANCHORS.armR, figW, figH, neckX, neckY),
    thighL,
    shinL,
    thighR,
    shinR,
  ]

  // One rigid slot per driven leaf. The head bone drives the head ellipse AND the
  // smile + both eyes, so the face nods/leans as one unit. Each leg is a thigh + shin
  // leaf on the two-bone chain. Draw order preserves the capture order (torso behind,
  // face on top) — the evaluator doesn't reorder.
  const pairs: [string, string][] = [
    ['spine', ids.torso],
    ['head', ids.head],
    ['head', ids.smile],
    ['head', ids.eyeL],
    ['head', ids.eyeR],
    ['armL', ids.armL],
    ['armR', ids.armR],
    ['thighL', ids.thighL],
    ['shinL', ids.shinL],
    ['thighR', ids.thighR],
    ['shinR', ids.shinR],
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
    root: 'pelvis',
    bones,
    slots,
    skins: { default: skin },
    constraints: [],
    bindInverse: {},
  }
}

/**
 * The limb bones the walk drives (kept in sync with builderRig). The legs are now a
 * two-bone chain per side: the THIGH swings about the hip (both leg modes) and the
 * SHIN adds the knee bend (IK mode; kept inline in straight mode). Arms are single.
 */
export const BUILDER_LIMB_BONES = ['armL', 'armR', 'thighL', 'shinL', 'thighR', 'shinR'] as const
/** The thigh/shin bone ids per leg side, for the walk + IK to address the chain. */
export const BUILDER_LEG_BONES = {
  L: { thigh: 'thighL', shin: 'shinL' },
  R: { thigh: 'thighR', shin: 'shinR' },
} as const
/** The body-chain bones the state machine drives for bob/lean/nod/squash. */
export const BUILDER_BODY_BONES = ['pelvis', 'spine', 'head'] as const
