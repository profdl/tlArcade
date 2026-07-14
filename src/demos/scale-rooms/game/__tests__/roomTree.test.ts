/**
 * ROOM TREE tests — the pure nesting geometry + budgeted tree generation.
 * Covers the size-chart ratio, containment, placement modes, colour cycle, the budget/
 * depth caps, varied branch depths, and seeded determinism.
 */
import { describe, it, expect } from 'vitest'
import { connectionEdge, generateWorld, type RoomNode } from '../roomTree'
import { countRooms } from '../validateWorld'
import { CHILDREN_MAX, colorForDepth, MAX_DEPTH, ROOM_BUDGET, SCALE_RATIO } from '../constants'
import { STYLES, type WorldStyle } from '../styles'

let idc = 0
const newId = () => `s${idc++}`

function walk<Id>(node: RoomNode<Id>, fn: (n: RoomNode<Id>) => void): void {
	fn(node)
	for (const c of node.children) walk(c, fn)
}

function depths<Id>(root: RoomNode<Id>): number[] {
	const ds: number[] = []
	walk(root, (n) => ds.push(n.depth))
	return ds
}

describe('generateWorld — structure & budget', () => {
	it('caps the tree at ROOM_BUDGET and never exceeds MAX_DEPTH, for many seeds', () => {
		for (let seed = 1; seed <= 60; seed++) {
			const { root, count } = generateWorld(newId, seed, STYLES.mixed)
			expect(count).toBe(countRooms(root))
			expect(count).toBeLessThanOrEqual(ROOM_BUDGET)
			expect(count).toBeGreaterThan(1)
			walk(root, (n) => {
				expect(n.depth).toBeLessThanOrEqual(MAX_DEPTH)
				expect(n.children.length).toBeLessThanOrEqual(CHILDREN_MAX)
			})
		}
	})

	it('produces branches of VARIED depth (not all the same)', () => {
		const { root } = generateWorld(newId, 12345, STYLES.mixed)
		const ds = depths(root)
		const max = Math.max(...ds)
		const distinct = new Set(ds)
		expect(max).toBeGreaterThanOrEqual(3) // at least one deepish branch
		expect(distinct.size).toBeGreaterThanOrEqual(3) // varied, not a single depth
	})

	it('is deterministic for a given seed + style', () => {
		const a = generateWorld(newId, 999, STYLES.mixed)
		const b = generateWorld(newId, 999, STYLES.mixed)
		expect(depths(a.root)).toEqual(depths(b.root))
		expect(a.count).toBe(b.count)
	})
})

describe('generateWorld — per-room invariants', () => {
	const styles: [string, WorldStyle][] = Object.entries(STYLES)
	it('every child is SCALE_RATIO of its parent, square, fully inside, colour-cycled', () => {
		for (const [, style] of styles) {
			const { root } = generateWorld(newId, 7, style)
			expect(root.color).toBe(colorForDepth(0))
			walk(root, (n) => {
				expect(n.color).toBe(colorForDepth(n.depth))
				expect(n.rect.w).toBeCloseTo(n.roomSize, 6)
				for (const c of n.children) {
					expect(c.roomSize).toBeCloseTo(n.roomSize * SCALE_RATIO, 6)
					// fully inside parent
					expect(c.rect.x).toBeGreaterThanOrEqual(n.rect.x - 1e-6)
					expect(c.rect.y).toBeGreaterThanOrEqual(n.rect.y - 1e-6)
					expect(c.rect.x + c.rect.w).toBeLessThanOrEqual(n.rect.x + n.rect.w + 1e-6)
					expect(c.rect.y + c.rect.h).toBeLessThanOrEqual(n.rect.y + n.rect.h + 1e-6)
					// connEdge faces the parent centre
					expect(c.connEdge).toBe(connectionEdge(n.rect, c.rect))
				}
			})
		}
	})

	it('colour cycles every three depths', () => {
		expect(colorForDepth(0)).toBe(colorForDepth(3))
		expect(colorForDepth(1)).toBe(colorForDepth(4))
		expect(colorForDepth(0)).not.toBe(colorForDepth(1))
		expect(colorForDepth(1)).not.toBe(colorForDepth(2))
	})
})

describe('placement modes', () => {
	it('centered: children are concentric with the parent', () => {
		const { root } = generateWorld(newId, 3, STYLES.centered)
		walk(root, (n) => {
			for (const c of n.children) {
				expect(c.rect.x + c.rect.w / 2).toBeCloseTo(n.rect.x + n.rect.w / 2, 6)
				expect(c.rect.y + c.rect.h / 2).toBeCloseTo(n.rect.y + n.rect.h / 2, 6)
			}
		})
	})

	it('corners: each child snaps to a parent corner', () => {
		const { root } = generateWorld(newId, 3, STYLES.corners)
		walk(root, (n) => {
			for (const c of n.children) {
				const atX = Math.abs(c.rect.x - n.rect.x) < 1e-6 || Math.abs(c.rect.x + c.rect.w - (n.rect.x + n.rect.w)) < 1e-6
				const atY = Math.abs(c.rect.y - n.rect.y) < 1e-6 || Math.abs(c.rect.y + c.rect.h - (n.rect.y + n.rect.h)) < 1e-6
				expect(atX && atY).toBe(true)
			}
		})
	})
})
