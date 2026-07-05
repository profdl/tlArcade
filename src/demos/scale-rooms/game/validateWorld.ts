/**
 * VALIDATE WORLD — pure invariant checker for a generated room tree.
 * ===================================================================
 * The game generates a NEW world every start (random seed), so the geometry guarantees
 * can't be eyeballed once and trusted — they must hold for ANY seed, at EVERY depth. This
 * states the invariants as code and applies them to every parent→child edge in the tree:
 *
 *   1. A child's side is exactly its parent's × SCALE_RATIO (the size-chart ratio).
 *   2. A child is fully INSIDE its parent's square (so its doorway lands on parent floor).
 *   3. A child's colour matches colorForDepth(depth) (the 3-cycle from the chart).
 *   4. A child's connEdge faces its parent's centre (connectionEdge), and is non-null.
 *   5. The parent has exactly one 'in' doorway per child, keyed to that child.
 *   6. A non-root room has exactly one 'out' doorway; the root has none.
 *   7. Depth never exceeds MAX_DEPTH.
 *
 * PURE — no editor, no DOM. Used two ways: a big seed-sweep in tests, and a dev-only
 * runtime assertion in gameLoop.ts so a violated invariant is loud immediately.
 */
import { colorForDepth, MAX_DEPTH, SCALE_RATIO } from './constants.ts'
import { connectionEdge, connectorDoor, type PageRect, type RoomNode } from './roomTree.ts'

/** Relative tolerance — room sides span 16000→~90 px, so an absolute EPS won't do. */
const REL_EPS = 1e-6

function approxEq(a: number, b: number): boolean {
	return Math.abs(a - b) <= REL_EPS * Math.max(1, Math.abs(a), Math.abs(b))
}

/** True when `c` is fully contained in `p` (small negative slack tolerated). */
function contains(p: PageRect, c: PageRect): boolean {
	const slack = REL_EPS * Math.max(1, p.w)
	return c.x >= p.x - slack && c.y >= p.y - slack && c.x + c.w <= p.x + p.w + slack && c.y + c.h <= p.y + p.h + slack
}

function overlaps(a: PageRect, b: PageRect): boolean {
	return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

/** Total rooms in the tree (for the budget assertion). */
export function countRooms<Id>(node: RoomNode<Id>): number {
	return 1 + node.children.reduce((n, c) => n + countRooms(c), 0)
}

/** Check every invariant for ONE room and its direct children; recurse. Returns human-
 *  readable violations (empty = valid). `label` traces the path from the root. */
function validateNode<Id>(node: RoomNode<Id>, label: string): string[] {
	const violations: string[] = []

	if (node.depth > MAX_DEPTH) violations.push(`${label}: depth ${node.depth} exceeds MAX_DEPTH ${MAX_DEPTH}`)
	if (node.color !== colorForDepth(node.depth)) {
		violations.push(`${label}: colour ${node.color} != colorForDepth(${node.depth}) ${colorForDepth(node.depth)}`)
	}

	// 6. Out doorway: exactly one for non-root, none for root — and it must be REACHABLE, i.e.
	//    no child of this room covers the exit doorway (else the level would be a trap).
	const outs = node.layout.portals.filter((p) => p.kind === 'out')
	const expectedOut = node.connEdge ? 1 : 0
	if (outs.length !== expectedOut) violations.push(`${label}: ${outs.length} OUT doorways, expected ${expectedOut}`)
	if (node.connEdge && outs[0] && outs[0].edge !== node.connEdge) {
		violations.push(`${label}: OUT doorway edge ${outs[0].edge} != connEdge ${node.connEdge}`)
	}
	if (node.connEdge) {
		const exit = connectorDoor(node.rect, node.connEdge, node.roomSize)
		for (const child of node.children) {
			if (overlaps(child.rect, exit)) violations.push(`${label}: child ${child.key} blocks the exit doorway`)
		}
	}

	// 5. One in-doorway per child, keyed to that child.
	const ins = node.layout.portals.filter((p) => p.kind === 'in')
	if (ins.length !== node.children.length) {
		violations.push(`${label}: ${ins.length} IN doorways but ${node.children.length} children`)
	}

	for (const child of node.children) {
		const at = `${label}/${child.key}`
		// 1. Side ratio.
		if (!approxEq(child.roomSize, node.roomSize * SCALE_RATIO)) {
			violations.push(`${at}: side ${child.roomSize} != parent ${node.roomSize} × ${SCALE_RATIO}`)
		}
		if (!approxEq(child.rect.w, child.roomSize) || !approxEq(child.rect.h, child.roomSize)) {
			violations.push(`${at}: rect ${child.rect.w}x${child.rect.h} != square ${child.roomSize}`)
		}
		// 2. Containment.
		if (!contains(node.rect, child.rect)) violations.push(`${at}: child not fully inside parent`)
		// 4. Connection edge faces parent centre.
		if (!child.connEdge) violations.push(`${at}: child has null connEdge`)
		else if (child.connEdge !== connectionEdge(node.rect, child.rect)) {
			violations.push(`${at}: connEdge ${child.connEdge} != facing edge ${connectionEdge(node.rect, child.rect)}`)
		}
		// 5. Parent has a matching in-doorway.
		if (!ins.some((p) => p.childKey === child.key)) violations.push(`${at}: no IN doorway keyed to this child`)
	}

	for (const child of node.children) violations.push(...validateNode(child, `${label}/${child.key}`))
	return violations
}

/** Recursively validate the whole room tree from the root. */
export function validateWorldTree<Id>(root: RoomNode<Id>): string[] {
	if (root.connEdge !== null) return [`root: connEdge should be null, got ${root.connEdge}`]
	return validateNode(root, 'root')
}
