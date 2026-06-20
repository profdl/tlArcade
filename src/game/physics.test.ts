import { describe, it, expect } from 'vitest'
import { makeRider, step, velocity, PHYSICS, type Segment } from './physics'

const DT = 1 / 120

function run(rider: ReturnType<typeof makeRider>, segments: Segment[], steps: number) {
	for (let i = 0; i < steps; i++) step(rider, segments, DT)
	return rider
}

describe('physics: free fall', () => {
	it('accelerates downward under gravity with no segments', () => {
		const r = makeRider({ x: 0, y: 0 })
		run(r, [], 60) // ~0.5s
		// Should have moved down (positive y) and gained downward velocity.
		expect(r.pos.y).toBeGreaterThan(0)
		const v = velocity(r, DT)
		expect(v.y).toBeGreaterThan(0)
		// No horizontal drift in pure fall.
		expect(Math.abs(r.pos.x)).toBeLessThan(1e-6)
	})

	it('falls farther over more time (monotonic)', () => {
		const a = run(makeRider({ x: 0, y: 0 }), [], 30)
		const b = run(makeRider({ x: 0, y: 0 }), [], 60)
		expect(b.pos.y).toBeGreaterThan(a.pos.y)
	})
})

describe('physics: flat floor collision', () => {
	// A long horizontal line at y = 50.
	const floor: Segment = { a: { x: -1000, y: 50 }, b: { x: 1000, y: 50 } }

	it('rider comes to rest on the floor instead of passing through', () => {
		const r = makeRider({ x: 0, y: 0 })
		run(r, [floor], 240) // 2s — plenty to settle
		// Rider sits just above the line by ~its radius, never far below it.
		expect(r.pos.y).toBeLessThanOrEqual(50)
		expect(r.pos.y).toBeGreaterThan(50 - PHYSICS.riderRadius - 2)
	})

	it('vertical velocity is killed once resting on the floor', () => {
		const r = makeRider({ x: 0, y: 0 })
		run(r, [floor], 240)
		const v = velocity(r, DT)
		// Settled: vertical velocity is essentially zero, not still driving down
		// into the floor. A loose bound here would pass even while falling fast.
		expect(Math.abs(v.y)).toBeLessThan(1)
	})
})

describe('physics: slope produces horizontal motion', () => {
	// A line sloping down to the right (from high-left to low-right).
	const slope: Segment = { a: { x: -200, y: -100 }, b: { x: 200, y: 100 } }

	it('rider slides down-slope, gaining +x and +y', () => {
		const r = makeRider({ x: 0, y: -20 }) // start above the slope
		run(r, [slope], 180)
		// Down a right-leaning slope means moving right and down.
		expect(r.pos.x).toBeGreaterThan(0)
		expect(r.pos.y).toBeGreaterThan(-20)
	})
})

describe('physics: lines are near-frictionless', () => {
	// A gentle downhill slope. Riding it should ACCELERATE the sled, not stall it.
	const slope: Segment = { a: { x: -400, y: 0 }, b: { x: 400, y: 200 } }

	it('sled keeps accelerating along a downhill line (low surface friction)', () => {
		const r = makeRider({ x: -380, y: -10 })
		// Speed early in the ride vs later — should grow, not shrink.
		run(r, [slope], 60)
		const early = Math.hypot(velocity(r, DT).x, velocity(r, DT).y)
		run(r, [slope], 60)
		const later = Math.hypot(velocity(r, DT).x, velocity(r, DT).y)
		expect(later).toBeGreaterThan(early)
	})
})

describe('physics: speed clamp', () => {
	it('never exceeds maxSpeed even after a long fall', () => {
		const r = makeRider({ x: 0, y: 0 })
		run(r, [], 600) // 5s
		const v = velocity(r, DT)
		const speed = Math.hypot(v.x, v.y)
		expect(speed).toBeLessThanOrEqual(PHYSICS.maxSpeed + 1)
	})

	it('a perfectly stationary rider stays finite (no NaN from zero-velocity clamp)', () => {
		// Wedge the rider exactly on a flat floor with zero initial velocity.
		const floor: Segment = { a: { x: -100, y: 0 }, b: { x: 100, y: 0 } }
		const r = makeRider({ x: 0, y: 0 })
		r.prev = { x: 0, y: 0 }
		step(r, [floor], DT)
		expect(Number.isFinite(r.pos.x)).toBe(true)
		expect(Number.isFinite(r.pos.y)).toBe(true)
	})
})

describe('physics: accelerate lines', () => {
	const flat = (kind?: Segment['kind']): Segment => ({
		a: { x: -1000, y: 50 },
		b: { x: 1000, y: 50 },
		kind,
	})

	it('an accelerate line drives the sled faster than a plain solid line', () => {
		// Start just above the floor with initial rightward motion and let
		// gravity press it into contact so collisions (and the boost) fire.
		const solid = makeRider({ x: 0, y: 40 })
		solid.prev = { x: -2, y: 40 }
		run(solid, [flat('solid')], 240)

		const boost = makeRider({ x: 0, y: 40 })
		boost.prev = { x: -2, y: 40 }
		run(boost, [flat('accelerate')], 240)

		expect(boost.pos.x).toBeGreaterThan(solid.pos.x)
	})

	it('stays on a long line without runaway speed or tunneling', () => {
		// A practically infinite line so the sled never runs off the end.
		const line: Segment = { a: { x: -1e7, y: 50 }, b: { x: 1e7, y: 50 }, kind: 'accelerate' }
		const r = makeRider({ x: 0, y: 40 })
		r.prev = { x: -2, y: 40 }
		run(r, [line], 2000)
		// Still riding the line (didn't tunnel through), and speed is capped.
		expect(Math.abs(r.pos.y - (50 - PHYSICS.riderRadius))).toBeLessThan(2)
		const v = velocity(r, DT)
		expect(Math.hypot(v.x, v.y)).toBeLessThanOrEqual(PHYSICS.accelerateMaxSpeed + 50)
	})
})

describe('physics: brake lines', () => {
	const flat = (kind?: Segment['kind']): Segment => ({
		a: { x: -1e7, y: 50 },
		b: { x: 1e7, y: 50 },
		kind,
	})

	it('a brake line slows the sled vs a plain solid line', () => {
		// Both start with the same rightward motion, pressed onto the floor.
		const solid = makeRider({ x: 0, y: 44 })
		solid.prev = { x: -6, y: 44 } // ~720 px/s rightward
		run(solid, [flat('solid')], 120)

		const brake = makeRider({ x: 0, y: 44 })
		brake.prev = { x: -6, y: 44 }
		run(brake, [flat('brake')], 120)

		// The braked sled covers less ground because tangential drag bleeds speed.
		expect(brake.pos.x).toBeLessThan(solid.pos.x)
	})
})

describe('physics: bounce lines', () => {
	const flat = (kind?: Segment['kind']): Segment => ({
		a: { x: -1000, y: 50 },
		b: { x: 1000, y: 50 },
		kind,
	})

	it('a sled rebounds higher off a bounce line than off a solid line', () => {
		// Drop from the same height; measure the rebound apex reached strictly
		// AFTER the sled first makes contact with the floor (y near 50). Tracking
		// the apex only post-contact avoids counting the shared drop start.
		const apexAfterContact = (kind: Segment['kind']): number => {
			const r = makeRider({ x: 0, y: -50 })
			let contacted = false
			let apex = Infinity // smallest (highest) y seen after contact
			for (let i = 0; i < 120; i++) {
				step(r, [flat(kind)], DT)
				if (!contacted && r.pos.y > 50 - PHYSICS.riderRadius - 2) contacted = true
				if (contacted) apex = Math.min(apex, r.pos.y)
			}
			return apex
		}
		// Higher rebound = smaller (more negative) apex y after the bounce.
		expect(apexAfterContact('bounce')).toBeLessThan(apexAfterContact('solid'))
	})
})

describe('physics: sticky lines', () => {
	const flat = (kind?: Segment['kind']): Segment => ({
		a: { x: -1e7, y: 50 },
		b: { x: 1e7, y: 50 },
		kind,
	})

	it('a sticky line drags the sled to a near-stop faster than solid', () => {
		const solid = makeRider({ x: 0, y: 44 })
		solid.prev = { x: -6, y: 44 }
		run(solid, [flat('solid')], 120)

		const sticky = makeRider({ x: 0, y: 44 })
		sticky.prev = { x: -6, y: 44 }
		run(sticky, [flat('sticky')], 120)

		expect(sticky.pos.x).toBeLessThan(solid.pos.x)
	})
})

describe('physics: ice lines', () => {
	const flat = (kind?: Segment['kind']): Segment => ({
		a: { x: -1e7, y: 50 },
		b: { x: 1e7, y: 50 },
		kind,
	})

	it('an ice line preserves more glide than a solid line', () => {
		const solid = makeRider({ x: 0, y: 44 })
		solid.prev = { x: -6, y: 44 }
		run(solid, [flat('solid')], 200)

		const ice = makeRider({ x: 0, y: 44 })
		ice.prev = { x: -6, y: 44 }
		run(ice, [flat('ice')], 200)

		// Frictionless ice lets the sled travel at least as far as the (already
		// near-frictionless) solid line.
		expect(ice.pos.x).toBeGreaterThanOrEqual(solid.pos.x)
	})
})

describe('physics: light variants are weaker', () => {
	const flat = (kind: Segment['kind'], strength?: number): Segment => ({
		a: { x: -1e7, y: 50 },
		b: { x: 1e7, y: 50 },
		kind,
		strength,
	})

	it('a half-strength accelerate line boosts less than full strength', () => {
		const full = makeRider({ x: 0, y: 40 })
		full.prev = { x: -2, y: 40 }
		run(full, [flat('accelerate', 1)], 240)

		const half = makeRider({ x: 0, y: 40 })
		half.prev = { x: -2, y: 40 }
		run(half, [flat('accelerate', 0.5)], 240)

		expect(half.pos.x).toBeLessThan(full.pos.x)
	})
})

describe('physics: one-way lines', () => {
	// Left-hand normal of a left->right segment points up (-y), so "front" is above.
	const oneway: Segment = { a: { x: -1000, y: 50 }, b: { x: 1000, y: 50 }, kind: 'oneway' }

	it('blocks a sled falling onto it from the front (above)', () => {
		const r = makeRider({ x: 0, y: 0 }) // above the line
		run(r, [oneway], 240)
		expect(r.pos.y).toBeLessThanOrEqual(50)
	})

	it('lets a sled rising from behind (below) pass through', () => {
		const r = makeRider({ x: 0, y: 100 }) // below the line
		r.prev = { x: 0, y: 110 } // moving upward toward the line
		run(r, [oneway], 10)
		// It should not be stopped at the line; gravity may slow it, but the line
		// must not have pushed it back below where a solid line would trap it.
		expect(r.pos.y).toBeLessThan(100)
	})
})
