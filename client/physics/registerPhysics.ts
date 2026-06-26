/**
 * THROW / INERTIA PHYSICS  (prototype)
 * ====================================
 * "Flick a shape and let it glide." Native physics for tldraw v5 shapes — no
 * overlay, no extra DOM. We read and write `shape.x/y` directly, exactly like the
 * containment + snapping behaviours do, so motion syncs to other clients for free
 * (store writes replicate like a normal drag).
 *
 * Behaviour:
 *   • inertia (a thrown shape keeps the drag's velocity and decelerates), plus
 *   • wall bounce off the visible viewport edges (no shape-to-shape collisions,
 *     no gravity),
 *   • client-LOCAL: the client doing the flick runs the loop and writes positions;
 *     sync carries them to everyone else.
 *
 * NATIVE-FIRST (why this file is so small):
 *   • We do NOT estimate velocity ourselves — tldraw already maintains a smoothed
 *     pointer velocity, `editor.getPointerVelocity()` (screen px/ms). We read it at
 *     the moment of the drop. That deletes a whole `registerAfterChangeHandler`
 *     velocity-estimator AND is more correct: it's frame-rate-independent and we
 *     convert it through `getZoomLevel()` so a flick feels the same at any zoom.
 *   • We do NOT run our own requestAnimationFrame loop — tldraw already ticks every
 *     frame and emits `editor.on('tick', elapsedMs => …)`. We just listen. The tick
 *     fires regardless of us, so we early-return cheaply when nothing is moving.
 *
 * Velocities are stored in PAGE space, as px-per-millisecond, so each tick's
 * displacement is `v * elapsedMs` and friction is a per-ms decay — all independent
 * of frame rate.
 *
 * Writes go inside `editor.run(fn, { history: 'ignore' })` so motion doesn't pollute
 * undo; a `busy` flag keeps our writes from being mistaken for a user drag.
 *
 * Mount once from <Tldraw onMount> alongside the others; it returns a disposer.
 */
import { Editor, TLShapeId, Vec } from 'tldraw'
import { GridShape } from '../shapes/GridShape'

/** Friction as velocity retained per millisecond (≈0.993/ms ≈ 0.9 per 16ms frame). */
const FRICTION_PER_MS = 0.993
/** Below this speed (page px/ms) a shape is considered stopped. */
const STOP_SPEED = 0.01
/** Cap the launch speed (page px/ms) so a jittery release can't fling a shape away. */
const MAX_SPEED = 4
/** Wall bounce energy kept on impact (1 = perfectly elastic, 0 = dead stop). */
const RESTITUTION = 0.7

export function registerPhysics(editor: Editor): () => void {
	let busy = false
	// Shapes currently in flight, with their decaying page-space velocity (px/ms).
	const moving = new Map<TLShapeId, Vec>()

	// ── LAUNCH ON DROP ────────────────────────────────────────────────────────
	// We launch ONLY on the falling edge of `select.translating` — i.e. the single
	// moment a real drag of shapes ends. We must NOT launch on any other completed
	// operation (a click-select, a brush/marquee, a paste, our own tick writes…):
	// doing so reads pointer velocity at the wrong time and starts mutating shapes
	// underneath a live gesture, which breaks hit-testing and the pointer-up release.
	// `wasTranslating` remembers the previous op's state so we fire exactly once.
	let wasTranslating = false
	const offComplete = editor.sideEffects.registerOperationCompleteHandler(() => {
		const isTranslating = editor.isIn('select.translating')
		const justDropped = wasTranslating && !isTranslating
		wasTranslating = isTranslating
		if (busy || !justDropped) return

		// Pointer velocity is screen px/ms; divide by zoom to get page px/ms.
		const screenV = editor.inputs.getPointerVelocity()
		const zoom = editor.getZoomLevel()
		let v = new Vec(screenV.x / zoom, screenV.y / zoom)
		const speed = v.len()
		if (speed < STOP_SPEED) return // a gentle place, not a throw
		if (speed > MAX_SPEED) v = v.mul(MAX_SPEED / speed)

		// The selected shapes that just got dropped are the ones to launch — but
		// not every shape should fly:
		//   • LOCKED shapes are pinned by the user; honour that.
		//   • GRID shapes are fixed snapping surfaces (the "table"), not game
		//     pieces — flinging the backdrop would send everything sailing.
		//   • a piece dropped over a `snap:'strict'` grid is owned by the snapper
		//     (registerSnapping), which clamps it to a cell on this same drop. If
		//     we also launched it, the two behaviours would fight — snap clamps,
		//     physics glides it back off the cell. Let the snap win.
		for (const id of editor.getSelectedShapeIds()) {
			if (!isThrowable(editor, id)) continue
			moving.set(id, v.clone())
		}
	})

	// ── INTEGRATE ON THE EDITOR'S OWN TICK ────────────────────────────────────
	// tldraw emits 'tick' every frame with elapsed milliseconds; we don't spin our
	// own rAF. Cheap early-out keeps idle frames free.
	const onTick = (elapsedMs: number) => {
		if (busy || moving.size === 0 || elapsedMs <= 0) return
		// Never integrate while the pointer is down. If we wrote shape positions
		// during a live click/drag we'd move shapes out from under the cursor and
		// disrupt tldraw's hit-testing and pointer-up release. Flight resumes the
		// frame after release.
		if (editor.inputs.getIsPointing()) return
		// Cap dt so a tab-switch stall doesn't teleport shapes across the page.
		const dt = Math.min(elapsedMs, 64)
		const walls = editor.getViewportPageBounds()
		const decay = Math.pow(FRICTION_PER_MS, dt)

		busy = true
		try {
			editor.run(() => {
				for (const [id, v] of moving) {
					const shape = editor.getShape(id)
					const bounds = editor.getShapePageBounds(id)
					// Shape was deleted mid-flight → drop it from the sim. (A re-grab is
					// handled by the getIsPointing() gate above, which pauses the tick.)
					if (!shape || !bounds) {
						moving.delete(id)
						continue
					}

					let nx = shape.x + v.x * dt
					let ny = shape.y + v.y * dt
					let nvx = v.x
					let nvy = v.y

					// Bounce the new top-left off the viewport edges.
					const right = walls.maxX - bounds.width
					const bottom = walls.maxY - bounds.height
					if (nx < walls.minX) {
						nx = walls.minX
						nvx = Math.abs(nvx) * RESTITUTION
					} else if (nx > right) {
						nx = right
						nvx = -Math.abs(nvx) * RESTITUTION
					}
					if (ny < walls.minY) {
						ny = walls.minY
						nvy = Math.abs(nvy) * RESTITUTION
					} else if (ny > bottom) {
						ny = bottom
						nvy = -Math.abs(nvy) * RESTITUTION
					}

					editor.updateShape({ id, type: shape.type, x: nx, y: ny })

					nvx *= decay
					nvy *= decay
					if (Math.hypot(nvx, nvy) < STOP_SPEED) moving.delete(id)
					else v.set(nvx, nvy)
				}
			}, { history: 'ignore' })
		} finally {
			busy = false
		}
	}
	editor.on('tick', onTick)

	return () => {
		offComplete()
		editor.off('tick', onTick)
		moving.clear()
	}
}

/**
 * Can this shape be flicked? No for locked shapes, no for the grid backdrop, and
 * no for a piece sitting over a `snap:'strict'` grid (the snapper owns it this
 * drop — see the launch loop). The strict-grid test mirrors registerSnapping's
 * own `gridUnder` (native `getShapeAtPoint`), so the two stay in agreement
 * without sharing code.
 */
function isThrowable(editor: Editor, id: TLShapeId): boolean {
	const shape = editor.getShape(id)
	if (!shape || shape.type === 'grid') return false
	if (editor.isShapeOrAncestorLocked(id)) return false

	const bounds = editor.getShapePageBounds(id)
	if (!bounds) return false
	const grid = editor.getShapeAtPoint(bounds.center, {
		filter: (s) => s.type === 'grid',
		hitInside: true,
	}) as GridShape | undefined
	// Only 'strict' grids actually clamp on drop; 'loose'/'none' leave the piece
	// free, so a throw over those is fine.
	if (grid?.props.snap === 'strict') return false

	return true
}

/*
 * WHERE THIS GOES NEXT (not built yet — this is the prototype):
 *   • Walls: DONE — shapes bounce off the visible viewport edges (RESTITUTION).
 *     A fixed "table" rect instead of the viewport would be a one-line swap of
 *     `getViewportPageBounds()` for a constant Box.
 *   • Collisions: give each shape a circle/AABB and resolve overlaps each tick.
 *     Once you want this, reach for a real integrator (rapier, matter.js) rather
 *     than growing this loop.
 *   • Server authority (SPEC §1): move the loop into worker/Referee.ts so the
 *     Durable Object owns the simulation and writes authoritative positions —
 *     removes per-client drift, but needs a tick on the server + protocol msgs.
 *   • Opt-in per shape: gate on a `physics: boolean` prop so only some shapes
 *     are throwable. Today `isThrowable()` excludes locked shapes, the grid
 *     backdrop, and pieces over a strict grid — but every OTHER shape flies. A
 *     prop would make it opt-in instead of opt-out.
 */
