/**
 * validateWorld tests — the recursive geometry invariants, swept across many seeds.
 * A deliberately-broken DEEP node must be caught, so the recursion isn't vacuously green.
 */
import { describe, it, expect } from 'vitest'
import { connectorDoor, generateWorld, type RoomNode } from '../roomTree'
import { validateWorldTree } from '../validateWorld'
import { ROOM_BUDGET } from '../constants'
import { STYLES } from '../styles'

let idc = 0
const newId = () => `s${idc++}`

/** The deepest node in the tree (ties broken by traversal order). */
function deepestNode<Id>(root: RoomNode<Id>): RoomNode<Id> {
	let found: RoomNode<Id> = root
	const walk = (n: RoomNode<Id>) => {
		if (n.depth > found.depth) found = n
		for (const c of n.children) walk(c)
	}
	walk(root)
	return found
}

describe('validateWorldTree', () => {
	it('reports NO violations for every style across 100 seeds', () => {
		for (const [, style] of Object.entries(STYLES)) {
			for (let seed = 1; seed <= 100; seed++) {
				const { root, count } = generateWorld(newId, seed, style)
				const violations = validateWorldTree(root)
				expect(violations).toEqual([])
				expect(count).toBeLessThanOrEqual(ROOM_BUDGET)
			}
		}
	})

	it('catches a broken COLOUR at a deep node (recursion is not vacuous)', () => {
		const { root } = generateWorld(newId, 42, STYLES.mixed)
		const target = deepestNode(root)
		expect(target.depth).toBeGreaterThanOrEqual(2)
		target.color = 'green' // wrong for its depth
		const violations = validateWorldTree(root)
		expect(violations.some((v) => v.includes('colour') && v.includes(target.key))).toBe(true)
	})

	it('catches a child that blocks its parent’s exit doorway', () => {
		const { root } = generateWorld(newId, 5, STYLES.corners)
		// A non-root room that has children (so it has both an exit AND something to block it).
		let target: RoomNode<string> | null = null
		const walk = (n: RoomNode<string>) => {
			if (!target && n.connEdge && n.children.length > 0) target = n
			n.children.forEach(walk)
		}
		walk(root)
		expect(target).toBeTruthy()
		const t = target as unknown as RoomNode<string>
		// Slam a child on top of the room's own exit doorway.
		t.children[0].rect = { ...connectorDoor(t.rect, t.connEdge!, t.roomSize) }
		expect(validateWorldTree(root).some((v) => v.includes('blocks the exit doorway'))).toBe(true)
	})

	it('catches a child pushed OUTSIDE its parent', () => {
		const { root } = generateWorld(newId, 77, STYLES.centered)
		// Move a top-level child far outside the root.
		const child = root.children[0]
		child.rect = { ...child.rect, x: root.rect.x + root.rect.w + 500 }
		const violations = validateWorldTree(root)
		expect(violations.some((v) => v.includes('not fully inside parent'))).toBe(true)
	})
})
