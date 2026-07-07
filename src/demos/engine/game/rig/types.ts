/**
 * Engine — the rig data model (R1, Tier A rigid; PLAN §3.1).
 *
 * A PURE type module (no tldraw import), the setup-pose ("rig") half of the
 * animation split (§0 principle 5): an IMMUTABLE rig — rest transforms, tree,
 * attachments — stored once in a character's `meta.rig`; a SEPARATE live pose is
 * computed per frame by the evaluator (evaluate.ts) and never persisted.
 *
 * Coordinates are ENTITY-LOCAL: every bone rest transform and attachment is
 * relative to the character group's bind-time bounds top-left, so the rig is
 * translation-invariant — the runtime adds the entity's live (x,y) exactly as it
 * adds it to `playerSamples` today (see player.ts / engine.ts writeEntities).
 *
 * SCOPE for R1 (Tier A, rigid): the FULL structure below is faithful to §3.1, but
 * only what Tier A needs is LIVE — bones (FK), slots, and the `rigid` attachment
 * kind (one tldraw leaf shape rides one bone). The `skinnedPath` attachment and
 * `constraints` (IK/physics) are declared for forward-compat but are R3/R6 work;
 * the evaluator ignores them for now. `version` is 1; the loader migrates old docs
 * rather than crashing (levels persist in localStorage — see the shell CLAUDE.md).
 */
import type { Mat2D } from './mat2d'

/**
 * How a bone inherits its parent's transform (Spine's enum). R1 implements
 * `normal` (full inheritance) — the rest are declared for forward-compat and fall
 * back to `normal` in the evaluator until R3.
 */
export type InheritMode = 'normal' | 'onlyTranslation' | 'noRotation' | 'noScale'

/**
 * One bone. A strict tree: exactly one root (`parentId === null`); every other
 * bone names its parent. `x,y` is the bone's PIVOT relative to its PARENT'S pivot
 * (parent-origin-relative), and `rotation` its rest angle relative to the parent —
 * FK composes parentWorld · local, so a child rides its parent's rotation about the
 * parent's pivot. `length` (|pivot→tip|) is descriptive here (used by IK later); FK
 * does not read it. The authoring editor sets the pivot from the bone's drawn START
 * point, so a limb rotates about its joint (shoulder/hip), not its center.
 */
export interface Bone {
  id: string
  parentId: string | null
  /** Rest local transform (parent-relative). Rotation in radians. */
  x: number
  y: number
  rotation: number
  scaleX: number
  scaleY: number
  /** Shear (radians) → squash/stretch without a separate scale channel. */
  shearX: number
  shearY: number
  /** Bone length — places a child bone's origin at the tip; used by IK/skinning. */
  length: number
  inherit: InheritMode
}

/**
 * A draw slot: which bone drives an attachment, and its draw order. Kept distinct
 * from the bone (Spine/Rive model) so the same bone can drive different
 * attachments across skins, and draw order is independent of the bone tree.
 */
export interface Slot {
  id: string
  boneId: string
  drawOrder: number
  /** The attachment key within the active skin (see Rig.skins). */
  attachment: string
}

/**
 * What a slot draws. R1 ships only `rigid` — one native tldraw leaf shape,
 * identified by its shape id, transformed rigidly by its bone each frame (Tier A,
 * §6). `skinnedPath` (weighted mesh, Tier C) is R6 and only declared here.
 */
export type Attachment =
  | { kind: 'rigid'; leafId: string }
  | { kind: 'skinnedPath'; verts: SkinVertex[]; closed: boolean }

/** A weighted-mesh control point (Tier C / R6 — declared, not evaluated in R1). */
export interface SkinVertex {
  x: number
  y: number
  influences: { boneIndex: number; weight: number }[]
  handleOf?: number
}

/**
 * An ORDERED constraint (evaluated in `order`; §3.2). Declared for forward-compat;
 * R1's evaluator does not solve constraints (that's R3). Kept in the model so the
 * schema and stored shape don't change when R3 lands.
 */
export type Constraint =
  | { kind: 'ik'; order: number; bones: string[]; target: string; mix: number; bendDirection: 1 | -1; softness: number }
  | { kind: 'transform'; order: number; bones: string[]; target: string; mixRotate: number; mixTranslate: number; mixScale: number }
  | { kind: 'path'; order: number; bones: string[]; targetSlot: string; positionMode: 'fixed' | 'percent'; rotateMode: 'tangent' | 'chain' }
  | { kind: 'physics'; order: number; bones: string[]; inertia: number; strength: number; damping: number; mass: number; gravity: number; wind: number; mix: number }

/**
 * The immutable rig stored in `meta.rig`. `bindInverse` (inverse bind matrix per
 * bone) is used by skinning (Tier C, §3.4 step 4); Tier A rigid deform rides the
 * bone directly, but the field is kept so R6 doesn't reshape the model.
 */
export interface Rig {
  version: 1
  root: string
  bones: Bone[]
  slots: Slot[]
  /** skinName → (slotId → attachment). R1 uses a single 'default' skin. */
  skins: Record<string, Record<string, Attachment>>
  constraints: Constraint[]
  bindInverse: Record<string, Mat2D>
}

/** A fresh identity-ish bone at the origin (rest pose builder). */
export function makeBone(id: string, parentId: string | null): Bone {
  return {
    id,
    parentId,
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
}
