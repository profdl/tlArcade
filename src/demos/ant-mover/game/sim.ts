// Ant-mover physics sim — a planck.js rigid-body world for the T + maze.
//
// PURE & FRAMEWORK-FREE by design: no tldraw, no React, no DOM. This is the same
// code that ports verbatim into the Durable Object at step 4 (see
// ANT_MOVER_PLAN.md + the planck-rigid-body-sim skill). Step 1 uses only
// createWorld + tPose (static render); grab forces arrive in step 2.
//
// UNITS: geometry.ts is in tldraw PAGE PIXELS; planck wants METERS. We convert at
// this boundary (PX_PER_M) and keep the sim internally in meters. planck's +y is
// UP; page/screen +y is DOWN — so we FLIP y crossing the boundary (px→m negates
// y, m→px negates back). Do all flipping here so callers stay in page space.

import { World, Vec2 as PlanckVec2, Box, type Body } from 'planck'
import { PX_PER_M, T_FIXTURES, T_SPAWN, MAZE_WALLS, type Rect, type Vec2 } from './geometry'

/** Page pixels → planck meters (also flips y: page +y down → planck +y up). */
function pxToM(x: number, y: number): PlanckVec2 {
	return new PlanckVec2(x / PX_PER_M, -y / PX_PER_M)
}
/** planck meters → page pixels (flips y back: planck +y up → page +y down). */
function mToPx(v: PlanckVec2): Vec2 {
	return { x: v.x * PX_PER_M, y: -v.y * PX_PER_M }
}
/** A page-space ANGLE (cw-positive, +y down) → planck angle (ccw-positive, +y up)
 * is just a sign flip; and back. Rotations negate crossing the y-flip. */
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

/** The live sim: the planck world plus the handle to the dynamic T body. */
export interface Sim {
	world: World
	t: Body
}

/** Add one static box fixture (a maze wall) to the world, converting px→m. A wall
 * rect's cx/cy are absolute page coords. */
function addWall(world: World, r: Rect): void {
	const center = pxToM(r.cx, r.cy)
	const body = world.createBody({ type: 'static', position: center })
	// Box half-extents are lengths (no y-flip), just scaled to meters.
	body.createFixture(new Box(r.halfW / PX_PER_M, r.halfH / PX_PER_M), { density: 0 })
}

/** Build the compound T dynamic body at its spawn, with both welded fixtures. */
function addT(world: World): Body {
	const t = world.createBody({ type: 'dynamic', position: pxToM(T_SPAWN.x, T_SPAWN.y) })
	for (const f of T_FIXTURES) {
		// Fixture center is in the body's LOCAL px frame; convert to local meters
		// (same y-flip so the T draws right-side-up: local +y down → planck +y up).
		const c = pxToM(f.cx, f.cy)
		t.createFixture(new Box(f.halfW / PX_PER_M, f.halfH / PX_PER_M, c), {
			density: 1,
			friction: 0.4,
		})
	}
	// Damping so pulls don't leave it drifting/spinning forever (NO restoring
	// torque — the T tumbles freely, per the skill).
	t.setLinearDamping(0.8)
	t.setAngularDamping(0.8)
	return t
}

/** Construct a fresh sim: the maze walls + the T. Gravity is ZERO — this is a
 * top-down drag game, not a side view; the only forces are player grabs (step 2)
 * and wall contacts. */
export function createWorld(): Sim {
	const world = new World({ gravity: new PlanckVec2(0, 0) })
	for (const wall of MAZE_WALLS) addWall(world, wall)
	const t = addT(world)
	return { world, t }
}

/** Read the T's current pose in PAGE space (px + page-convention angle). */
export function tPose(sim: Sim): Pose {
	const p = mToPx(sim.t.getPosition())
	return { x: p.x, y: p.y, angle: pageAngleFromPlanck(sim.t.getAngle()) }
}

// --- Grabs ------------------------------------------------------------------
// A grab is a spring from a BODY-LOCAL anchor (stuck to the spot the player
// grabbed, so it tracks the T's rotation) to that player's cursor. Each tick we
// resolve the anchor to its live world point and apply a force there — AT THE
// POINT, not the center, so an off-center grab produces torque. That torque is
// the whole game (see the planck-rigid-body-sim skill).

/** Spring stiffness: force per meter of (cursor − anchor) offset, per unit mass.
 * Tuned so a normal drag feels like pulling a rope, not teleporting the piece. */
const SPRING_K = 40
/** Max force magnitude (N-ish, in planck units). The clamp is BOTH a feel knob
 * and the anti-tunneling guard: an unclamped spring on a far cursor could inject
 * enough velocity to jump a wall in one step. */
const MAX_FORCE = 90

/** One player's active grab, in PAGE space. `anchorLocal` is the grabbed point in
 * the T's own frame (meters, planck convention) — captured once on grab so it
 * stays stuck to that spot; `cursor` updates every input. */
export interface Grab {
	/** Body-local anchor (planck meters, +y up) — where on the T this player holds. */
	anchorLocal: Vec2
	/** This player's current cursor target (page px). */
	cursor: Vec2
}

/** Hit-test a page-space point against the T's fixtures. Returns the body-local
 * anchor (planck meters) if the point is on the piece, else null. Used on
 * mousedown to start a grab. */
export function hitTestT(sim: Sim, pagePoint: Vec2): Vec2 | null {
	const worldM = pxToM(pagePoint.x, pagePoint.y)
	for (let f = sim.t.getFixtureList(); f; f = f.getNext()) {
		if (f.testPoint(worldM)) {
			const local = sim.t.getLocalPoint(worldM)
			return { x: local.x, y: local.y }
		}
	}
	return null
}

/** Apply every active grab's spring force to the T for this tick. Forces SUM —
 * many grabs (real players or scripted) just accumulate on the one body, which is
 * the co-op/conflict mechanic. Call once per step, before world.step. */
function applyGrabs(sim: Sim, grabs: Iterable<Grab>): void {
	for (const g of grabs) {
		const anchorWorld = sim.t.getWorldPoint(new PlanckVec2(g.anchorLocal.x, g.anchorLocal.y))
		const cursorM = pxToM(g.cursor.x, g.cursor.y)
		// Spring toward the cursor, scaled by mass so heavier tuning doesn't change
		// the feel; clamped to MAX_FORCE.
		const mass = sim.t.getMass()
		let fx = (cursorM.x - anchorWorld.x) * SPRING_K * mass
		let fy = (cursorM.y - anchorWorld.y) * SPRING_K * mass
		const mag = Math.hypot(fx, fy)
		const cap = MAX_FORCE * mass
		if (mag > cap && mag > 1e-9) {
			fx = (fx / mag) * cap
			fy = (fy / mag) * cap
		}
		sim.t.applyForce(new PlanckVec2(fx, fy), anchorWorld, true)
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
