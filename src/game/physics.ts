// Lightweight Line Rider physics: a point-mass "sled" under gravity that
// collides against a set of static line segments. Uses Verlet integration
// (position-based) which is stable and simple for this kind of sim.

export interface Vec2 {
	x: number
	y: number
}

/** The gameplay behavior of a track line. */
export type LineKind =
	| 'solid'
	| 'accelerate'
	| 'brake'
	| 'bounce'
	| 'sticky'
	| 'ice'
	| 'oneway'
	| 'scenery'

/** A line segment in world (page) space that the sled can ride on. */
export interface Segment {
	a: Vec2
	b: Vec2
	/** Gameplay behavior. Defaults to 'solid' when omitted. */
	kind?: LineKind
	/**
	 * Scales the strength of the kind's effect, 0..1. Lets "light-" color
	 * variants reuse the same kind with a weaker magnitude (e.g. light-red is
	 * accelerate at strength 0.5). Defaults to 1 when omitted.
	 */
	strength?: number
}

/** Tunable constants. Units are page-pixels and seconds. */
export const PHYSICS = {
	gravity: 1800, // px/s^2, pulls the sled down
	friction: 0.999, // velocity retained per step along free fall
	restitution: 0.0, // 0 = no bounce off lines (classic Line Rider feel)
	surfaceFriction: 0.0015, // tangential drag when riding a line (Line Rider lines are near-frictionless)
	riderRadius: 6, // collision radius of the sled point
	contactSkin: 0.75, // band beyond riderRadius still treated as "riding" the line
	maxSpeed: 4000, // clamp to avoid tunneling/explosions
	accelerateBoost: 1200, // px/s^2 tangential acceleration added along 'accelerate' lines
	// px/s; accelerate lines stop boosting past this. Kept below the tunneling
	// threshold (~2*riderRadius / FIXED_DT) so boosted sleds don't shoot through
	// thin lines in a single step.
	accelerateMaxSpeed: 1000,
	brakeDrag: 0.08, // fraction of tangential speed removed per step on 'brake' lines
	bounceRestitution: 0.85, // restitution for 'bounce' lines (springy; 0=none, 1=elastic)
	stickyFriction: 0.25, // tangential drag fraction on 'sticky' lines (strong grip)
	iceFriction: 0.0, // tangential drag on 'ice' lines (perfectly frictionless glide)
}

// Below this we treat a displacement as zero (avoid divide-by-zero / NaN).
const EPSILON = 1e-9

export interface RiderState {
	pos: Vec2
	prev: Vec2 // previous position; (pos - prev) encodes velocity in Verlet
}

export function makeRider(start: Vec2): RiderState {
	return {
		pos: { x: start.x, y: start.y },
		prev: { x: start.x, y: start.y },
	}
}

function sub(a: Vec2, b: Vec2): Vec2 {
	return { x: a.x - b.x, y: a.y - b.y }
}

function len(v: Vec2): number {
	return Math.hypot(v.x, v.y)
}

/**
 * Closest point on segment [a,b] to point p, plus the parametric t in [0,1].
 */
function closestPointOnSegment(p: Vec2, a: Vec2, b: Vec2): { point: Vec2; t: number } {
	const abx = b.x - a.x
	const aby = b.y - a.y
	const lenSq = abx * abx + aby * aby
	if (lenSq === 0) return { point: { x: a.x, y: a.y }, t: 0 }
	let t = ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq
	t = Math.max(0, Math.min(1, t))
	return { point: { x: a.x + abx * t, y: a.y + aby * t }, t }
}

/** Verlet integration of a single point under gravity. Mutates `state`. */
function integrate(state: RiderState, dt: number): void {
	const vx = (state.pos.x - state.prev.x) * PHYSICS.friction
	const vy = (state.pos.y - state.prev.y) * PHYSICS.friction

	state.prev.x = state.pos.x
	state.prev.y = state.pos.y

	state.pos.x += vx
	state.pos.y += vy + PHYSICS.gravity * dt * dt
}

/**
 * Resolve one point against every segment: project it out of the line and
 * reflect/damp the velocity into the surface, honoring each segment's kind.
 * `applyKindEffects` gates the once-per-step velocity-changing effects
 * (accelerate / brake) so they fire on a single resolution pass, not every
 * stabilization iteration. Mutates `state`.
 */
function resolveCollisions(
	state: RiderState,
	segments: Segment[],
	dt: number,
	applyKindEffects: boolean
): void {
	const r = PHYSICS.riderRadius
	// A sled resting on a line settles at exactly dist == r. Treat a thin band
	// beyond r as still "in contact" so surface friction and kind-based effects
	// (accelerate / oneway) keep engaging while the sled rides the line, not
	// only during the brief penetration transient.
	const contact = r + PHYSICS.contactSkin
	{
		// Renamed from the old per-iteration `lastIter`: callers decide when the
		// once-per-step kind effects apply.
		const lastIter = applyKindEffects
		for (const seg of segments) {
			const { point } = closestPointOnSegment(state.pos, seg.a, seg.b)
			const diff = sub(state.pos, point)
			const dist = len(diff)
			if (dist < contact && dist > EPSILON) {
				// Surface normal pointing from line toward the rider.
				const nx = diff.x / dist
				const ny = diff.y / dist
				// Positive only when actually overlapping; 0 within the contact skin.
				const penetration = Math.max(0, r - dist)

				// One-way lines only collide when the rider sits on the "front"
				// side — the half-plane the segment's left-hand normal points to.
				// For a left->right segment that normal points up (-y), so a rider
				// above the line is blocked and a rider below passes through.
				// front side <=> collision normal `n` aligns with the left-hand
				// normal of (a->b), i.e. their dot product is positive.
				if (seg.kind === 'oneway') {
					const sdx = seg.b.x - seg.a.x
					const sdy = seg.b.y - seg.a.y
					// Left-hand normal of (sdx,sdy) is (sdy,-sdx) in screen coords
					// (y points down), which evaluates to (0,-len) pointing up.
					const alignFront = nx * sdy + ny * -sdx
					if (alignFront <= 0) continue
				}

				// Push the rider out along the normal.
				state.pos.x += nx * penetration
				state.pos.y += ny * penetration

				// Per-kind surface tuning. `strength` (0..1) scales a kind's effect
				// so "light-" color variants reuse the same kind at a weaker value.
				const strength = seg.strength ?? 1
				// Bounce lines are springy; everything else keeps the classic
				// near-zero restitution.
				const restitution =
					seg.kind === 'bounce' ? PHYSICS.bounceRestitution * strength : PHYSICS.restitution
				// Tangential drag varies by surface: ice glides, sticky grips,
				// everything else uses the default near-frictionless value.
				let tangentFriction: number
				if (seg.kind === 'ice') tangentFriction = PHYSICS.iceFriction
				else if (seg.kind === 'sticky') tangentFriction = PHYSICS.stickyFriction * strength
				else tangentFriction = PHYSICS.surfaceFriction

				// Remove the velocity component into the surface (+ optional bounce),
				// and apply tangential friction so the sled "rides" the line.
				let vX = state.pos.x - state.prev.x
				let vY = state.pos.y - state.prev.y
				const vn = vX * nx + vY * ny // velocity along normal
				if (vn < 0) {
					vX -= (1 + restitution) * vn * nx
					vY -= (1 + restitution) * vn * ny
				}
				// Tangential component damping (surface friction).
				const tX = vX - (vX * nx + vY * ny) * nx
				const tY = vY - (vX * nx + vY * ny) * ny
				vX -= tX * tangentFriction
				vY -= tY * tangentFriction

				// Accelerate lines push the sled along the surface tangent, in
				// whichever tangential direction it's already moving — but stop
				// boosting past accelerateMaxSpeed so it can't run away or tunnel.
				if (seg.kind === 'accelerate' && lastIter) {
					const tLen = Math.hypot(tX, tY)
					const speed = Math.hypot(vX, vY) / dt
					if (tLen > EPSILON && speed < PHYSICS.accelerateMaxSpeed) {
						const impulse = PHYSICS.accelerateBoost * strength * dt * dt
						vX += (tX / tLen) * impulse
						vY += (tY / tLen) * impulse
					}
				}

				// Brake lines remove a fraction of the sled's tangential speed each
				// step, slowing it as it rides (the opposite of accelerate). Applied
				// once per step (final iteration) like the boost.
				if (seg.kind === 'brake' && lastIter) {
					const drag = Math.min(1, PHYSICS.brakeDrag * strength)
					vX -= tX * drag
					vY -= tY * drag
				}

				state.prev.x = state.pos.x - vX
				state.prev.y = state.pos.y - vY
			}
		}
	}
}

/** Clamp a point's per-step displacement so its speed never exceeds maxSpeed. */
function clampSpeed(state: RiderState, dt: number): void {
	const sx = state.pos.x - state.prev.x
	const sy = state.pos.y - state.prev.y
	const stepLen = Math.hypot(sx, sy)
	if (stepLen > EPSILON && stepLen / dt > PHYSICS.maxSpeed) {
		const scale = (PHYSICS.maxSpeed * dt) / stepLen
		state.prev.x = state.pos.x - sx * scale
		state.prev.y = state.pos.y - sy * scale
	}
}

/**
 * Advance the single-point rider by one fixed timestep. Mutates and returns
 * `state`. Integrates under gravity, then resolves collisions over a couple of
 * stabilization iterations (kind effects applied once, on the last).
 */
export function step(state: RiderState, segments: Segment[], dt: number): RiderState {
	integrate(state, dt)
	const ITERATIONS = 2
	for (let iter = 0; iter < ITERATIONS; iter++) {
		resolveCollisions(state, segments, dt, iter === ITERATIONS - 1)
	}
	clampSpeed(state, dt)
	return state
}

/** Current velocity (px/s) derived from Verlet positions. */
export function velocity(state: RiderState, dt: number): Vec2 {
	return {
		x: (state.pos.x - state.prev.x) / dt,
		y: (state.pos.y - state.prev.y) / dt,
	}
}

// --- Multi-point sled body --------------------------------------------------
// A real Line Rider sled is a rigid-ish body that can tumble, not a single
// point. We model it as a small set of point masses joined by distance
// constraints (a "Verlet rig"): each point collides exactly like the single
// rider above, and constraints solved between collision passes hold the shape
// together. Reusing integrate()/resolveCollisions() keeps one collision code
// path, so every line behavior works on the body for free.

/** A distance constraint holding two body points at a fixed rest length. */
export interface Constraint {
	i: number // index into body.points
	j: number // index into body.points
	rest: number // target distance between the two points
	/** Stiffness 0..1: fraction of the error corrected per solve pass. */
	stiffness: number
}

/** A multi-point sled: point masses joined by distance constraints. */
export interface Body {
	points: RiderState[]
	constraints: Constraint[]
}

/**
 * Build a default sled body: a small rigid quad (4 points) braced by its two
 * diagonals so it holds a roughly square shape while tumbling. `center` is the
 * spawn point; `size` is the half-extent of the quad.
 */
export function makeBody(center: Vec2, size = PHYSICS.riderRadius * 2): Body {
	const offsets: Vec2[] = [
		{ x: -size, y: -size },
		{ x: size, y: -size },
		{ x: size, y: size },
		{ x: -size, y: size },
	]
	const points = offsets.map((o) => makeRider({ x: center.x + o.x, y: center.y + o.y }))
	const dist = (a: number, b: number) => Math.hypot(points[a].pos.x - points[b].pos.x, points[a].pos.y - points[b].pos.y)
	const edge = 1 // edges fully rigid
	const brace = 0.8 // diagonals slightly softer so the solve stays stable
	const constraints: Constraint[] = [
		{ i: 0, j: 1, rest: dist(0, 1), stiffness: edge },
		{ i: 1, j: 2, rest: dist(1, 2), stiffness: edge },
		{ i: 2, j: 3, rest: dist(2, 3), stiffness: edge },
		{ i: 3, j: 0, rest: dist(3, 0), stiffness: edge },
		{ i: 0, j: 2, rest: dist(0, 2), stiffness: brace },
		{ i: 1, j: 3, rest: dist(1, 3), stiffness: brace },
	]
	return { points, constraints }
}

/** The body's center of mass (average of its points). Used for camera/stats. */
export function bodyCenter(body: Body): Vec2 {
	let x = 0
	let y = 0
	for (const p of body.points) {
		x += p.pos.x
		y += p.pos.y
	}
	const n = body.points.length || 1
	return { x: x / n, y: y / n }
}

/** Mean velocity (px/s) of the body's points. */
export function bodyVelocity(body: Body, dt: number): Vec2 {
	let x = 0
	let y = 0
	for (const p of body.points) {
		x += (p.pos.x - p.prev.x) / dt
		y += (p.pos.y - p.prev.y) / dt
	}
	const n = body.points.length || 1
	return { x: x / n, y: y / n }
}

/** Move two constrained points toward their rest length (positional solve). */
function solveConstraint(body: Body, c: Constraint): void {
	const a = body.points[c.i]
	const b = body.points[c.j]
	const dx = b.pos.x - a.pos.x
	const dy = b.pos.y - a.pos.y
	const d = Math.hypot(dx, dy)
	if (d < EPSILON) return
	// Half the error moved by each end (equal mass), scaled by stiffness.
	const diff = ((d - c.rest) / d) * 0.5 * c.stiffness
	const ox = dx * diff
	const oy = dy * diff
	a.pos.x += ox
	a.pos.y += oy
	b.pos.x -= ox
	b.pos.y -= oy
}

/**
 * Advance a multi-point body by one fixed timestep. Integrates every point,
 * then interleaves constraint solving with collision resolution so the body
 * both holds its shape and rests on the track. Mutates and returns `body`.
 */
export function stepBody(body: Body, segments: Segment[], dt: number): Body {
	for (const p of body.points) integrate(p, dt)

	const ITERATIONS = 4 // more passes than the point sled: shape + contacts to settle
	for (let iter = 0; iter < ITERATIONS; iter++) {
		for (const c of body.constraints) solveConstraint(body, c)
		const last = iter === ITERATIONS - 1
		for (const p of body.points) resolveCollisions(p, segments, dt, last)
	}

	for (const p of body.points) clampSpeed(p, dt)
	return body
}
