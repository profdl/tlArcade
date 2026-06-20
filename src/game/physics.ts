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
	/**
	 * Flips which side a 'oneway' line blocks. By default a one-way collides from
	 * the side its left-hand normal points to (above, for a left->right segment);
	 * `flip: true` blocks from the opposite side instead. No effect on other
	 * kinds.
	 */
	flip?: boolean
	/**
	 * The native tldraw shape type this segment came from ('draw' | 'line' |
	 * 'geo' | 'arrow'). The physics sim ignores it; it rides along only so the
	 * audio layer can vary a sound by shape type as well as kind. Optional — the
	 * unit tests omit it.
	 */
	shape?: string
}

/**
 * A surface-contact report emitted (optionally) during a step, for the audio
 * layer to sonify. The sim itself stays silent and stateless: it only pushes
 * these into a caller-supplied sink. Omitting the sink leaves behavior
 * byte-identical to a sim with no audio at all.
 */
export interface ContactEvent {
	kind: LineKind
	strength: number
	/** Source shape type of the contacted segment, if known. */
	shape?: string
	/** Sled speed at contact (px/s), for speed-scaled volume/pitch. */
	speed: number
}

/** Tunable constants. Units are page-pixels and seconds. */
export const PHYSICS = {
	gravity: 1800, // px/s^2, pulls the sled down
	friction: 0.999, // velocity retained per step along free fall
	restitution: 0.0, // 0 = no bounce off lines (classic Line Rider feel)
	// Default surface drag when riding a solid line. Line Rider lines are
	// near-frictionless, so this is tiny: 'ice' (0) still reads as slicker and
	// 'sticky' as much grippier than a plain line. It must stay small because the
	// in-game sled is a 4-point body: this drag fires per CONTACTING point and the
	// constraint solve then spreads it across the whole rig, so a value that feels
	// gentle on the single-point step() (the unit-test path) compounds on the body
	// and can stall it dead on a flat line or cancel gravity on a gentle downhill —
	// which is what made solid/accelerate feel wrong while bounce/sticky (meant to
	// be dramatic) felt fine. See the slope probe in the fix that set this.
	surfaceFriction: 0.004,
	riderRadius: 6, // collision radius of the sled point
	contactSkin: 0.75, // band beyond riderRadius still treated as "riding" the line
	maxSpeed: 4000, // clamp to avoid tunneling/explosions
	accelerateBoost: 2400, // px/s^2 tangential acceleration added along 'accelerate' lines
	// px/s; accelerate lines stop boosting past this. Kept below the tunneling
	// threshold (2*riderRadius / FIXED_DT = 1440 px/s here) so boosted sleds don't
	// shoot through thin lines in a single step.
	accelerateMaxSpeed: 1300,
	brakeDrag: 0.2, // fraction of tangential speed removed per step on 'brake' lines
	bounceRestitution: 0.85, // restitution for 'bounce' lines (springy; 0=none, 1=elastic)
	stickyFriction: 0.45, // tangential drag fraction on 'sticky' lines (strong grip)
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

/**
 * Detect contact between a point's THIS-STEP motion (`prev` -> `pos`) and a
 * segment, returning the contact normal (unit, pointing toward the side the
 * point came from) and how far to push the point to sit `r` off the line.
 *
 * Why swept, not just proximity: a body point moves up to `maxSpeed * dt`
 * (~33px) per substep, far more than the contact band (~7px). A pure "is the
 * end position near the line?" test misses a fast point that crossed a thin
 * line in one step (tunneling), and — worse — when the end position lands just
 * past the line, `pos - closestPoint` points to the FAR side, so the old
 * push-out ejected the point deeper through the line instead of back out (the
 * "hits the inside of the box" bug).
 *
 * Fix: pick the normal from the line itself and orient it toward wherever `prev`
 * was (the side the point came from this step). Then a contact fires when the
 * point either ends within the contact band OR its motion segment crossed the
 * line within the segment's span — and the push-out always sends it back the way
 * it came. Returns null when there's no contact this step.
 */
function sweptContact(
	state: RiderState,
	seg: Segment,
	contact: number,
	r: number
): { nx: number; ny: number; penetration: number } | null {
	// Unit perpendicular of the segment (its left-hand normal in screen coords).
	let sdx = seg.b.x - seg.a.x
	let sdy = seg.b.y - seg.a.y
	const segLen = Math.hypot(sdx, sdy)
	if (segLen < EPSILON) return null
	sdx /= segLen
	sdy /= segLen
	// Left-hand normal (sdy, -sdx): for a left->right segment this points up (-y).
	const perpX = sdy
	const perpY = -sdx

	// Signed perpendicular distance of prev/pos from the infinite line.
	const sPrev = (state.prev.x - seg.a.x) * perpX + (state.prev.y - seg.a.y) * perpY
	const sPos = (state.pos.x - seg.a.x) * perpX + (state.pos.y - seg.a.y) * perpY

	// Orient the collision normal toward the side the point came from. Use prev's
	// side when it's clearly off the line; if prev sat on the line (|sPrev| tiny),
	// fall back to pos's side so a point grazing the line still resolves outward.
	const side = Math.abs(sPrev) > EPSILON ? Math.sign(sPrev) : Math.sign(sPos) || 1
	const nx = perpX * side
	const ny = perpY * side

	// The point's signed distance along that oriented normal (positive = outside).
	const dPos = sPos * side
	const dPrev = sPrev * side

	// Is the closest point of `pos` actually within the segment's span (not off
	// its end)? Off-the-end contacts are handled by the endpoint proximity test
	// below, matching the original closest-point-on-SEGMENT behavior.
	const { point, t } = closestPointOnSegment(state.pos, seg.a, seg.b)
	const onSpan = t > 0 && t < 1
	const endDist = Math.hypot(state.pos.x - point.x, state.pos.y - point.y)

	// Crossing test: did the motion pass from outside the band to inside/through
	// it, within the segment span? Catches a fast point that tunneled past.
	const crossed = onSpan && dPrev >= r && dPos < contact
	// Resting/penetrating test: end position is within the contact band on the
	// span, or near an endpoint (closest-point distance), like the old check.
	const resting = (onSpan && dPos < contact) || endDist < contact

	if (!crossed && !resting) return null
	// Push the point back to sit exactly `r` off the line on the side it came
	// from. For a crossing (dPos can be negative — it punched through) this is the
	// full depth back to the surface; for a graze it's the small overlap.
	const penetration = Math.max(0, r - dPos)
	return { nx, ny, penetration }
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
 * stabilization iteration. `suppressBounce` skips per-point bounce restitution:
 * the multi-point body handles bounce at the center-of-mass level (see stepBody),
 * so letting it ALSO fire per point would double-count the impulse and gain
 * energy. The single-point step() leaves it false. Mutates `state`.
 */
function resolveCollisions(
	state: RiderState,
	segments: Segment[],
	dt: number,
	applyKindEffects: boolean,
	suppressBounce = false,
	contacts?: ContactEvent[]
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
			// Swept detection: catches a fast point that crossed a thin line this
			// step (tunneling) and always orients the normal toward the side the
			// point came from, so the push-out never ejects it through the line.
			const hit = sweptContact(state, seg, contact, r)
			if (hit) {
				const { nx, ny, penetration } = hit

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
					// `flip` blocks from the opposite side instead.
					let alignFront = nx * sdy + ny * -sdx
					if (seg.flip) alignFront = -alignFront
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
					seg.kind === 'bounce' && !suppressBounce
						? PHYSICS.bounceRestitution * strength
						: PHYSICS.restitution
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

				// Report the contact for the audio layer (only on the kind-effect pass,
				// so each contacted segment is reported once per step — not once per
				// stabilization iteration). `speed` is the post-resolution tangential-ish
				// speed, which reads well for a ride sound. No-op when no sink is passed.
				if (lastIter && contacts) {
					contacts.push({
						kind: seg.kind ?? 'solid',
						strength: seg.strength ?? 1,
						shape: seg.shape,
						speed: Math.hypot(vX, vY) / dt,
					})
				}
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
export function step(
	state: RiderState,
	segments: Segment[],
	dt: number,
	contacts?: ContactEvent[]
): RiderState {
	integrate(state, dt)
	const ITERATIONS = 2
	for (let iter = 0; iter < ITERATIONS; iter++) {
		const last = iter === ITERATIONS - 1
		resolveCollisions(state, segments, dt, last, false, last ? contacts : undefined)
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
 * Detect whether the body is contacting a 'bounce' segment this step, and if so
 * return the contact normal (pointing from the line toward the body). Only the
 * bottom one or two points of a tumbling quad touch a line, so per-point
 * restitution inside resolveCollisions reflects just those points while the
 * non-contacting points keep their full downward velocity — the constraint solve
 * then averages the rebound away to nearly zero. So bounce is handled at the body
 * level instead (see stepBody): we reflect the WHOLE body's center-of-mass normal
 * velocity once per step, which propagates the spring to every point uniformly.
 * Returns null when no point is in contact with a bounce line.
 */
function bounceContactNormal(body: Body, segments: Segment[]): { n: Vec2; strength: number } | null {
	const contact = PHYSICS.riderRadius + PHYSICS.contactSkin
	for (const seg of segments) {
		if (seg.kind !== 'bounce') continue
		for (const p of body.points) {
			const { point } = closestPointOnSegment(p.pos, seg.a, seg.b)
			const diff = sub(p.pos, point)
			const dist = len(diff)
			if (dist < contact && dist > EPSILON) {
				return { n: { x: diff.x / dist, y: diff.y / dist }, strength: seg.strength ?? 1 }
			}
		}
	}
	return null
}

/** Add a velocity delta (px/s-equivalent step displacement) to every body point. */
function addBodyVelocity(body: Body, dvx: number, dvy: number): void {
	for (const p of body.points) {
		p.prev.x -= dvx
		p.prev.y -= dvy
	}
}

/**
 * Advance a multi-point body by one fixed timestep. Integrates every point,
 * then interleaves constraint solving with collision resolution so the body
 * both holds its shape and rests on the track. Mutates and returns `body`.
 */
export function stepBody(
	body: Body,
	segments: Segment[],
	dt: number,
	contacts?: ContactEvent[]
): Body {
	for (const p of body.points) integrate(p, dt)

	// Bounce is a whole-body effect: sample the body's normal velocity into a
	// bounce line BEFORE collisions flatten it, so we can re-launch the whole rig
	// after. (Per-point restitution alone barely moves a 4-point body — see
	// bounceContactNormal.)
	const bounce = bounceContactNormal(body, segments)
	let vnBefore = 0
	if (bounce) {
		const v = bodyVelocity(body, dt)
		vnBefore = v.x * bounce.n.x + v.y * bounce.n.y // <0 means moving into the line
	}

	const ITERATIONS = 4 // more passes than the point sled: shape + contacts to settle
	for (let iter = 0; iter < ITERATIONS; iter++) {
		for (const c of body.constraints) solveConstraint(body, c)
		const last = iter === ITERATIONS - 1
		// suppressBounce: bounce is re-applied at the body level below, so don't
		// also reflect it per point (that would double the impulse, gaining energy).
		// Collect contacts only on the last pass; every point reports, so the audio
		// layer sees each surface the body touches (it dedupes by kind/shape).
		for (const p of body.points) resolveCollisions(p, segments, dt, last, true, last ? contacts : undefined)
	}

	// Re-launch the body off the bounce line. Set the center-of-mass normal
	// velocity to an ABSOLUTE target (-restitution * inbound speed) rather than
	// adding a reflected impulse: after the collision iterations the COM still
	// carries residual normal velocity (the contacting corner stopped while the
	// free corners kept falling), so adding (1+e)|vn| on top of that residual
	// over-injects energy and the bounces grow without bound. Correcting toward a
	// target instead caps the rebound at restitution and stays stable. Applied to
	// every point so the whole rig lifts off together, not just the touching corner.
	if (bounce && vnBefore < 0) {
		const restitution = PHYSICS.bounceRestitution * bounce.strength
		const targetVn = -restitution * vnBefore // desired outbound (along +n) speed
		const after = bodyVelocity(body, dt)
		const vnAfter = after.x * bounce.n.x + after.y * bounce.n.y
		const dv = targetVn - vnAfter // close the gap to the target only
		addBodyVelocity(body, bounce.n.x * dv * dt, bounce.n.y * dv * dt)
	}

	for (const p of body.points) clampSpeed(p, dt)
	return body
}
