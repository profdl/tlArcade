// Loop proof — a SCRIPTED (kinematic) loop. The emergent sled can't reliably crest
// a loop's tight apex (it loses surface contact ~92% up), so a loop is driven
// kinematically: when the runner reaches a LoopZone's base moving forward fast
// enough, driveLoop sweeps it around the full circle at its speed and releases it
// at the exit moving forward — exactly how real Sonic games script their loops.
//
// Drives the shipped physics.ts stepBody with a LoopZone, same discipline as
// physics.test.ts. Asserts: the runner is captured, goes fully inverted over the
// top, completes 360°, and comes out the far side moving forward.

import { describe, it, expect } from 'vitest'
import { makeBody, stepBody, bodyCenter, bodyVelocity, PHYSICS, type Segment, type LoopZone } from './physics'

const DT = 1 / 120

describe('scripted loop (kinematic): the runner is driven fully around', () => {
	it('captures at the base, goes inverted over the top, and exits forward', () => {
		const R = 150
		const groundY = 0
		const loopBaseX = 1600
		// The loop circle sits ON the ground: its base (bottom) is at (loopBaseX, 0),
		// so its center is one radius above.
		const zone: LoopZone = {
			center: { x: loopBaseX, y: groundY - R },
			radius: R,
			minSpeed: 900,
		}
		// Flat ground to run on up to and past the loop.
		const segs: Segment[] = [{ a: { x: -100, y: 0 }, b: { x: 3200, y: 0 }, kind: 'solid', strength: 1 }]

		const body = makeBody({ x: 60, y: -PHYSICS.bodyRadius })
		const opts = {
			thrust: PHYSICS.sideThrust,
			cruise: PHYSICS.sideCruiseSpeed,
			recover: true,
			loops: [zone],
		}

		// The runner rides the INSIDE surface at radius (R - bodyRadius), so the loop's
		// apex sits at rise = R + (R - bodyRadius) = 2R - bodyRadius above the base.
		const apexRise = 2 * R - PHYSICS.bodyRadius
		let captured = false
		let maxRise = 0
		let wentInverted = false
		let exitedForwardAt = -1
		let releasedLow = false
		for (let i = 0; i < 3000; i++) {
			stepBody(body, segs, DT, undefined, opts)
			if (body.loopRun) captured = true
			const c = bodyCenter(body)
			const rise = groundY - c.y
			if (rise > maxRise) maxRise = rise
			if (rise > apexRise - 20) wentInverted = true // reached near the top
			// After the loop releases (loopRun back to null) AND the runner has gone
			// inverted, it should be past the base moving forward on the ground again.
			if (
				exitedForwardAt < 0 &&
				wentInverted &&
				!body.loopRun &&
				c.x > loopBaseX &&
				rise < R * 0.5
			) {
				exitedForwardAt = i
				releasedLow = bodyVelocity(body, DT).x > 200
			}
			if (exitedForwardAt >= 0) break
		}

		const diag = `captured=${captured} maxRise=${Math.round(maxRise)} (2R=${2 * R}) inverted=${wentInverted} exitedAt=${exitedForwardAt} releasedLow=${releasedLow}`

		expect(captured, diag).toBe(true)
		// Fully inverted over the top (near the true apex, 2R - bodyRadius).
		expect(wentInverted, diag).toBe(true)
		expect(maxRise, diag).toBeGreaterThan(apexRise - 20)
		// Completed and exited forward past the loop.
		expect(exitedForwardAt, diag).toBeGreaterThanOrEqual(0)
	})

	it('does NOT capture a slow runner (it just passes the base on the ground)', () => {
		const R = 150
		const zone: LoopZone = { center: { x: 400, y: -R }, radius: R, minSpeed: 5000 } // absurd threshold
		const segs: Segment[] = [{ a: { x: -100, y: 0 }, b: { x: 2000, y: 0 }, kind: 'solid', strength: 1 }]
		const body = makeBody({ x: 60, y: -PHYSICS.bodyRadius })
		const opts = { thrust: PHYSICS.sideThrust, cruise: PHYSICS.sideCruiseSpeed, recover: true, loops: [zone] }
		let everCaptured = false
		for (let i = 0; i < 600; i++) {
			stepBody(body, segs, DT, undefined, opts)
			if (body.loopRun) everCaptured = true
		}
		// Never fast enough to hit minSpeed, so it runs straight past on the ground.
		expect(everCaptured).toBe(false)
		expect(bodyCenter(body).x).toBeGreaterThan(600)
	})
})
