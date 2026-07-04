/**
 * SNAKE STEERING  (pure roaming math — no editor, no DOM)
 * =======================================================
 * The geometry behind "a snake wandering around the visible view area, turning
 * smoothly and curving away from the edges before it hits them." Kept PURE and
 * separate from the per-frame behaviour (registerCanvasSnake.ts) so it runs under
 * the `yarn test` runner with no editor/DOM (CLAUDE.md house rules + RECIPE step 3).
 *
 * The mirror of creature/registerSwimming's steering, simplified: there is no
 * "tank" — the whole VIEWPORT is the arena, and the snake STEERS (bends its
 * heading) away from the edges rather than bouncing, so the path stays graceful.
 */

/** Shortest signed angular difference a→b, in radians ∈ (−π, π]. */
export function angleDelta(a: number, b: number): number {
	let d = (b - a) % (Math.PI * 2)
	if (d > Math.PI) d -= Math.PI * 2
	if (d < -Math.PI) d += Math.PI * 2
	return d
}

/** A rectangular arena (page space). minX/minY top-left, maxX/maxY bottom-right. */
export interface Arena {
	minX: number
	minY: number
	maxX: number
	maxY: number
}

/**
 * The DESIRED heading this tick = the wander heading, bent away from any edge the
 * snake's nose is approaching. We sum an outward push per near-edge (weighted by how
 * deep into the margin the point is) and, if that push is non-trivial, blend the
 * heading toward the push direction. Margin scales with the arena's smaller side so
 * it feels right at any zoom.
 *
 *   pos       — the snake's nose position (page space)
 *   wander    — its current free-roam heading (radians)
 *   arena     — the viewport box to stay inside
 *   marginFrac— start steering away within this fraction of the smaller side
 *   returns the desired heading (radians) to ease the real heading toward.
 */
export function desiredHeading(
	pos: { x: number; y: number },
	wander: number,
	arena: Arena,
	marginFrac = 0.22
): number {
	const w = arena.maxX - arena.minX
	const h = arena.maxY - arena.minY
	const margin = Math.max(1, Math.min(w, h) * marginFrac)

	// Outward push vector: each edge contributes when within `margin`, strength rising
	// to 1 AT the edge (and clamped beyond it, so a snake nudged outside steers hard back).
	let px = 0
	let py = 0
	const left = pos.x - arena.minX
	const right = arena.maxX - pos.x
	const top = pos.y - arena.minY
	const bottom = arena.maxY - pos.y
	if (left < margin) px += 1 - Math.max(0, left) / margin
	if (right < margin) px -= 1 - Math.max(0, right) / margin
	if (top < margin) py += 1 - Math.max(0, top) / margin
	if (bottom < margin) py -= 1 - Math.max(0, bottom) / margin

	const pushLen = Math.hypot(px, py)
	if (pushLen < 1e-3) return wander // nowhere near an edge → free roam

	// Blend the heading toward the outward push, more firmly the deeper we are. At the
	// very edge (pushLen≈1.4 for a corner) we steer almost entirely outward.
	const pushHeading = Math.atan2(py, px)
	const blend = Math.min(1, pushLen)
	return wander + angleDelta(wander, pushHeading) * blend
}

/**
 * Ease the real heading toward the desired one with a per-ms turn-rate cap, so the
 * snake can never spin instantly — it banks into turns. Returns the new heading.
 *
 *   heading      — current heading (radians)
 *   desired      — the target heading from desiredHeading()
 *   maxTurnPerMs — cap on |Δheading| per millisecond (radians)
 *   dt           — elapsed ms this tick
 */
export function easeHeading(heading: number, desired: number, maxTurnPerMs: number, dt: number): number {
	const want = angleDelta(heading, desired)
	const cap = maxTurnPerMs * dt
	const step = Math.max(-cap, Math.min(cap, want))
	return heading + step
}
