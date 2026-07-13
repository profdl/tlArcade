/**
 * Pure two-bone (analytic) inverse kinematics — no tldraw imports, so it's
 * unit-testable in isolation. This is the classic law-of-cosines solution for a
 * 3-joint chain: root joint A → middle joint B → tip C, with fixed bone lengths.
 * Given a target for the tip, it returns the two bones' page-space angles.
 *
 * See ik.test.ts for the properties this guarantees (reachable exactness,
 * graceful clamping when out of reach, bend-sign mirroring).
 */

export interface Vec2 {
	x: number
	y: number
}

export interface TwoBoneSolution {
	/** Page-space angle (radians) of bone 1 (root→middle). */
	rootAngle: number
	/** Page-space angle (radians) of bone 2 (middle→tip). */
	effectorAngle: number
	/** False when the target was outside the reachable annulus and had to be clamped. */
	reachable: boolean
}

const EPS = 1e-6

function clamp(v: number, lo: number, hi: number): number {
	return v < lo ? lo : v > hi ? hi : v
}

/**
 * Solve a two-bone chain so its tip reaches `target` (or points at it, fully
 * extended, if unreachable).
 *
 * @param root    Page-space position of the root joint (fixed pivot, "shoulder"/"hip").
 * @param l1      Length of bone 1 (root→middle, "upper arm"/"thigh").
 * @param l2      Length of bone 2 (middle→tip, "forearm"/"shin").
 * @param target  Page-space position the tip should reach ("wrist"/"ankle").
 * @param bendSign +1 or -1 — which of the two mirror solutions to pick (elbow up vs down).
 *
 * Angles are page-space (y-down: atan2 with +y downward, 0 = +x/right). Because a
 * bone's local +x runs head→tail, these angles are exactly what to write to each
 * bone shape's page-space `rotation`.
 */
export function solveTwoBone(root: Vec2, l1: number, l2: number, target: Vec2, bendSign: 1 | -1): TwoBoneSolution {
	const dx = target.x - root.x
	const dy = target.y - root.y
	const rawDist = Math.hypot(dx, dy)

	// Reachable annulus: the tip can land anywhere between |l1 - l2| (fully folded)
	// and l1 + l2 (fully straight). Clamping here is what makes an out-of-reach
	// target degrade gracefully (limb points at it, maximally extended/folded)
	// instead of producing NaNs from acos of an out-of-domain value.
	const minReach = Math.abs(l1 - l2)
	const maxReach = l1 + l2

	// Direction from the root to the target.
	const baseAngle = Math.atan2(dy, dx)

	// Degenerate rig: if the reachable annulus has collapsed (a bone is ~0-length, so
	// minReach ≥ maxReach), there's no valid two-bone solution and the `dist` clamp
	// below would invert (lo > hi) and return silently-wrong angles. Point both bones
	// straight at the target instead — the least-surprising fallback. The rig never
	// emits a zero-length bone (props use T.nonZeroNumber), so this only guards callers
	// of the pure solver; keeping it here makes ik.ts self-contained and unit-safe.
	if (maxReach - minReach <= 2 * EPS) {
		return { rootAngle: baseAngle, effectorAngle: baseAngle, reachable: false }
	}

	const reachable = rawDist >= minReach - EPS && rawDist <= maxReach + EPS
	const dist = clamp(rawDist, minReach + EPS, maxReach - EPS)

	// Angle at the root between (root→target) and bone 1, via law of cosines.
	const cosShoulder = clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1)
	const shoulderOffset = Math.acos(cosShoulder)

	// Interior angle at the middle joint (between the two bones), via law of cosines.
	const cosElbow = clamp((l1 * l1 + l2 * l2 - dist * dist) / (2 * l1 * l2), -1, 1)
	const elbowInterior = Math.acos(cosElbow) // ∈ [0, π]; π = straight

	// bendSign chooses which side the middle joint bends toward (the two mirror
	// solutions). Bone 1 rotates off the base direction by the shoulder offset;
	// bone 2's page angle is bone 1's plus the signed turn (π − interior).
	const rootAngle = baseAngle - bendSign * shoulderOffset
	const effectorAngle = rootAngle + bendSign * (Math.PI - elbowInterior)

	return { rootAngle, effectorAngle, reachable }
}

/**
 * Given a rest pose (the two bones' current page angles), pick the bendSign that
 * matches the way the joint is currently bent, so a solve doesn't suddenly flip
 * the elbow/knee to its mirror. The sign is the sign of the turn from bone 1 to
 * bone 2 (cross product of the two direction vectors).
 */
export function bendSignFromRest(rootAngle: number, effectorAngle: number): 1 | -1 {
	const turn = normalizeAngle(effectorAngle - rootAngle)
	return turn >= 0 ? 1 : -1
}

/** Wrap an angle to (−π, π]. */
export function normalizeAngle(a: number): number {
	let r = a % (Math.PI * 2)
	if (r > Math.PI) r -= Math.PI * 2
	if (r < -Math.PI) r += Math.PI * 2
	return r
}
