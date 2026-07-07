/**
 * Engine — a pure 2-bone analytic IK solver (Phase B: bending-knee legs).
 *
 * PURE and editor-free (no tldraw import), unit-tested like mat2d.ts / evaluate.ts.
 * Given a two-bone chain (thigh + shin) rooted at a hip, and a foot TARGET point in
 * the hip's frame, it returns the two WORLD angles (thigh, shin) that place the foot
 * on the target — the closed-form law-of-cosines solution (no iteration needed for
 * two bones). The walk pose (walk.ts) turns those world angles into local `rotation`
 * deltas the rig evaluator applies to the thigh and shin bones, so the knee bends and
 * the foot reaches a planted world position.
 *
 * Angles are in radians, math convention (0 = +x, growing toward +y). With the sim's
 * +y-down screen space, +y is downward — the caller supplies `bendSign` to pick which
 * way the knee buckles (a leg bends its knee FORWARD, so the two solutions are mirror
 * images and only one reads as a knee, not a backward-breaking joint).
 */

/** The solved chain: absolute WORLD angles of the thigh and shin, and whether the
 *  target was out of reach (clamped to full extension). */
export interface IkSolution {
  /** World angle of the thigh (hip→knee direction), radians. */
  thigh: number
  /** World angle of the shin (knee→foot direction), radians. */
  shin: number
  /** True if the target was farther than L1+L2 (or closer than |L1−L2|) and the
   *  solution was clamped to the reachable boundary (straight or fully folded). */
  clamped: boolean
}

/**
 * Solve the 2-bone chain so the foot reaches `target` (given relative to the hip
 * pivot). `l1` = thigh length, `l2` = shin length. `bendSign` (+1 / −1) selects the
 * elbow/knee side: the two mirror solutions bend the knee opposite ways; the caller
 * fixes the sign so the knee always buckles the anatomically correct direction.
 *
 * Law of cosines: with reach `d = |target|`, the interior angle at the hip between the
 * thigh and the straight hip→foot line is `acos((l1²+d²−l2²)/(2·l1·d))`, and the knee's
 * interior angle from the same law. The thigh world angle is the direction to the
 * target rotated by ±that hip angle; the shin follows from the knee bend.
 */
export function solveTwoBoneIk(
  target: { x: number; y: number },
  l1: number,
  l2: number,
  bendSign: 1 | -1,
): IkSolution {
  const d = Math.hypot(target.x, target.y)
  const toTarget = Math.atan2(target.y, target.x)

  // Reach limits. Beyond L1+L2 the leg can't reach → point straight at the target
  // (fully extended). Inside |L1−L2| it can't fold that tight → also clamp.
  const maxReach = l1 + l2
  const minReach = Math.abs(l1 - l2)
  if (d >= maxReach) {
    return { thigh: toTarget, shin: toTarget, clamped: true }
  }
  if (d <= minReach) {
    // Fully folded: thigh points at the target, shin doubles back. Rare for a leg
    // (l1≈l2 ⇒ minReach≈0), but keep it well-defined so the solver never NaNs.
    return { thigh: toTarget, shin: toTarget + Math.PI, clamped: true }
  }

  // Interior angle at the hip between the thigh and the hip→foot line.
  const cosHip = clampUnit((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))
  const hipAngle = Math.acos(cosHip)
  // Interior angle at the knee between the thigh and shin (supplement gives the bend).
  const cosKnee = clampUnit((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2))
  const kneeInterior = Math.acos(cosKnee)

  // Thigh world angle: rotate the direction-to-target by ±hipAngle (bendSign picks
  // the side). Shin world angle: continue from the thigh, turning by the knee's
  // exterior angle (π − interior) toward the same bend side.
  const thigh = toTarget + bendSign * hipAngle
  const shin = thigh - bendSign * (Math.PI - kneeInterior)
  return { thigh, shin, clamped: false }
}

/** Clamp to [-1, 1] so acos never NaNs on floating-point overshoot. */
function clampUnit(x: number): number {
  return x < -1 ? -1 : x > 1 ? 1 : x
}
