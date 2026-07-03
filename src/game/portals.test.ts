import { describe, it, expect } from 'vitest'
import { pointInMouth, teleportBody, type Portal, type PortalMouth } from './portals'
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

	it('translates the rig by (exit - entrance) and preserves velocity when rotations match', () => {
		const body = makeBody({ x: 0, y: 0 })
		setBodyVelocity(body, 200, 50)
		const before = bodyCenter(body)
		teleportBody(body, straight)
		const after = bodyCenter(body)
		expect(after.x - before.x).toBeCloseTo(300, 5)
		expect(after.y - before.y).toBeCloseTo(-100, 5)
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
		teleportBody(body, rotated)
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
		teleportBody(body, { id: 'p', entrance: mouth(), exit: mouth({ cx: 400, rotation: 1.1 }), scale: 1 })
		expect(runnerLen(body)).toBeCloseTo(before, 6)
	})
})
