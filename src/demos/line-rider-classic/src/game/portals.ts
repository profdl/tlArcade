// Portals. A portal is a one-way teleport between two page-space regions,
// authored natively as an ARROW bound at both ends to geo shapes: the arrow's
// `start` terminal marks the entrance mouth, its `end` terminal the exit. When
// the sled's center enters the entrance region it is moved to the exit and its
// velocity is re-oriented by the difference between the two mouths' rotations,
// speed preserved (Verlet: transform both pos and prev, so pos-prev rotates with
// it). This module is PURE (no tldraw / framework deps) so the transform + region
// math stays unit-testable, mirroring physics.ts / checkpoints.ts. tldraw arrows
// and their bound geo shapes are turned into these in geometry.ts.

import type { Body, Vec2 } from './physics'

/**
 * One portal mouth: an oriented (possibly rotated) box in page space, plus the
 * rotation used to re-aim the exit velocity. Same box representation as a
 * Checkpoint so the entrance region reuses the point-in-oriented-box test.
 */
export interface PortalMouth {
	/** Box center in page space (the teleport source / destination point). */
	cx: number
	cy: number
	/** Half-width / half-height along the box's own (unrotated) axes. */
	halfW: number
	halfH: number
	/** Box rotation in radians (the source geo shape's page rotation). */
	rotation: number
}

/**
 * A directional portal: enter `entrance`, emerge at `exit`. `scale` is the
 * exit/entrance size ratio, carried for the future scale-portal ("shrink /
 * grow") variant; v1 always builds it as 1 and the teleport ignores it.
 */
export interface Portal {
	/** Stable id (the source arrow's id), for debugging / dedupe. */
	id: string
	entrance: PortalMouth
	exit: PortalMouth
	/** Exit-over-entrance scale factor. 1 for a same-size portal (v1). */
	scale: number
}

/** True when point `p` lies within a mouth's oriented box (inclusive). */
export function pointInMouth(p: Vec2, m: PortalMouth): boolean {
	// Translate into the box's local frame, rotate by -rotation to axis-align,
	// then compare against the half-extents. (Same math as pointInCheckpoint.)
	const dx = p.x - m.cx
	const dy = p.y - m.cy
	const cos = Math.cos(-m.rotation)
	const sin = Math.sin(-m.rotation)
	const localX = dx * cos - dy * sin
	const localY = dx * sin + dy * cos
	return Math.abs(localX) <= m.halfW && Math.abs(localY) <= m.halfH
}

/**
 * Teleport the whole rig through `portal`: map every point (and its Verlet
 * `prev`) from the entrance frame to the exit frame. The mapping is
 *
 *     p' = exit.center + R * (p - origin)
 *
 * with R the rotation by (exit.rotation - entrance.rotation) and `origin` the
 * body's center *at the moment of teleport* (not the entrance mouth's center —
 * see below). Applying it to BOTH pos and prev preserves speed and rotates the
 * velocity by the same R (since velocity is encoded as pos - prev), so a
 * straight-through portal (equal rotations) is a pure translation that keeps
 * the sled's heading, while a rotated exit re-aims the launch.
 *
 * Using `origin` (the body's own center) rather than the entrance mouth's
 * center anchors the rig's center exactly on `exit.center` every time,
 * regardless of where inside the entrance box the crossing was detected.
 * Detection is a per-substep point sample (see runController.stepFixed), not a
 * boundary sweep, so at high speed the body's center can land anywhere inside
 * the entrance box on the substep that trips it — near an edge, a corner, or
 * dead center — rather than right at the boundary. Mapping from the entrance
 * box's center would carry that arbitrary offset into the exit frame, which
 * could exceed the exit mouth's own (possibly smaller) half-extents and pop
 * the rider out past its visible bounds. Anchoring on the body's actual center
 * instead makes the exit position deterministic (always `exit.center`) while
 * still preserving the rig's own shape (other points keep their offset from
 * the center, rotated by R). Rigid (scale ignored) in v1. Mutates and returns
 * the body.
 */
export function teleportBody(body: Body, portal: Portal, origin: Vec2): Body {
	const dTheta = portal.exit.rotation - portal.entrance.rotation
	const cos = Math.cos(dTheta)
	const sin = Math.sin(dTheta)
	const map = (x: number, y: number): Vec2 => {
		const rx = x - origin.x
		const ry = y - origin.y
		return {
			x: portal.exit.cx + (rx * cos - ry * sin),
			y: portal.exit.cy + (rx * sin + ry * cos),
		}
	}
	for (const pt of body.points) {
		const pos = map(pt.pos.x, pt.pos.y)
		const prev = map(pt.prev.x, pt.prev.y)
		pt.pos.x = pos.x
		pt.pos.y = pos.y
		pt.prev.x = prev.x
		pt.prev.y = prev.y
	}
	return body
}
