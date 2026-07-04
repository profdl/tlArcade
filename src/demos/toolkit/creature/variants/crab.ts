/**
 * CRAB VARIANT
 * ============
 * A wide, flat carapace with eight twitching limbs — the test case for a
 * NON-fish silhouette (lots of chains) driven by the 'scuttle' motion style.
 *
 * HOW THE RENDERER ANIMATES A CRAB (read this before tweaking numbers):
 *   chains[0] — the CARAPACE BODY, a 'spine' chain. Under 'scuttle' the animator
 *               barely rotates the spine (it just bobs gently), so the body should
 *               be ~1 segment and effectively still. It MUST be index 0 (the
 *               renderer roots phases off it and rides the eyes on it).
 *   chains[1..] — the LIMBS, each a 'limb' chain (legs + front claws). The animator
 *               rotates each limb segment about its joint by
 *                   sin(phase + phaseOffset - i*phaseLag) * amp * (i+1).
 *               Giving each limb a DIFFERENT phaseOffset makes them twitch OUT OF
 *               PHASE — that's the scuttle. We alternate 0 vs π (a tripod-gait
 *               feel) plus a small per-leg jitter from rand(seed, …).
 *
 * COORDINATE SPACE (the subtle bit): the renderer does NOT translate segments — it
 * only rotates each chain's nested <g>s about their joints. So a leg's joints AND
 * its segments must ALREADY sit at the body side in the shared [0,0]→[w,h] space.
 * A leg's hip (joints[0] / anchor) is on the carapace edge, and its spine runs from
 * that hip outward (and slightly down). `buildChain` builds exactly that from a
 * spine line + a thin taper, with anchor = spine(0) = the hip.
 *
 * Everything is PURE + DETERMINISTIC in (w, h, seed): no Math.random, no Date —
 * jitter comes from rand(seed, i), so every client draws the identical crab.
 */
import type { CreatureVariant, CreatureGeometry, Chain, Pt } from './types'
import { buildChain, ring, rand } from './geometry'

/**
 * Build the rest-pose geometry of one crab at the given size + seed.
 */
function geometry(w: number, h: number, seed: number): CreatureGeometry {
	// --- Carapace extents, all in shared local coords -------------------------
	// A wide flat oval: ~60% of the width, ~50% of the height, centred. The body
	// is drawn as an oval ring spanning bodyX0→bodyX1 with an elliptical radius.
	const cx = w * 0.5
	const cy = h * 0.5
	const bodyHalfW = w * 0.3 // → carapace spans 60% of the width
	const bodyHalfH = h * 0.25 // → carapace spans 50% of the height (flatter than wide)
	const bodyX0 = cx - bodyHalfW
	const bodyX1 = cx + bodyHalfW

	// --- chains[0]: the carapace, ONE oval-ring segment -----------------------
	// Spine runs straight across the width at mid-height; the radius is the upper
	// half of an ellipse so `ring` (which lays thickness as ±y) traces a full oval.
	const bodySpine = (u: number): Pt => ({ x: bodyX0 + u * (bodyX1 - bodyX0), y: cy })
	const bodyRadius = (u: number): number => bodyHalfH * Math.sqrt(Math.max(0, 1 - (2 * u - 1) ** 2))
	const carapace: Chain = {
		segments: [ring(bodySpine, bodyRadius, 0, 1)],
		joints: [{ x: cx, y: cy }], // pivots about its own centre (just a gentle bob)
		role: 'spine',
		amp: 1.5, // tiny — the scuttle animator keeps the body nearly still
		phaseLag: 0,
		phaseOffset: 0,
		anchor: { x: cx, y: cy },
	}

	// --- chains[1..8]: the limbs ---------------------------------------------
	// Three pairs of walking legs + one front pair of claws. We mirror left/right
	// with one helper so the code stays DRY. Each leg's hip sits on the carapace
	// edge; the leg runs outward (±x) and angles DOWN (+y) like a real crab stance.
	//
	// We stagger phaseOffset per leg index so adjacent legs twitch out of phase:
	// even legs use 0, odd legs use π (the tripod-gait alternation), plus a small
	// rand(seed, …) jitter so no two crabs scuttle identically.
	const limbs: Chain[] = []
	let limbIndex = 0

	/**
	 * Build one tapered limb chain.
	 *   hip   — where it attaches on the carapace (its pivot / anchor).
	 *   dir   — +1 for the right side, -1 for the left (legs point that way).
	 *   reach — how far out the limb extends, as a fraction of the box width.
	 *   drop  — how far DOWN the tip drops, as a fraction of the box height.
	 *   thick — base half-thickness of the limb (claws are thicker).
	 *   segs  — segment count (2–3; claws get the extra segment for the pincer).
	 *   pincer— if set, the limb ends in a small fattened claw tip.
	 */
	function addLimb(
		hip: Pt,
		dir: 1 | -1,
		reach: number,
		drop: number,
		thick: number,
		segs: number,
		pincer: boolean
	): void {
		const tip: Pt = { x: hip.x + dir * w * reach, y: hip.y + h * drop }
		const legSpine = (u: number): Pt => ({
			x: hip.x + (tip.x - hip.x) * u,
			y: hip.y + (tip.y - hip.y) * u,
		})
		// Thin tapered profile: a touch fatter at the hip, tapering toward the tip —
		// unless it's a claw, which swells back up near the end into a pincer.
		const legRadius = (u: number): number => {
			if (pincer && u > 0.7) return thick * 1.4 * (1 - (u - 0.7)) // bulge then close
			return thick * (1 - 0.55 * u)
		}

		// Alternate phase per limb for the out-of-phase scuttle, plus a small jitter.
		const phaseOffset = (limbIndex % 2 === 0 ? 0 : Math.PI) + (rand(seed, limbIndex) - 0.5) * 0.6

		limbs.push(
			buildChain(legSpine, legRadius, segs, {
				role: 'limb',
				amp: 12 + rand(seed, limbIndex + 100) * 6, // 12–18° visible twitch
				phaseLag: 0.3,
				phaseOffset,
				overlap: 0.12, // generous overlap so the thin seams stay hidden when bent
			})
		)
		limbIndex++
	}

	/** Add a mirrored left/right pair of limbs at the same vertical hip height. */
	function addPair(hipFracX: number, hipFracY: number, reach: number, drop: number, thick: number, segs: number, pincer: boolean): void {
		const yHip = cy + bodyHalfH * hipFracY
		// Right hip on the right edge of the carapace, left hip on the left edge.
		const rightHipX = cx + bodyHalfW * hipFracX
		const leftHipX = cx - bodyHalfW * hipFracX
		addLimb({ x: rightHipX, y: yHip }, 1, reach, drop, thick, segs, pincer)
		addLimb({ x: leftHipX, y: yHip }, -1, reach, drop, thick, segs, pincer)
	}

	// FRONT CLAWS: attach near the front-top edge, point forward/out, end in a
	// pincer, and are the thickest limbs. (Added first so they read as the "arms".)
	addPair(0.85, -0.55, 0.22, 0.1, h * 0.06, 3, true)

	// THREE PAIRS OF WALKING LEGS down the side of the carapace, each reaching out
	// and dropping a little further than the last for the splayed crab stance.
	addPair(0.95, -0.1, 0.26, 0.22, h * 0.035, 3, false)
	addPair(0.95, 0.25, 0.27, 0.3, h * 0.035, 3, false)
	addPair(0.85, 0.6, 0.24, 0.34, h * 0.035, 2, false)

	// --- Eyes: two small dots on the carapace (chain 0), near the front ---------
	const dots = [
		{ at: { x: cx - bodyHalfW * 0.3, y: cy - bodyHalfH * 0.35 }, r: 0.7, chain: 0 },
		{ at: { x: cx + bodyHalfW * 0.3, y: cy - bodyHalfH * 0.35 }, r: 0.7, chain: 0 },
	]

	return { chains: [carapace, ...limbs], dots }
}

export const crabVariant: CreatureVariant = {
	geometry,
	// Scuttle: the body bobs gently and the eight limbs twitch quickly, out of phase.
	motion: { style: 'scuttle', beatScale: 1.3 },
}
