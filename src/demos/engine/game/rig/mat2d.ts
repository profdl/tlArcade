/**
 * Engine — a tiny 2D affine matrix (rig math, PLAN §3.1).
 *
 * A PURE module — no tldraw import — so the rig data model and evaluator stay
 * editor-free and unit-testable, exactly like physics.ts / entities/step.ts. tldraw
 * has its own `Mat`, but pulling it in would couple the sim to the editor; the rig
 * needs only compose / apply / invert, so we keep a 6-number affine here.
 *
 * Convention: column-vector, `[a c tx; b d ty; 0 0 1]` — the same layout tldraw's
 * Mat uses, so a rig transform can be handed to the editor by reading the same
 * fields if ever needed. `apply` maps a point, `compose(m, n)` = m·n (n applied
 * first, i.e. child-local then parent), matching FK's parentWorld × local.
 */
export interface Mat2D {
  a: number
  b: number
  c: number
  d: number
  tx: number
  ty: number
}

export const IDENTITY: Mat2D = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }

/** A TRS-with-shear local transform, the form a Bone's rest/pose produces. */
export function fromTRS(
  x: number,
  y: number,
  rotation: number,
  scaleX = 1,
  scaleY = 1,
  shearX = 0,
  shearY = 0,
): Mat2D {
  // Rotation × shear × scale, then translate. Shear is applied in the bone's local
  // frame (Spine's model): a horizontal shear skews the x axis. Built directly into
  // the 2×2 to avoid three intermediate composes.
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  // Shear as a unit upper/lower triangular skew (radians → tangent offset).
  const shx = Math.tan(shearX)
  const shy = Math.tan(shearY)
  // scale then shear: sx along x, sy along y, then skew.
  const m00 = scaleX
  const m01 = scaleY * shx
  const m10 = scaleX * shy
  const m11 = scaleY
  // rotate the sheared-scaled basis.
  return {
    a: cos * m00 - sin * m10,
    b: sin * m00 + cos * m10,
    c: cos * m01 - sin * m11,
    d: sin * m01 + cos * m11,
    tx: x,
    ty: y,
  }
}

/** m · n — apply `n` first (child-local), then `m` (parent-world). */
export function compose(m: Mat2D, n: Mat2D): Mat2D {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    tx: m.a * n.tx + m.c * n.ty + m.tx,
    ty: m.b * n.tx + m.d * n.ty + m.ty,
  }
}

/** Map a point through the matrix. */
export function apply(m: Mat2D, p: { x: number; y: number }): { x: number; y: number } {
  return { x: m.a * p.x + m.c * p.y + m.tx, y: m.b * p.x + m.d * p.y + m.ty }
}

/** The matrix inverse. Throws on a singular (non-invertible) matrix. */
export function invert(m: Mat2D): Mat2D {
  const det = m.a * m.d - m.b * m.c
  if (det === 0) throw new Error('mat2d: non-invertible matrix')
  const inv = 1 / det
  return {
    a: m.d * inv,
    b: -m.b * inv,
    c: -m.c * inv,
    d: m.a * inv,
    tx: (m.c * m.ty - m.d * m.tx) * inv,
    ty: (m.b * m.tx - m.a * m.ty) * inv,
  }
}

/** The rotation angle (radians) encoded in the matrix's basis. */
export function rotationOf(m: Mat2D): number {
  return Math.atan2(m.b, m.a)
}

/** The translation (origin) the matrix places at. */
export function translationOf(m: Mat2D): { x: number; y: number } {
  return { x: m.tx, y: m.ty }
}
