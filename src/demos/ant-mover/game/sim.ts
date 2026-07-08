// Ant-mover physics sim — a planck.js rigid-body world for the object + maze.
//
// PURE & FRAMEWORK-FREE by design: no tldraw, no React, no DOM. This is the same
// code that ports verbatim into the Durable Object at step 4 (see
// ANT_MOVER_PLAN.md + the planck-rigid-body-sim skill). It is fed a WorldSpec of
// page-space OUTLINES (from the read layer, shapes.ts) — NOT hardcoded
// constants and NOT tldraw types — so both the client (step 2/3a) and the DO
// (step 4) build the identical world from the same shape geometry.
//
// UNITS: outlines are in tldraw PAGE PIXELS; planck wants METERS. We convert at
// this boundary (PX_PER_M) and keep the sim internally in meters. planck's +y is
// UP; page/screen +y is DOWN — so we FLIP y crossing the boundary (px→m negates
// y, m→px negates back). Do all flipping here so callers stay in page space.

import { World, Vec2 as PlanckVec2, Polygon, Chain, type Body } from 'planck'
import { PX_PER_M, type Vec2 } from './geometry'
import { decomposeConvex, type P } from './decompose'
import type { WorldSpec, ShapeOutlines } from './shapes'

/** Page pixels → planck meters (also flips y: page +y down → planck +y up). */
function pxToM(x: number, y: number): PlanckVec2 {
	return new PlanckVec2(x / PX_PER_M, -y / PX_PER_M)
}
/** planck meters → page pixels (flips y back: planck +y up → page +y down). */
function mToPx(v: PlanckVec2): Vec2 {
	return { x: v.x * PX_PER_M, y: -v.y * PX_PER_M }
}
/** A page-space ANGLE (cw-positive, +y down) ↔ planck angle (ccw-positive, +y
 * up) is just a sign flip. */
function pageAngleFromPlanck(a: number): number {
	return -a
}

/** A rigid-body pose in PAGE space: center position (px) + rotation (radians,
 * page convention, cw-positive). This is exactly what the overlay renders and
 * what the DO will broadcast. */
export interface Pose {
	x: number
	y: number
	angle: number
}

/** The object outline expressed in the body's LOCAL frame (page px, relative to
 * the body origin at the outline's centroid). The overlay draws this posed, so
 * the picture matches the physics exactly. */
export interface ObjectShape {
	/** Convex pieces (local page px) — one planck fixture each. For rendering,
	 * draw the pieces (they tile the outline). */
	pieces: Vec2[][]
	/** The authored spawn center in page px (where the object sits at rest). */
	spawn: Vec2
}

/** The live sim: the planck world plus the handle to the dynamic object body,
 * and the object's local shape (for rendering the posed body). */
export interface Sim {
	world: World
	obj: Body
	shape: ObjectShape
}

/** Centroid of a polygon outline (area-weighted). Falls back to the vertex mean
 * for a degenerate (zero-area) outline. */
function centroid(pts: Vec2[]): Vec2 {
	let a = 0
	let cx = 0
	let cy = 0
	for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
		const f = pts[j].x * pts[i].y - pts[i].x * pts[j].y
		a += f
		cx += (pts[j].x + pts[i].x) * f
		cy += (pts[j].y + pts[i].y) * f
	}
	if (Math.abs(a) < 1e-9) {
		const m = pts.reduce((s, p) => ({ x: s.x + p.x, y: s.y + p.y }), { x: 0, y: 0 })
		return { x: m.x / pts.length, y: m.y / pts.length }
	}
	a *= 0.5
	return { x: cx / (6 * a), y: cy / (6 * a) }
}

/** Add one static maze body from a shape's outlines. Each outline becomes a
 * Chain fixture (open polyline or closed loop) — Chains take ARBITRARY concave
 * polylines with no decomposition, which is exactly right for walls (they need
 * collidable surfaces, not solid fill). */
function addWalls(world: World, wall: ShapeOutlines): void {
	const body = world.createBody({ type: 'static' })
	for (const outline of wall.outlines) {
		if (outline.points.length < 2) continue
		const verts = outline.points.map((p) => pxToM(p.x, p.y))
		// A closed loop with ≥3 pts uses a looped Chain; otherwise an open chain.
		const chain =
			outline.closed && verts.length >= 3 ? new Chain(verts, true) : new Chain(verts, false)
		body.createFixture(chain, { density: 0, friction: 0.4 })
	}
}

/** Build the ObjectShape (local convex pieces + spawn) from the object's page
 * outline. We decompose the FIRST closed outline (a draw shape may have several
 * strokes; the load is a single closed figure — take the first usable one). */
function buildObjectShape(spec: ShapeOutlines): ObjectShape | null {
	// Prefer a closed outline; fall back to the first with ≥3 points.
	const outline = spec.outlines.find((o) => o.closed && o.points.length >= 3) ?? spec.outlines.find((o) => o.points.length >= 3)
	if (!outline) return null
	const spawn = centroid(outline.points)
	// Recentre to the body origin (page px), then decompose into convex pieces.
	const local: P[] = outline.points.map((p) => ({ x: p.x - spawn.x, y: p.y - spawn.y }))
	const pieces = decomposeConvex(local)
	if (pieces.length === 0) return null
	return { pieces: pieces.map((pc) => pc.map((p) => ({ x: p.x, y: p.y }))), spawn }
}

/** Build the compound dynamic object body from its local convex pieces, spawned
 * at its authored center. Each convex piece is one welded Polygon fixture, so
 * the body collides as the true (possibly concave) outline, not a bounding box. */
function addObject(world: World, shape: ObjectShape): Body {
	const body = world.createBody({ type: 'dynamic', position: pxToM(shape.spawn.x, shape.spawn.y) })
	for (const piece of shape.pieces) {
		// Piece verts are LOCAL page px (relative to spawn); convert to local meters
		// (y-flip so the body draws right-side-up: local +y down → planck +y up).
		const verts = piece.map((p) => pxToM(p.x, p.y))
		body.createFixture(new Polygon(verts), { density: 1, friction: 0.4 })
	}
	// Damping = the piece's "floor friction" (the WEIGHT feel, not mass). On
	// release the piece coasts and damping bleeds that velocity off; higher reads
	// as heavier. No restoring torque — the object still tumbles freely.
	body.setLinearDamping(LINEAR_DAMPING)
	body.setAngularDamping(ANGULAR_DAMPING)
	return body
}

/** Linear/angular damping on the object — its "floor friction" (weight feel).
 * Tune to make the piece settle sooner/later on release. */
const LINEAR_DAMPING = 4
const ANGULAR_DAMPING = 4

/**
 * Construct a fresh sim from a WorldSpec (authored shapes, page px): the static
 * maze walls + the dynamic object. Gravity is ZERO — top-down drag game, not a
 * side view; the only forces are player grabs and wall contacts. Returns null if
 * the spec has no designated object or its outline is unusable.
 */
export function createWorld(spec: WorldSpec): Sim | null {
	if (!spec.object) return null
	const shape = buildObjectShape(spec.object)
	if (!shape) return null
	const world = new World({ gravity: new PlanckVec2(0, 0) })
	for (const wall of spec.walls) addWalls(world, wall)
	const obj = addObject(world, shape)
	return { world, obj, shape }
}

/** Read the object's current pose in PAGE space (px + page-convention angle). */
export function objPose(sim: Sim): Pose {
	const p = mToPx(sim.obj.getPosition())
	return { x: p.x, y: p.y, angle: pageAngleFromPlanck(sim.obj.getAngle()) }
}

// --- Grabs ------------------------------------------------------------------
// A grab is a DAMPED spring from a BODY-LOCAL anchor (stuck to the spot the
// player grabbed, so it tracks the object's rotation) to that player's cursor.
// Each tick we resolve the anchor to its live world point and apply a force
// there — AT THE POINT, not the center, so an off-center grab produces torque.
// That torque is the whole game (see the planck-rigid-body-sim skill).
//
// It's a PD controller, not a pure position spring: force = K*(cursor − anchor)
// − C*(anchor velocity). The velocity term kills the BOUNCE — a pure spring is
// an undamped oscillator that overshoots and springs back; the damping term
// bleeds that energy so the piece settles ONTO the cursor. C is near critical
// damping for the effective stiffness so it's firm but not sluggish.

/** Spring stiffness: force per meter of (cursor − anchor) offset, per unit mass. */
const SPRING_K = 70
/** Damping: force per (m/s) of the anchor's velocity, per unit mass, OPPOSING
 * its motion. The anti-bounce term — near critical damping (~2*sqrt(K)). */
const SPRING_C = 16
/** Max force magnitude (planck units). BOTH a feel knob and the anti-tunneling
 * guard: an unclamped spring on a far cursor could inject enough velocity to
 * jump a wall in one step. */
const MAX_FORCE = 120

/** One player's active grab, in PAGE space. `anchorLocal` is the grabbed point
 * in the object's own frame (meters, planck convention) — captured once on grab
 * so it stays stuck to that spot; `cursor` updates every input. */
export interface Grab {
	/** Body-local anchor (planck meters, +y up) — where on the object this holds. */
	anchorLocal: Vec2
	/** This player's current cursor target (page px). */
	cursor: Vec2
}

/** Hit-test a page-space point against the object's fixtures. Returns the
 * body-local anchor (planck meters) if the point is on the piece, else null.
 * Used on mousedown to start a grab. */
export function hitTestObject(sim: Sim, pagePoint: Vec2): Vec2 | null {
	const worldM = pxToM(pagePoint.x, pagePoint.y)
	for (let f = sim.obj.getFixtureList(); f; f = f.getNext()) {
		if (f.testPoint(worldM)) {
			const local = sim.obj.getLocalPoint(worldM)
			return { x: local.x, y: local.y }
		}
	}
	return null
}

/** Resolve a grab's body-local anchor to its live PAGE-space point (px) — the
 * object end of the rope, which tracks the piece as it moves/rotates. */
export function grabAnchorPage(sim: Sim, g: Grab): Vec2 {
	const w = sim.obj.getWorldPoint(new PlanckVec2(g.anchorLocal.x, g.anchorLocal.y))
	return mToPx(w)
}

/** Apply every active grab's spring force to the object for this tick. Forces
 * SUM — many grabs (real players or scripted) just accumulate on the one body,
 * which is the co-op/conflict mechanic. Call once per step, before world.step. */
function applyGrabs(sim: Sim, grabs: Iterable<Grab>): void {
	for (const g of grabs) {
		const anchorWorld = sim.obj.getWorldPoint(new PlanckVec2(g.anchorLocal.x, g.anchorLocal.y))
		const cursorM = pxToM(g.cursor.x, g.cursor.y)
		// Velocity of the grabbed point itself (includes the object's spin, since
		// the anchor is off-center) — the damping term opposes THIS, killing overshoot.
		const vAnchor = sim.obj.getLinearVelocityFromWorldPoint(anchorWorld)
		const mass = sim.obj.getMass()
		let fx = ((cursorM.x - anchorWorld.x) * SPRING_K - vAnchor.x * SPRING_C) * mass
		let fy = ((cursorM.y - anchorWorld.y) * SPRING_K - vAnchor.y * SPRING_C) * mass
		const mag = Math.hypot(fx, fy)
		const cap = MAX_FORCE * mass
		if (mag > cap && mag > 1e-9) {
			fx = (fx / mag) * cap
			fy = (fy / mag) * cap
		}
		sim.obj.applyForce(new PlanckVec2(fx, fy), anchorWorld, true)
	}
}

/** Fixed simulation timestep (seconds). ~30 Hz — the tick rate the DO will use.
 * Never a variable dt (see the skill). */
export const FIXED_DT = 1 / 30

/** Advance the sim one fixed step, applying all active grabs first. */
export function step(sim: Sim, grabs: Iterable<Grab> = []): void {
	applyGrabs(sim, grabs)
	sim.world.step(FIXED_DT, 8, 3)
}
