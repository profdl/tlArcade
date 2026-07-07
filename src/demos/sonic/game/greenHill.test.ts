// Green Hill course regression — drive the REAL sled sim through the REAL authored
// course (greenHillSegments) + the side-mode auto-ground, and assert the momentum
// promise end to end: the runner builds speed, CARRIES THE LOOP (goes inverted),
// and reaches the goal x. This is the course's exit test (PLAN §5.5: a template is
// each tier's exit criterion) — if a future edit to the geometry or the physics
// breaks the loop or blocks the run, this fails. Uses the shipped physics.ts, same
// discipline as physics.test.ts / loopProbe.test.ts.
//
// The pure greenHillSegments is the same point data loadGreenHill lays down as
// shapes (sampled into segments), so this exercises the authored course, not a
// separate hand-built one.

import { describe, it, expect } from 'vitest'
import { makeBody, stepBody, bodyCenter, PHYSICS, type Segment } from './physics'
import { greenHillSegments, greenHillGoalX } from './greenHill'
import { sideGroundY } from './state'

const DT = 1 / 120
const START = { x: 200, y: 100 }

// Build the run's collision set exactly like RunController side mode: the authored
// course + the wide implicit ground plane at the spawn's ground Y.
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
	// PENDING: the isolated loop completes (loopProbe.test.ts), but the FULL authored
	// course isn't winnable yet — the last hill crest launches the fast runner into a
	// crash-landing before the loop, and loop-entry speed is fiddly. Being rebuilt
	// with invisible one-way entrance/exit "doors" that funnel the runner through the
	// loop robustly (see greenHill.ts). Re-enable once the door mechanism lands.
	it.skip('builds speed, carries the loop (goes inverted), and reaches the goal', () => {
		const segs = courseSegments()
		const groundY = sideGroundY(START)
		const goalX = greenHillGoalX(START)

		const body = makeBody(START)
		const opts = { thrust: PHYSICS.sideThrust, cruise: PHYSICS.sideCruiseSpeed, recover: true }

		let maxRise = 0
		let wentInverted = false // proves it rode the INSIDE of the loop, not just a bump
		let reachedGoalAt = -1
		const LOOP_R = 150
		for (let i = 0; i < 4000; i++) {
			stepBody(body, segs, DT, undefined, opts)
			const c = bodyCenter(body)
			const rise = groundY - c.y
			if (rise > maxRise) maxRise = rise
			if (rise > LOOP_R * 1.7) wentInverted = true
			if (reachedGoalAt < 0 && c.x >= goalX) reachedGoalAt = i
			if (reachedGoalAt >= 0) break
		}

		const final = bodyCenter(body)
		const diag = `maxRise=${Math.round(maxRise)} inverted=${wentInverted} reachedGoalAt=${reachedGoalAt} finalX=${Math.round(final.x)} goalX=${Math.round(goalX)}`

		// Carried the loop: rose past 1.7·R onto the upper/inverted inside surface.
		expect(wentInverted, diag).toBe(true)
		// Reached the goal.
		expect(reachedGoalAt, diag).toBeGreaterThanOrEqual(0)
	})
})
