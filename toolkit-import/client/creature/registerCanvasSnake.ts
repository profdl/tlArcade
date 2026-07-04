/**
 * CANVAS SNAKE ROAMING  (whole-shape movement around the view area)
 * =================================================================
 * Steers every `canvasSnake` shape around the VISIBLE viewport: a slow wandering
 * heading that meanders, bent away from the view edges before contact, advancing
 * forward each tick. This is the "moves around the canvas" half of the snake; the
 * BODY undulation lives in client/shapes/CanvasSnakeShape.tsx.
 *
 * NATIVE-FIRST, identical discipline to registerPhysics + registerSwimming:
 *   • Ride tldraw's own `editor.on('tick', elapsedMs => …)` — no separate rAF.
 *   • Move the snake by writing `shape.x/y` (+ `rotation` so it faces where it's
 *     going) DIRECTLY, inside `editor.run(fn, { history: 'ignore' })`. Sync
 *     replicates the positions to every client for free; we sync no per-frame
 *     velocity ourselves (CLAUDE.md gotchas #5 & #7).
 *   • The arena is `editor.getViewportPageBounds()` — the visible view area, in
 *     page space — exactly what the throw-physics walls use.
 *   • Pure steering math (snakeSteering.ts) is split out + unit-tested.
 *
 * OWNERSHIP: client-local, with ONE elected driver per page (lowest user id), the
 * same election registerSwimming uses, so multiple clients don't fight over x/y.
 *
 * NOTE the snake is drawn HEAD-RIGHT (forward = +x in its local box), so the
 * rotation that points the head along the heading is simply `heading`.
 *
 * Mount once from <Tldraw onMount> alongside the other behaviours; returns a disposer.
 */
import { Editor, TLShapeId } from 'tldraw'
import type { CanvasSnakeShape } from '../shapes/CanvasSnakeShape'
import { desiredHeading, easeHeading } from './snakeSteering'

/** Forward speed in page px/ms at `speed = 1`. The shape's `props.speed` scales it. */
const BASE_SPEED = 0.16
/** Turn-rate cap (radians/ms) so the snake banks into curves instead of snapping. */
const MAX_TURN_PER_MS = 0.004
/** Wander: how fast the free-roam heading drifts (radians/ms) and its swing amplitude. */
const WANDER_DRIFT = 0.0009
const WANDER_AMPLITUDE = 0.6
/** Cap dt so a tab-switch stall can't teleport the snake across the page. */
const MAX_DT = 64

interface SnakeState {
	/** Free-roam heading (radians) before edge-steering — meanders via the wander phase. */
	wander: number
	/** The actual heading the body travels along (eased toward the steered desired heading). */
	heading: number
	/** Phase of the slow meander that nudges `wander`. Seeded so snakes desync. */
	wanderPhase: number
}

export function registerCanvasSnake(editor: Editor): () => void {
	let busy = false
	const states = new Map<TLShapeId, SnakeState>()

	const onTick = (elapsedMs: number) => {
		if (busy || elapsedMs <= 0) return
		// Only the elected lead drives motion; everyone else renders synced positions.
		if (!ownsSnakeLead(editor)) return
		// Don't fight a live drag: if the user is pointing, hold still this frame.
		if (editor.inputs.getIsPointing()) return

		const ids = editor.getCurrentPageShapeIds()
		const dt = Math.min(elapsedMs, MAX_DT)
		const arena = editor.getViewportPageBounds()

		busy = true
		try {
			editor.run(() => {
				for (const id of ids) {
					const shape = editor.getShape(id) as CanvasSnakeShape | undefined
					if (!shape || shape.type !== 'canvasSnake') continue
					// A snake the user is dragging is selected + being translated — leave it.
					if (editor.isShapeOrAncestorLocked(id)) continue

					const bounds = editor.getShapePageBounds(id)
					if (!bounds) continue
					const speed = Math.max(0, shape.props.speed)
					if (speed === 0) continue

					// Lazily seed per-snake state from its synced seed, so the wander is stable.
					let s = states.get(id)
					if (!s) {
						const seed = shape.props.seed
						const h0 = (seed % 1000) / 1000 * Math.PI * 2 // deterministic start heading
						s = { wander: h0, heading: h0, wanderPhase: (seed % 997) }
						states.set(id, s)
					}

					// 1. MEANDER the free-roam heading: a slow seeded sine drift.
					s.wanderPhase += WANDER_DRIFT * dt
					s.wander += Math.sin(s.wanderPhase) * WANDER_DRIFT * WANDER_AMPLITUDE * dt

					// 2. STEER away from the view edges, then ease the real heading toward it.
					const nose = bounds.center
					const desired = desiredHeading(nose, s.wander, arena)
					s.heading = easeHeading(s.heading, desired, MAX_TURN_PER_MS, dt)

					// 3. ADVANCE along the heading. Write top-left x/y + rotation (head-right,
					//    so rotation = heading). Positions sync to everyone for free.
					const dist = BASE_SPEED * speed * dt
					const nx = shape.x + Math.cos(s.heading) * dist
					const ny = shape.y + Math.sin(s.heading) * dist
					editor.updateShape<CanvasSnakeShape>({ id, type: shape.type, x: nx, y: ny, rotation: s.heading })
				}
			}, { history: 'ignore' })
		} finally {
			busy = false
		}

		// Drop state for snakes that vanished, so the map can't grow unbounded.
		if (states.size > 0) {
			for (const id of states.keys()) if (!ids.has(id)) states.delete(id)
		}
	}

	editor.on('tick', onTick)
	return () => {
		editor.off('tick', onTick)
		states.clear()
	}
}

/**
 * ONE driver per page: the connected client with the lowest user id. Mirrors
 * registerSwimming's ownsSwimmingLead so the two motion systems agree on who leads
 * and clients never fight over a shape's x/y. Uses collaborators ON THE CURRENT PAGE
 * so a peer viewing another page can't win and then drive nothing.
 */
function ownsSnakeLead(editor: Editor): boolean {
	const me = editor.user.getId()
	const others = editor.getCollaboratorsOnCurrentPage().map((c) => c.userId)
	if (others.length === 0) return true
	const all = [me, ...others].sort()
	return all[0] === me
}
