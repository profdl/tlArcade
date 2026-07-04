/**
 * VALIDATE WORLD — pure invariant checker for a generated world + its nested tree.
 * ==============================================================================
 * The game generates a NEW world every start (random seed) and nests it several
 * scales deep, so the connection guarantees can't be eyeballed once and trusted
 * forever — they must be checkable for ANY seed, at EVERY depth. This module states
 * the invariants as code and applies them to every host→child edge in the tree:
 *
 *   1. Every submap is reachable (≥1 tunnel/door direction).
 *   2. Its child has EXACTLY one gate per tunnel direction (same set, no extras).
 *   3. Every gate sits on the edge-MIDDLE cell of its edge — the tunnel centreline —
 *      so the gate meets the tunnel mouth (gate cells are prune-protected upstream).
 *   4. Every gate rect STRICTLY overlaps a HOST tunnel rect (the visual/physical
 *      "portal connects to tunnel" guarantee; tunnels poke into the slot).
 *   5. Gate cells are distinct.
 *   6. The child map's extent exactly fills its slot.
 *   7. Portal-doorways line up: the host has one 'in' doorway per submap tunnel, and
 *      each child has one 'out' doorway per gate edge (the dive triggers).
 *
 * These hold at every scale: a depth-1 map is validated against the root's tunnels,
 * a depth-2 map against the depth-1 map's tunnels, and so on — recursively.
 *
 * Used two ways: a big seed-sweep in tests (mapGeometry.test.ts), and a dev-only
 * runtime assertion in gameLoop.ts so a violated invariant is loud immediately.
 * PURE — no editor, no DOM.
 */
import { edgeMiddleCell, type MapLayout, type PageRect, type SubmapInfo } from './mapGeometry.ts'

/**
 * One node of the nested world: a host submap, the child map generated in its slot,
 * and that child's OWN children (its submaps' maps), recursively. Leaf maps (deepest
 * scale) have `children: []`.
 */
export type WorldNode<Id> = { submap: SubmapInfo; layout: MapLayout<Id>; children: WorldNode<Id>[] }

const EPS = 0.001

function overlaps(a: PageRect, b: PageRect): boolean {
	return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

/**
 * Check every invariant for ONE host→children edge (a host map and the children nested
 * in its submap slots). Returns human-readable violations (empty = valid).
 * `childGrid` is the child maps' grid size (needed to locate edge-middles).
 */
function validateHost<Id>(
	host: MapLayout<Id>,
	children: WorldNode<Id>[],
	childGrid: { w: number; h: number },
	label: string
): string[] {
	const violations: string[] = []
	const tunnels = host.rects.filter((r) => r.kind === 'door')

	if (children.length !== host.submaps.length) {
		violations.push(`${label}: host has ${host.submaps.length} submaps but ${children.length} children`)
	}

	// 7a. Host: one 'in' portal-doorway per submap tunnel direction (the dive-in trigger).
	const hostIn = host.portals.filter((p) => p.kind === 'in').length
	const expectedIn = host.submaps.reduce((n, s) => n + s.doorDirs.length, 0)
	if (hostIn !== expectedIn) {
		violations.push(`${label}: host has ${hostIn} IN doorways, expected ${expectedIn} (one per submap tunnel)`)
	}

	for (const { submap, layout } of children) {
		const at = `${label}/submap(${submap.cell.x},${submap.cell.y})`

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

		// 4. Every gate rect strictly overlaps a host tunnel rect.
		for (const g of layout.gates) {
			if (!tunnels.some((t) => overlaps(g.rect, t))) {
				violations.push(`${at}: ${g.edge} gate does not touch any tunnel`)
			}
		}

		// 5. Distinct gate cells.
		const cells = new Set(layout.gates.map((g) => `${g.cell.x},${g.cell.y}`))
		if (cells.size !== layout.gates.length) violations.push(`${at}: gate cells not distinct`)

		// 7b. Child: one 'out' portal-doorway per gate edge (the dive-out trigger).
		const outEdges = layout.portals.filter((p) => p.kind === 'out').map((p) => p.dir).sort()
		if (outEdges.join(',') !== gateEdges.join(',')) {
			violations.push(`${at}: OUT doorways [${outEdges}] don't match gates [${gateEdges}]`)
		}

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

/**
 * Recursively validate the whole nested world: the root's children, then each of THEIR
 * children, at every depth. `childGrid` is the (uniform) nested-map grid size.
 */
export function validateWorldTree<Id>(
	root: MapLayout<Id>,
	tree: WorldNode<Id>[],
	childGrid: { w: number; h: number },
	label = 'root'
): string[] {
	const violations = validateHost(root, tree, childGrid, label)
	for (const node of tree) {
		// A leaf (no children) is a valid stopping point; a host node recurses.
		const childLabel = `${label}/submap(${node.submap.cell.x},${node.submap.cell.y})`
		violations.push(...validateWorldTree(node.layout, node.children, childGrid, childLabel))
	}
	return violations
}
