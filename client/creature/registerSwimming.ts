/**
 * FISHTANK SWIMMING  (creature roaming)
 * =====================================
 * "Drop a creature on a native geo shape → it swims around inside it, as if the
 * geo shape were a fishtank." A creature NOT over a geo shape just undulates in
 * place (the in-shape animation in CreatureShape.tsx); this file only adds the
 * roaming.
 *
 * NATIVE-FIRST, and consistent with client/physics/registerPhysics.ts:
 *   • We ride tldraw's own per-frame `editor.on('tick', elapsedMs => …)` — no
 *     separate rAF (the creature CLOCK already rides this too).
 *   • We move a creature by writing `shape.x/y` (+ `rotation` so it faces where
 *     it's going) DIRECTLY, client-local, inside `editor.run(fn, { history:
 *     'ignore' })`. Sync replicates the positions to every other client for free,
 *     exactly like a drag or the throw-physics loop — so we do NOT sync any
 *     per-frame velocity ourselves (CLAUDE.md gotchas #5 & #7).
 *   • The "tank" is found with `editor.getShapeAtPoint(center, { filter, hitInside
 *     })`, the same native hit-test registerSnapping/isThrowable use to find the
 *     grid under a piece.
 *
 * TANK = NATIVE GEO SHAPES ONLY. A geo shape is tldraw's built-in rectangle/
 * ellipse/etc. (`type === 'geo'`). Hand-drawn shapes from the draw tool are
 * `type === 'draw'` and are deliberately NOT tanks — a creature ignores them.
 *
 * MOTION = gentle wander + wall AVOIDANCE (steering, not bounce) + propulsion.
 * Each creature carries a slow drifting heading that meanders (seeded per
 * creature) and steers away from the tank walls before reaching them; forward
 * speed is modulated by the shared tailBeat thrust. Speed is its `props.speed` knob.
 *
 * OWNERSHIP: like physics, this is client-local. Every client runs the loop, but
 * to keep clients from fighting over shared x/y we elect ONE driver per page —
 * the connected client with the lowest user id (see ownsSwimmingLead). That one
 * client drives every creature on the page; the rest just render the synced
 * positions. Simpler than per-creature assignment and good enough for a demo.
 *
 * Mount once from <Tldraw onMount> alongside the other behaviours; returns a
 * disposer.
 */
import { Editor, TLShapeId, Vec } from 'tldraw'
import { creatureClock, tailBeat } from './clock'
import { CreatureShape } from '../shapes/CreatureShape'

/** Base swim speed in page px/ms at speed:1 (a calm drift). */
const BASE_SPEED = 0.05
/** Fraction of base speed kept between tail-beats, so it coasts (never stalls). */
const GLIDE_FLOOR = 0.35
/** How sharply the heading meanders, in radians/ms. Gentle — barely curving. */
const TURN_RATE = 0.0004
/** How firmly the creature steers away from a wall, in radians/ms at full depth. */
const AVOID_RATE = 0.004
/** Start steering away once the body is within this fraction of the tank from a wall. */
const AVOID_MARGIN = 0.22
/** Cap dt so a tab-switch stall can't teleport a creature across its tank. */
const MAX_DT = 64
/**
 * If the shape's stored centre jumps further than this from where we last left
 * it, treat it as a USER DRAG and resync to it (rather than our own integration).
 * Must exceed the largest single-tick swim step so our own writes never trip it:
 * one step ≈ BASE_SPEED · MAX_DT · speed; at speed 1 that's ~3.2px, so 8px leaves
 * headroom up to speed ~2.5 before a fast creature could false-trigger.
 */
const DRAG_RESYNC_DIST = 8

/**
 * Per-creature live swim state, kept LOCAL (never synced):
 *   heading  — current travel direction (radians); the body's HEAD leads it
 *   wander   — phase of the slow meander that steers `heading`
 *   cx, cy   — the body's CENTRE in page space. We integrate motion on the centre
 *              and derive the shape's top-left from it each tick, so translation
 *              and rotation stay consistent (no fighting between a manual move and
 *              a centre-pivot rotate).
 */
type SwimState = { heading: number; wander: number; cx: number; cy: number }

export function registerSwimming(editor: Editor): () => void {
	let busy = false
	const state = new Map<TLShapeId, SwimState>()

	const onTick = (elapsedMs: number) => {
		if (busy || elapsedMs <= 0) return
		// Never integrate while the pointer is down — writing positions under a live
		// drag breaks hit-testing and the pointer-up release (same gate as physics).
		if (editor.inputs.getIsPointing()) return

		// Only the elected lead client drives motion (avoids clients fighting over
		// the synced x/y). Checked once per tick — it's a per-page election, not
		// per creature.
		if (!ownsSwimmingLead(editor)) return

		const creatures = editor
			.getCurrentPageShapes()
			.filter((s): s is CreatureShape => s.type === 'creature')
		if (creatures.length === 0) return

		const dt = Math.min(elapsedMs, MAX_DT)

		busy = true
		try {
			editor.run(
				() => {
					for (const creature of creatures) swimOne(editor, creature, state, dt)
				},
				{ history: 'ignore' }
			)
		} finally {
			busy = false
		}

		// Forget state for creatures that left the page (deleted / undone).
		if (state.size > creatures.length) {
			const live = new Set(creatures.map((c) => c.id))
			for (const id of state.keys()) if (!live.has(id)) state.delete(id)
		}
	}
	editor.on('tick', onTick)

	return () => {
		editor.off('tick', onTick)
		state.clear()
	}
}

/** Move one creature one tick within its tank (or leave it still if tankless). */
function swimOne(editor: Editor, creature: CreatureShape, all: Map<TLShapeId, SwimState>, dt: number) {
	const bounds = editor.getShapePageBounds(creature.id)
	if (!bounds) return

	const tank = tankUnder(editor, creature.id)
	if (!tank) return // not in a tank → no roaming (it still undulates in place)

	// Lazily seed this creature's heading + centre from its current synced state,
	// so different creatures set off in different directions deterministically and
	// we begin integrating from where the shape actually is.
	let s = all.get(creature.id)
	if (!s) {
		s = {
			heading: creature.props.seed * Math.PI * 2,
			wander: creature.props.seed * 10,
			cx: bounds.center.x,
			cy: bounds.center.y,
		}
		all.set(creature.id, s)
	} else {
		// If a user dragged the creature, the store's centre moved out from under
		// us — resync to it so we swim from where it was placed, not where we left
		// off. Small drifts are our own writes; a jump past DRAG_RESYNC_DIST (well
		// above one swim step) is a drag.
		if (Math.hypot(bounds.center.x - s.cx, bounds.center.y - s.cy) > DRAG_RESYNC_DIST) {
			s.cx = bounds.center.x
			s.cy = bounds.center.y
		}
	}

	// Meander: nudge the heading by a smooth, slowly-varying amount. Using the
	// wander phase (advanced each tick) keeps turns gentle and frame-rate-stable.
	s.wander += dt * 0.002
	s.heading += Math.sin(s.wander) * TURN_RATE * dt

	// WALL AVOIDANCE (not bounce): as the body's centre nears a wall, steer the
	// heading toward the tank interior — gently when just inside the margin, more
	// firmly the closer it gets. The creature curves away before reaching the edge.
	const margin = Math.min(tank.width, tank.height) * AVOID_MARGIN
	let ax = 0
	let ay = 0
	if (margin > 0) {
		const dxL = s.cx - tank.minX // distance to each wall
		const dxR = tank.maxX - s.cx
		const dyT = s.cy - tank.minY
		const dyB = tank.maxY - s.cy
		if (dxL < margin) ax += 1 - dxL / margin // too close to LEFT → push right
		if (dxR < margin) ax -= 1 - dxR / margin // too close to RIGHT → push left
		if (dyT < margin) ay += 1 - dyT / margin // too close to TOP → push down
		if (dyB < margin) ay -= 1 - dyB / margin // too close to BOTTOM → push up
	}
	if (ax !== 0 || ay !== 0) {
		// Rotate `heading` toward the away-direction by an amount scaled to depth.
		const depth = Math.min(1, Math.hypot(ax, ay))
		const want = Math.atan2(ay, ax)
		let diff = want - s.heading
		diff = Math.atan2(Math.sin(diff), Math.cos(diff)) // shortest angular path
		s.heading += diff * Math.min(1, AVOID_RATE * dt * depth)
	}

	// PROPULSION: modulate forward speed by the SHARED tail-beat thrust, read from
	// the same clock+seed+speed the body renders with — so the surge lines up with
	// the visible tail-flick on every client. A small GLIDE_FLOOR keeps it coasting
	// between beats rather than stalling dead, like a real swimmer.
	const { thrust } = tailBeat(creatureClock.get(), creature.props.seed, creature.props.speed)
	const drive = GLIDE_FLOOR + (1 - GLIDE_FLOOR) * thrust
	const speed = BASE_SPEED * Math.max(0, creature.props.speed) * drive

	// Integrate the CENTRE along the heading — the creature moves where its HEAD
	// points. Then keep the centre inside the tank (its own half-size as inset).
	s.cx += Math.cos(s.heading) * speed * dt
	s.cy += Math.sin(s.heading) * speed * dt
	const halfW = creature.props.w / 2
	const halfH = creature.props.h / 2
	s.cx = clamp(s.cx, tank.minX + halfW, Math.max(tank.minX + halfW, tank.maxX - halfW))
	s.cy = clamp(s.cy, tank.minY + halfH, Math.max(tank.minY + halfH, tank.maxY - halfH))

	// FACE THE HEADING. The body is drawn head-LEFT in local space (forward = −x),
	// so rotation = heading + π points the head along the travel direction. Derive
	// the top-left from the desired CENTRE + rotation in ONE write, so position and
	// rotation never disagree (the bug with a separate translate + rotateShapesBy).
	// NOTE: tldraw rotates a shape about its top-left ORIGIN (shape.x/y), not its
	// centre — so the centre→top-left offset is (halfW, halfH) ROTATED by the angle,
	// not the plain (halfW, halfH). Getting this wrong wobbles the body when turned.
	const rotation = s.heading + Math.PI
	const half = new Vec(halfW, halfH).rot(rotation) // centre→top-left offset, rotated
	editor.updateShape<CreatureShape>({
		id: creature.id,
		type: 'creature',
		x: s.cx - half.x,
		y: s.cy - half.y,
		rotation,
	})
}

function clamp(n: number, lo: number, hi: number): number {
	return n < lo ? lo : n > hi ? hi : n
}

/**
 * The native geo shape under a creature's centre, if any — its tank. Mirrors the
 * grid hit-test in registerSnapping/isThrowable, but filtered to `type === 'geo'`
 * so ONLY tldraw's built-in geo shapes count (draw/frame/our shapes are skipped).
 *
 * Returns the tank's page-space AABB. Wall avoidance + clamping use this axis-
 * aligned box, so a ROTATED tank contains the creature in its bounding box, not
 * its true rotated outline — fine for the expected case (axis-aligned rectangles).
 *
 * Also imported by CreatureShape.tsx, which only needs the truthiness (in a tank
 * → animate; alone on the canvas → freeze).
 */
export function tankUnder(editor: Editor, id: TLShapeId) {
	const bounds = editor.getShapePageBounds(id)
	if (!bounds) return undefined
	const tank = editor.getShapeAtPoint(bounds.center, {
		filter: (s) => s.type === 'geo',
		hitInside: true,
	})
	if (!tank) return undefined
	return editor.getShapePageBounds(tank.id)
}

/**
 * Is THIS client the swim lead for the current page? To stop every client writing
 * the same positions (and fighting over them in sync), exactly one client drives
 * motion: the connected peer whose user id sorts first. We use
 * `getCollaboratorsOnCurrentPage()` (NOT `getCollaborators()`) so a peer viewing a
 * DIFFERENT page can't win the election and then drive nothing — which would
 * freeze every creature for the clients actually watching. Solo client → that's us.
 */
function ownsSwimmingLead(editor: Editor): boolean {
	const me = editor.user.getId()
	const others = editor.getCollaboratorsOnCurrentPage().map((c) => c.userId)
	if (others.length === 0) return true
	const all = [me, ...others].sort()
	return all[0] === me
}

/*
 * WHERE THIS GOES NEXT (known limitations, not bugs):
 *   • Single global lead: ONE client drives every creature on the page. If that
 *     client closes its tab, motion pauses until presence updates elect the next
 *     lead (a short gap). To load-share, assign each creature to a driver by
 *     hashing its id against the sorted collaborator list, so the fleet survives
 *     any one client leaving and the work spreads across tabs.
 *   • Server authority (SPEC §1): like the physics prototype, the loop could move
 *     into worker/Referee.ts so the Durable Object owns positions — removes the
 *     client-lead election and per-client drift entirely, at the cost of a server
 *     tick + protocol messages.
 *   • Rotated tanks: avoidance uses the tank's axis-aligned bounds (see tankUnder),
 *     so a rotated geo tank contains the creature in its bounding box, not its true
 *     outline. Transform the centre into tank-local space to fix.
 */
