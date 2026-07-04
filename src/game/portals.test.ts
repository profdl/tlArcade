import { describe, it, expect } from 'vitest'
import { pointInMouth, teleportBody, splitBody, type Portal, type PortalMouth, type Multiplier } from './portals'
import { makeBody, bodyCenter, bodyVelocity, BACK, FRONT } from './physics'

const DT = 1 / 120

/** Give every body point a uniform velocity (px/s) via its Verlet prev. */
function setBodyVelocity(body: ReturnType<typeof makeBody>, vx: number, vy: number): void {
	for (const p of body.points) {
		p.prev.x = p.pos.x - vx * DT
		p.prev.y = p.pos.y - vy * DT
	}
}

const mouth = (over: Partial<PortalMouth> = {}): PortalMouth => ({
	cx: 0,
	cy: 0,
	halfW: 50,
	halfH: 50,
	rotation: 0,
	...over,
})

describe('pointInMouth', () => {
	it('is inside at the center and outside beyond the half-extents', () => {
		const m = mouth()
		expect(pointInMouth({ x: 0, y: 0 }, m)).toBe(true)
		expect(pointInMouth({ x: 49, y: -49 }, m)).toBe(true)
		expect(pointInMouth({ x: 51, y: 0 }, m)).toBe(false)
		expect(pointInMouth({ x: 0, y: 51 }, m)).toBe(false)
	})

	it('respects rotation (a 45° box catches along its own axes)', () => {
		const m = mouth({ halfW: 10, halfH: 10, rotation: Math.PI / 4 })
		// (0,13) lies outside an axis-aligned 10×10 box (|y|>10) but inside the
		// 45°-rotated one — its local coords are ~(9.2, 9.2), within the half-extents.
		expect(pointInMouth({ x: 0, y: 13 }, m)).toBe(true)
		expect(pointInMouth({ x: 0, y: 13 }, mouth({ halfW: 10, halfH: 10, rotation: 0 }))).toBe(false)
		// Truly beyond the rotated box's reach.
		expect(pointInMouth({ x: 0, y: 15 }, m)).toBe(false)
	})
})

describe('teleportBody', () => {
	const straight: Portal = {
		id: 'p',
		entrance: mouth({ cx: 0, cy: 0 }),
		exit: mouth({ cx: 300, cy: -100 }),
		scale: 1,
	}

	it('lands the body center exactly on exit.center and preserves velocity when rotations match', () => {
		const body = makeBody({ x: 0, y: 0 })
		setBodyVelocity(body, 200, 50)
		const before = bodyCenter(body)
		teleportBody(body, straight, before)
		const after = bodyCenter(body)
		expect(after.x).toBeCloseTo(straight.exit.cx, 5)
		expect(after.y).toBeCloseTo(straight.exit.cy, 5)
		const v = bodyVelocity(body, DT)
		expect(v.x).toBeCloseTo(200, 3)
		expect(v.y).toBeCloseTo(50, 3)
	})

	it('rotates the velocity by (exit.rotation - entrance.rotation), preserving speed', () => {
		const rotated: Portal = {
			id: 'p',
			entrance: mouth({ cx: 0, cy: 0, rotation: 0 }),
			exit: mouth({ cx: 300, cy: 0, rotation: Math.PI / 2 }),
			scale: 1,
		}
		const body = makeBody({ x: 0, y: 0 })
		setBodyVelocity(body, 100, 0) // moving +x
		teleportBody(body, rotated, bodyCenter(body))
		const v = bodyVelocity(body, DT)
		// +90° rotation of (100,0) in screen coords (y down) is (0,100).
		expect(v.x).toBeCloseTo(0, 3)
		expect(v.y).toBeCloseTo(100, 3)
		expect(Math.hypot(v.x, v.y)).toBeCloseTo(100, 3) // speed preserved
	})

	it('is rigid: the runner length is unchanged through the teleport', () => {
		const body = makeBody({ x: 10, y: 20 })
		const runnerLen = (b: typeof body) =>
			Math.hypot(b.points[FRONT].pos.x - b.points[BACK].pos.x, b.points[FRONT].pos.y - b.points[BACK].pos.y)
		const before = runnerLen(body)
		teleportBody(
			body,
			{ id: 'p', entrance: mouth(), exit: mouth({ cx: 400, rotation: 1.1 }), scale: 1 },
			bodyCenter(body),
		)
		expect(runnerLen(body)).toBeCloseTo(before, 6)
	})

	it('lands exactly on exit.center regardless of where inside the entrance box the crossing was detected', () => {
		// A fast body can be caught anywhere inside the entrance mouth, not just at
		// its boundary (see runController.stepFixed) — simulate that by teleporting
		// from a point deep in one corner of the entrance box instead of its center.
		const cornerEntry = { x: 45, y: -45 } // near a corner of the default 50x50 half-extent mouth
		const portal: Portal = {
			id: 'p',
			entrance: mouth({ cx: 0, cy: 0 }),
			exit: mouth({ cx: 300, cy: -100 }),
			scale: 1,
		}
		const body = makeBody(cornerEntry)
		teleportBody(body, portal, bodyCenter(body))
		const after = bodyCenter(body)
		expect(after.x).toBeCloseTo(portal.exit.cx, 5)
		expect(after.y).toBeCloseTo(portal.exit.cy, 5)
	})
})

describe('splitBody', () => {
	const multiplier: Multiplier = {
		id: 'm',
		entrance: mouth({ cx: 0, cy: 0 }),
		exits: [mouth({ cx: 300, cy: -100 }), mouth({ cx: -200, cy: 400, rotation: Math.PI / 2 })],
	}

	it('sends the original body out exits[0] and a clone out exits[1], each exactly on its own center', () => {
		const body = makeBody({ x: 0, y: 0 })
		setBodyVelocity(body, 200, 50)
		const origin = bodyCenter(body)
		const [first, second] = splitBody(body, multiplier, origin)
		expect(first).toBe(body) // the original is mutated in place, like teleportBody

		const firstCenter = bodyCenter(first)
		expect(firstCenter.x).toBeCloseTo(multiplier.exits[0].cx, 5)
		expect(firstCenter.y).toBeCloseTo(multiplier.exits[0].cy, 5)
		const firstV = bodyVelocity(first, DT)
		expect(firstV.x).toBeCloseTo(200, 3)
		expect(firstV.y).toBeCloseTo(50, 3)

		const secondCenter = bodyCenter(second)
		expect(secondCenter.x).toBeCloseTo(multiplier.exits[1].cx, 5)
		expect(secondCenter.y).toBeCloseTo(multiplier.exits[1].cy, 5)
		// exits[1] is rotated 90° from the (unrotated) entrance, so its velocity
		// rotates too, same as a regular portal's exit rotation.
		const secondV = bodyVelocity(second, DT)
		expect(secondV.x).toBeCloseTo(-50, 3)
		expect(secondV.y).toBeCloseTo(200, 3)
	})

	it('the clone is independent: mutating one half never touches the other', () => {
		const body = makeBody({ x: 0, y: 0 })
		const [first, second] = splitBody(body, multiplier, bodyCenter(body))
		second.points[BACK].pos.x += 9999
		second.crashed = true
		expect(first.points[BACK].pos.x).not.toBeCloseTo(second.points[BACK].pos.x, 0)
		expect(first.crashed).toBe(false)
	})

	it('is rigid: both halves keep the original runner length', () => {
		const body = makeBody({ x: 10, y: 20 })
		const runnerLen = (b: ReturnType<typeof makeBody>) =>
			Math.hypot(b.points[FRONT].pos.x - b.points[BACK].pos.x, b.points[FRONT].pos.y - b.points[BACK].pos.y)
		const before = runnerLen(body)
		const [first, second] = splitBody(body, multiplier, bodyCenter(body))
		expect(runnerLen(first)).toBeCloseTo(before, 6)
		expect(runnerLen(second)).toBeCloseTo(before, 6)
	})
})
