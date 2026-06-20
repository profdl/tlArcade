import { describe, it, expect } from 'vitest'
import { pointInCheckpoint, collectCheckpointHits, type Checkpoint } from './checkpoints'

// Build an axis-aligned checkpoint from min/max corners (rotation 0).
const box = (id: string, minX: number, minY: number, maxX: number, maxY: number): Checkpoint => ({
	id,
	cx: (minX + maxX) / 2,
	cy: (minY + maxY) / 2,
	halfW: (maxX - minX) / 2,
	halfH: (maxY - minY) / 2,
	rotation: 0,
})

describe('checkpoints: pointInCheckpoint', () => {
	const c = box('a', 0, 0, 10, 10)

	it('is inside for a point within the box', () => {
		expect(pointInCheckpoint({ x: 5, y: 5 }, c)).toBe(true)
	})

	it('includes the boundary', () => {
		expect(pointInCheckpoint({ x: 0, y: 10 }, c)).toBe(true)
	})

	it('is outside beyond the box', () => {
		expect(pointInCheckpoint({ x: 11, y: 5 }, c)).toBe(false)
	})
})

describe('checkpoints: rotated boxes', () => {
	// A 20x20 box centered at the origin, rotated 45°. Its corners reach out to
	// ~±14.1 along the axes (half-diagonal = 10*sqrt(2)), but the box's own
	// footprint near an axis corner is empty — an axis-aligned test would wrongly
	// score there.
	const rotated: Checkpoint = { id: 'r', cx: 0, cy: 0, halfW: 10, halfH: 10, rotation: Math.PI / 4 }

	it('scores a point at the rotated box center', () => {
		expect(pointInCheckpoint({ x: 0, y: 0 }, rotated)).toBe(true)
	})

	it('scores a point along the rotated diagonal (a real corner)', () => {
		// The +x axis is a diagonal of the rotated box; its corner sits at ~14.1.
		expect(pointInCheckpoint({ x: 13, y: 0 }, rotated)).toBe(true)
	})

	it('does NOT score a point that only an axis-aligned bbox would catch', () => {
		// (9.5, 9.5) is inside the 45°-rotated box's AABB (which spans ±14.1) but
		// outside the box itself — distance along each box axis exceeds 10.
		expect(pointInCheckpoint({ x: 9.5, y: 9.5 }, rotated)).toBe(false)
	})
})

describe('checkpoints: collectCheckpointHits', () => {
	const checkpoints = [box('a', 0, 0, 10, 10), box('b', 100, 0, 110, 10)]

	it('scores a checkpoint the first time the sled enters it', () => {
		const collected = new Set<string>()
		const hits = collectCheckpointHits({ x: 5, y: 5 }, checkpoints, collected)
		expect(hits).toEqual(['a'])
		expect(collected.has('a')).toBe(true)
	})

	it('does not re-score an already-collected checkpoint', () => {
		const collected = new Set<string>(['a'])
		const hits = collectCheckpointHits({ x: 5, y: 5 }, checkpoints, collected)
		expect(hits).toEqual([])
	})

	it('scores nothing when the sled is outside every checkpoint', () => {
		const collected = new Set<string>()
		const hits = collectCheckpointHits({ x: 50, y: 50 }, checkpoints, collected)
		expect(hits).toEqual([])
		expect(collected.size).toBe(0)
	})

	it('accumulates distinct checkpoints across successive positions', () => {
		const collected = new Set<string>()
		collectCheckpointHits({ x: 5, y: 5 }, checkpoints, collected)
		collectCheckpointHits({ x: 105, y: 5 }, checkpoints, collected)
		expect(collected.size).toBe(2)
	})
})
