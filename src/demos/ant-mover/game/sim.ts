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

/** Fixed simulation timestep (seconds). ~30 Hz — the tick rate the DO will use.
 * Never a variable dt (see the skill). */
export const FIXED_DT = 1 / 30

/** Advance the sim one fixed step. */
export function step(sim: Sim): void {
	sim.world.step(FIXED_DT, 8, 3)
}
