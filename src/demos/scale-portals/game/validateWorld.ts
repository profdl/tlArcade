/**
 * VALIDATE WORLD — pure invariant checker for a generated world + its children.
 * ==============================================================================
 * The game generates a NEW world every start (random seed), so the connection
 * guarantees can't be eyeballed once and trusted forever — they must be checkable
 * for ANY seed. This module states the invariants as code:
 *
 *   1. Every submap is reachable (≥1 tunnel/door direction).
 *   2. Its child has EXACTLY one gate per tunnel direction (same set, no extras).
 *   3. Every gate sits on the edge-MIDDLE cell of its edge — the tunnel centreline —
 *      so the gate meets the tunnel mouth (gate cells are prune-protected upstream).
 *   4. Every gate rect STRICTLY overlaps a parent tunnel rect (the visual/physical
 *      "portal connects to tunnel" guarantee; tunnels poke SLOT_POKE into the slot).
 *   5. Gate cells are distinct.
 *   6. The child map's extent exactly fills its slot.
 *
 * Used two ways: a big seed-sweep in tests (mapGeometry.test.ts), and a dev-only
 * runtime assertion in gameLoop.ts so a violated invariant is loud immediately.
 * PURE — no editor, no DOM.
 */
import { edgeMiddleCell, type MapLayout, type PageRect, type SubmapInfo } from './mapGeometry.ts'

/** One submap's generated child, paired with the parent's record of that submap. */
export type WorldChild<Id> = { submap: SubmapInfo; layout: MapLayout<Id> }

const EPS = 0.001

function overlaps(a: PageRect, b: PageRect): boolean {
	return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

/**
 * Check every world invariant; returns human-readable violations (empty = valid).
 * `childGrid` is the child maps' grid size (needed to locate edge-middles).
 */
export function validateWorld<Id>(
	parent: MapLayout<Id>,
	children: WorldChild<Id>[],
	childGrid: { w: number; h: number }
): string[] {
	const violations: string[] = []
	const tunnels = parent.rects.filter((r) => r.kind === 'door')

	if (children.length !== parent.submaps.length) {
		violations.push(`world has ${parent.submaps.length} submaps but ${children.length} children`)
	}

	for (const { submap, layout } of children) {
		const at = `submap(${submap.cell.x},${submap.cell.y})`

		// 1. Reachable.
		if (submap.doorDirs.length === 0) violations.push(`${at}: no tunnel reaches it`)

		// 2. One gate per tunnel direction, same set.
		const gateEdges = layout.gates.map((g) => g.edge).sort()
		const doorDirs = [...submap.doorDirs].sort()
		if (gateEdges.join(',') !== doorDirs.join(',')) {
			violations.push(`${at}: gates [${gateEdges}] don't match tunnels [${doorDirs}]`)
		}

		// 3. Gates on edge-middle cells (tunnel centrelines).
		for (const g of layout.gates) {
			const want = edgeMiddleCell(childGrid.w, childGrid.h, g.edge)
			if (g.cell.x !== want.x || g.cell.y !== want.y) {
				violations.push(`${at}: ${g.edge} gate at (${g.cell.x},${g.cell.y}), expected edge-middle (${want.x},${want.y})`)
			}
		}

		// 4. Every gate rect strictly overlaps a parent tunnel rect.
		for (const g of layout.gates) {
			if (!tunnels.some((t) => overlaps(g.rect, t))) {
				violations.push(`${at}: ${g.edge} gate does not touch any tunnel`)
			}
		}

		// 5. Distinct gate cells.
		const cells = new Set(layout.gates.map((g) => `${g.cell.x},${g.cell.y}`))
		if (cells.size !== layout.gates.length) violations.push(`${at}: gate cells not distinct`)

		// 6. Child extent exactly fills the slot.
		if (
			Math.abs(layout.extent.w - submap.slotRect.w) > EPS ||
			Math.abs(layout.extent.h - submap.slotRect.h) > EPS
		) {
			violations.push(
				`${at}: child extent ${layout.extent.w}x${layout.extent.h} != slot ${submap.slotRect.w}x${submap.slotRect.h}`
			)
		}
	}

	return violations
}
