// Client-side hit-test: is a page-space cursor on the object at its current pose,
// and if so, what body-local anchor did it grab?
//
// The authoritative hit-test (sim.ts `hitTestObject`) needs a live planck body,
// which only the DO has. The client must decide grab-vs-miss locally on mousedown
// (before any round-trip), so this reproduces the same math from the pose + the
// object's local convex pieces (published in objShapeAtom).
//
// CONVENTIONS (must match sim.ts exactly so the anchor means the same thing on the
// server):
//  - pieces are LOCAL PAGE PX relative to the body origin, +y DOWN (as rendered).
//  - a Pose is page-space: center (px) + angle (radians, cw-positive, +y down —
//    the same convention SVG rotate() and the overlay use).
//  - the returned anchor is BODY-LOCAL PLANCK METERS, +y UP (÷ PX_PER_M, y flipped)
//    — identical to what sim.ts `hitTestObject` returns, which is what the DO's
//    `applyGrabs` (via getWorldPoint) expects.

import { PX_PER_M, type Vec2 } from './geometry'
import type { Pose, ObjectShape } from './sim'

/** Even-odd point-in-polygon in the polygon's own units (page px). */
function pointInPolygon(pt: Vec2, poly: Vec2[]): boolean {
	let inside = false
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const a = poly[i]
		const b = poly[j]
		const intersects =
			a.y > pt.y !== b.y > pt.y &&
			pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x
		if (intersects) inside = !inside
	}
	return inside
}

/**
 * Hit-test a page-space point against the posed object. Returns the body-local
 * anchor in PLANCK METERS (+y up) if the point lies on any piece, else null.
 *
 * Steps: page → body-local page px (translate by −center, un-rotate by −angle) →
 * point-in-polygon against each piece → convert the local px point to planck
 * meters (y-flip). Un-rotating by −angle is correct because the overlay rotates
 * the local pieces by +angle to render them (page cw-positive), so the inverse
 * maps a page point back into the piece's local frame.
 */
export function hitTestLocal(shape: ObjectShape, pose: Pose, pagePoint: Vec2): Vec2 | null {
	const dx = pagePoint.x - pose.x
	const dy = pagePoint.y - pose.y
	// Un-rotate by the pose angle (rotate by −angle). Page angle is cw-positive with
	// +y down, so a standard rotation matrix by −angle inverts the render rotation.
	const cos = Math.cos(-pose.angle)
	const sin = Math.sin(-pose.angle)
	const localPx: Vec2 = { x: dx * cos - dy * sin, y: dx * sin + dy * cos }

	for (const piece of shape.pieces) {
		if (pointInPolygon(localPx, piece)) {
			// Local page px (+y down) → body-local planck meters (+y up).
			return { x: localPx.x / PX_PER_M, y: -localPx.y / PX_PER_M }
		}
	}
	return null
}
