/**
 * Engine — 2D affine matrix (rig math) unit tests.
 */
import { describe, expect, it } from 'vitest'
import { apply, compose, fromTRS, IDENTITY, invert, rotationOf } from './mat2d'

const close = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps
const closePt = (p: { x: number; y: number }, x: number, y: number, eps = 1e-9) =>
  close(p.x, x, eps) && close(p.y, y, eps)

describe('mat2d', () => {
  it('identity maps a point to itself', () => {
    expect(apply(IDENTITY, { x: 3, y: -4 })).toEqual({ x: 3, y: -4 })
  })

  it('fromTRS translation only', () => {
    const m = fromTRS(10, 20, 0)
    expect(apply(m, { x: 1, y: 2 })).toEqual({ x: 11, y: 22 })
  })

  it('fromTRS rotates about the origin (y-down: +90° sends +x to +y)', () => {
    const m = fromTRS(0, 0, Math.PI / 2)
    const p = apply(m, { x: 1, y: 0 })
    expect(closePt(p, 0, 1)).toBe(true)
  })

  it('fromTRS scales', () => {
    const m = fromTRS(0, 0, 0, 2, 3)
    expect(apply(m, { x: 1, y: 1 })).toEqual({ x: 2, y: 3 })
  })

  it('compose applies the right matrix first (child then parent)', () => {
    const parent = fromTRS(10, 0, 0) // translate +x
    const child = fromTRS(0, 0, Math.PI / 2) // rotate
    const m = compose(parent, child)
    // point (1,0): rotate → (0,1), then translate → (10,1)
    expect(closePt(apply(m, { x: 1, y: 0 }), 10, 1)).toBe(true)
  })

  it('invert undoes a transform', () => {
    const m = fromTRS(5, -3, 0.7, 1.5, 0.8)
    const inv = invert(m)
    const round = compose(inv, m)
    expect(closePt(apply(round, { x: 2, y: 9 }), 2, 9, 1e-9)).toBe(true)
  })

  it('invert throws on a singular matrix', () => {
    expect(() => invert({ a: 0, b: 0, c: 0, d: 0, tx: 1, ty: 1 })).toThrow()
  })

  it('rotationOf recovers the rotation angle', () => {
    expect(close(rotationOf(fromTRS(0, 0, 0.5)), 0.5)).toBe(true)
  })
})
