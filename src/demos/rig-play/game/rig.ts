/**
 * rig-play — runtime rig glue (editor ↔ pure rig).
 *
 * Two small helpers the runtime needs, ported from the Engine demo's engine.ts:
 *   - `readRig` reads a character's baked `meta.rig` (version-guarded).
 *   - `legRigsFrom` measures the static per-side leg geometry from the REST rig once
 *     at start, so the IK walk can plant feet and solve the two-bone chain.
 * Kept apart from runtime.ts so the runtime stays focused on the loop.
 */
import type { TLShape } from 'tldraw'
import { evaluateBoneWorlds } from '../rig/evaluate'
import type { Rig } from '../rig/types'
import { BUILDER_LEG_BONES } from '../rig/builderRig'
import type { LegRig } from '../rig/walk'

/** The rig baked onto a character's meta, or undefined for an unrigged figure. */
export function readRig(shape: TLShape): Rig | undefined {
  const baked = (shape.meta as { rig?: Rig } | undefined)?.rig
  return baked && baked.version === 1 ? baked : undefined
}

/**
 * Static per-side leg geometry for the IK walk, measured from the REST rig (pose {}).
 * Returns null if the rig has no thigh/shin chain (a hand-drawn rig without the
 * builder's leg-bone ids ⇒ the walk falls back to the straight-thigh path).
 */
export function legRigsFrom(rig: Rig): { L: LegRig; R: LegRig } | null {
  const worlds = new Map(evaluateBoneWorlds(rig, {}).map((w) => [w.id, w]))
  const boneById = new Map(rig.bones.map((b) => [b.id, b]))
  const build = (side: 'L' | 'R'): LegRig | null => {
    const ids = BUILDER_LEG_BONES[side]
    const thighW = worlds.get(ids.thigh)
    const thighB = boneById.get(ids.thigh)
    const shinB = boneById.get(ids.shin)
    if (!thighW || !thighB || !shinB) return null
    return {
      hip: { x: thighW.pivot.x, y: thighW.pivot.y },
      restThighWorld: Math.atan2(thighW.tip.y - thighW.pivot.y, thighW.tip.x - thighW.pivot.x),
      restShinLocal: shinB.rotation,
      thighLen: thighB.length,
      shinLen: shinB.length,
      // Both knees buckle the same way (−1); an opposite sign per leg bends one backward.
      bendSign: -1,
    }
  }
  const L = build('L')
  const R = build('R')
  return L && R ? { L, R } : null
}
