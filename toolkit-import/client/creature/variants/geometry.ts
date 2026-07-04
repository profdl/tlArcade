/**
 * SHARED VARIANT GEOMETRY HELPERS
 * ===============================
 * Reusable builders so each variant file stays tiny and they don't re-implement
 * the segment-ring math. A variant describes its silhouette as a SPINE curve + a
 * RADIUS profile along it, and `buildChain` slices that into the overlapping
 * kinematic-chain segments the renderer expects.
 */
import type { Chain, Pt } from './types'

/** Points sampled along each segment edge. Higher = smoother outline, more mount
 *  cost (paths build once, so this never affects per-frame cost). */
const SAMPLES_PER_UNIT = 20

export type SpineFn = (u: number) => Pt // centre-line point at u∈[0,1]
export type RadiusFn = (u: number) => number // half-thickness at u

/**
 * Build a kinematic chain from a spine + radius over `segCount` segments. Each
 * segment is a closed ring [top edge → reversed bottom edge]; segment i extends
 * `overlap` past its end into the next so the seam hides when the chain bends.
 * joints[i] sits on the spine at the segment's start (its rotation hinge).
 */
export function buildChain(
	spine: SpineFn,
	radius: RadiusFn,
	segCount: number,
	opts: Pick<Chain, 'role' | 'amp' | 'phaseLag' | 'phaseOffset'> & { overlap?: number }
): Chain {
	const overlap = opts.overlap ?? 0.08
	const segments: Pt[][] = []
	const joints: Pt[] = []
	for (let i = 0; i < segCount; i++) {
		const uStart = i / segCount
		const uEnd = Math.min(1, (i + 1) / segCount + overlap)
		segments.push(ring(spine, radius, uStart, uEnd))
		joints.push(spine(uStart))
	}
	return {
		segments,
		joints,
		role: opts.role,
		amp: opts.amp,
		phaseLag: opts.phaseLag,
		phaseOffset: opts.phaseOffset,
		anchor: spine(0),
	}
}

/** A single closed outline ring over [uStart, uEnd]. Thickness is laid PERPENDICULAR
 *  to the spine's local direction, so this is correct for spines at any angle —
 *  horizontal bodies, vertical tentacles, and diagonal crab legs alike. (Built once
 *  at mount, so the extra tangent math costs nothing per frame.) */
export function ring(spine: SpineFn, radius: RadiusFn, uStart: number, uEnd: number): Pt[] {
	const top: Pt[] = []
	const bottom: Pt[] = []
	const steps = Math.max(2, Math.round(SAMPLES_PER_UNIT * (uEnd - uStart)))
	const du = uEnd - uStart
	for (let i = 0; i <= steps; i++) {
		const u = uStart + du * (i / steps)
		const c = spine(u)
		const r = radius(u)
		// Local unit normal = perpendicular to the spine tangent, found from a small
		// finite difference. Offset the two edges ±r along it. Falls back to ±y for a
		// degenerate (zero-length) tangent.
		const eps = 0.001
		const a = spine(Math.max(0, u - eps))
		const b = spine(Math.min(1, u + eps))
		let nx = -(b.y - a.y)
		let ny = b.x - a.x
		const len = Math.hypot(nx, ny)
		if (len < 1e-6) {
			nx = 0
			ny = 1
		} else {
			nx /= len
			ny /= len
		}
		top.push({ x: c.x + nx * r, y: c.y + ny * r })
		bottom.unshift({ x: c.x - nx * r, y: c.y - ny * r })
	}
	return [...top, ...bottom]
}

/** A simple polygon ring from explicit points (for fins, claws, bells, etc.). */
export function polygon(pts: Pt[]): Pt[] {
	return pts
}

/** Deterministic pseudo-random in [0,1) from a seed + index (no Math.random, so
 *  every client draws the identical creature). */
export function rand(seed: number, i: number): number {
	const x = Math.sin((seed * 100 + i) * 127.1 + 311.7) * 43758.5453
	return x - Math.floor(x)
}
