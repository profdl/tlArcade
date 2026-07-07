// Loop-physics proof — the sled sim rides the INSIDE of a full vertical loop and
// comes out the far side. This is the thing the PLAN flagged as the hard part of
// Sonic (§4.6) and the whole reason M6 uses the Verlet sled, not the AABB engine.
//
// Three ingredients make it work (each discovered by probing the real sim, see the
// git history / greenHill.ts loop authoring):
//  1. the loop is built from ONE-WAY segments oriented so the runner passes through
//     the overhanging top from outside and rides the inside surface (a closed solid
//     circle is just a wall — its overhang blocks the approach);
//  2. LOOP MODE (physics.ts onLoopSegment): on a steep one-way segment the upright
//     spring and tilt/spin crash are suppressed, so the sled orients to the surface
//     and goes inverted over the top instead of righting off it / crashing;
//  3. enough speed — sideCruiseSpeed 3500 (a slower runner stalls near the top).
//
// Drives the REAL shipped physics.ts (not a reimplementation), same as
// physics.test.ts, so a regression in any of the three fails here.

import { describe, it, expect } from 'vitest'
import { makeBody, stepBody, bodyCenter, PHYSICS, type Segment } from './physics'

const DT = 1 / 120

// A continuous surface: flat run-up → a loop of ONE-WAY segments → flat run-out.
// The loop's bottom sits at the entry point on the ground; it's traced from the
// bottom up the +x side, over the top, and down, so its ends rejoin the ground.
// `flip: false` orients each one-way to block from the inside (proven orientation).
function buildLoopSurface(entryX: number, R: number, endX: number): Segment[] {
	const cx = entryX
	const cy = -R // center one radius above the entry → loop bottom on the ground
	const N = 72
	const loop: { x: number; y: number }[] = []
	for (let i = 0; i <= N; i++) {
		const a = Math.PI / 2 - (i / N) * Math.PI * 2
		loop.push({ x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R })
	}
	const segs: Segment[] = [{ a: { x: 0, y: 0 }, b: { x: entryX, y: 0 }, kind: 'solid', strength: 1 }]
	for (let i = 0; i < loop.length - 1; i++) {
		segs.push({ a: loop[i], b: loop[i + 1], kind: 'oneway', strength: 1, flip: false })
	}
	segs.push({ a: { x: entryX, y: 0 }, b: { x: endX, y: 0 }, kind: 'solid', strength: 1 })
	return segs
}

describe('sled physics: riding a full vertical loop', () => {
	it('is carried up the inside, goes inverted over the top, and comes out past it', () => {
		const R = 150
		const entryX = 1800 // long flat run-up to reach cruise before the loop
		const endX = entryX + 1400
		const segs = buildLoopSurface(entryX, R, endX)

		const body = makeBody({ x: 60, y: -PHYSICS.bodyRadius })
		const opts = { thrust: PHYSICS.sideThrust, cruise: PHYSICS.sideCruiseSpeed, recover: true }

		let maxRise = 0 // highest the body center reached above the ground
		let wentInverted = false // rose past ~1.7R → onto the upper/inverted inside
		let cameOutAt = -1
		for (let i = 0; i < 2000; i++) {
			stepBody(body, segs, DT, undefined, opts)
			const c = bodyCenter(body)
			const rise = -c.y // ground y=0, up is negative
			if (rise > maxRise) maxRise = rise
			if (rise > R * 1.7) wentInverted = true
			// Out of the loop: back down near the ground, beyond the loop, having gone
			// inverted (so it actually went AROUND, not just up and back down).
			if (cameOutAt < 0 && wentInverted && c.x > entryX + R * 0.5 && rise < R * 0.4) {
				cameOutAt = i
			}
			if (cameOutAt >= 0) break
		}

		const final = bodyCenter(body)
		const diag = `maxRise=${Math.round(maxRise)} (loop top≈${2 * R}) inverted=${wentInverted} cameOutAt=${cameOutAt} finalX=${Math.round(final.x)}`

		// It reached the top of the loop (near the full 2R apex).
		expect(maxRise, diag).toBeGreaterThan(R * 1.7)
		// It went inverted (proving it rode the inside, not just bounced up).
		expect(wentInverted, diag).toBe(true)
		// It came out the far side and back to the ground, still going.
		expect(cameOutAt, diag).toBeGreaterThanOrEqual(0)
	})
})
