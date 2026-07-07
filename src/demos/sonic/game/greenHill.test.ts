// Green Hill course regression — drive the REAL sled sim through the REAL authored
// course (greenHillSegments + greenHillLoops) + the side-mode auto-ground, and
// assert the momentum promise end to end: the runner builds speed, is scripted
// AROUND the loop (goes fully inverted), and reaches the goal x. The course's exit
// test (PLAN §5.5). Uses the shipped physics.ts, same discipline as physics.test.ts.
//
// The pure greenHillSegments / greenHillLoops are the same data loadGreenHill lays
// down as shapes, so this exercises the authored course, not a separate one.

import { describe, it, expect } from 'vitest'
import { makeBody, stepBody, bodyCenter, PHYSICS, type Segment } from './physics'
import { greenHillSegments, greenHillLoops, greenHillGoalX } from './greenHill'
import { sideGroundY } from './state'

const DT = 1 / 120
const START = { x: 200, y: 100 }

function courseSegments(): Segment[] {
	const groundY = sideGroundY(START)
	const GROUND_HALF = 100_000
	return [
		...greenHillSegments(START),
		{
			a: { x: START.x - GROUND_HALF, y: groundY },
			b: { x: START.x + GROUND_HALF, y: groundY },
			kind: 'solid',
			strength: 1,
		},
	]
}

describe('Green Hill course: the momentum run is winnable', () => {
	it('builds speed, is scripted around the loop (goes inverted), and reaches the goal', () => {
		const segs = courseSegments()
		const loops = greenHillLoops(START)
		const groundY = sideGroundY(START)
		const goalX = greenHillGoalX(START)

		const body = makeBody(START)
		const opts = { thrust: PHYSICS.sideThrust, cruise: PHYSICS.sideCruiseSpeed, recover: true, loops }

		// The loop rides its inside surface; its apex sits ~2R - bodyRadius above ground.
		const loopR = loops[0].radius
		const apexRise = 2 * loopR - PHYSICS.bodyRadius
		let maxRise = 0
		let wentInverted = false
		let reachedGoalAt = -1
		for (let i = 0; i < 4000; i++) {
			stepBody(body, segs, DT, undefined, opts)
			const c = bodyCenter(body)
			const rise = groundY - c.y
			if (rise > maxRise) maxRise = rise
			if (rise > apexRise - 20) wentInverted = true
			if (reachedGoalAt < 0 && c.x >= goalX) reachedGoalAt = i
			if (reachedGoalAt >= 0) break
		}

		const final = bodyCenter(body)
		const diag = `maxRise=${Math.round(maxRise)} (apex≈${Math.round(apexRise)}) inverted=${wentInverted} reachedGoalAt=${reachedGoalAt} finalX=${Math.round(final.x)} goalX=${Math.round(goalX)}`

		// Went around the loop (rose near the apex, i.e. fully inverted).
		expect(wentInverted, diag).toBe(true)
		// Reached the goal.
		expect(reachedGoalAt, diag).toBeGreaterThanOrEqual(0)
	})
})
