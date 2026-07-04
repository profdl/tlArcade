/**
 * FISH VARIANT
 * ============
 * The reference creature variant, ported 1:1 from the original `creatureFish`
 * geometry so the look users already like is preserved exactly. A fish is modelled
 * as TWO kinematic chains in one shared local coordinate space spanning
 * [0,0]→[w,h] (see types.ts for the contract):
 *
 *   chains[0] — the BODY, a 'spine' chain: a head-heavy teardrop sliced into 3
 *               overlapping segments by `buildChain` from a spine curve + a radius
 *               profile. This MUST be index 0 (the renderer roots every other
 *               chain's phase off it and rides the eye on it).
 *   chains[1] — the TAIL, a 'trailer' chain built BY HAND: a single forked caudal
 *               fin polygon ring that pivots about the join point so it sweeps
 *               behind the body with a larger amplitude.
 *
 * Everything here is PURE and DETERMINISTIC in (w, h, seed): no Math.random, no
 * Date. `seed` only nudges the spine wiggle frequency, so every client draws the
 * identical fish. The renderer does NOT translate segments — they line up at rest
 * purely by their coordinates, which is why the spine + radius + tail ring all
 * speak the same [0,0]→[w,h] space.
 */
import type { CreatureVariant, CreatureGeometry, Chain, Pt } from './types'
import { buildChain } from './geometry'

/**
 * Build the rest-pose geometry of one fish at the given size + seed.
 */
function geometry(w: number, h: number, seed: number): CreatureGeometry {
	// --- Body extents, all in shared local coords -----------------------------
	const x0 = w * 0.06 // nose (u = 0)
	const xPed = w * 0.78 // caudal peduncle: where the body meets the tail (u = 1)
	const len = xPed - x0 // body length the spine is parameterised over
	const cy = h * 0.5 // centre-line height
	const freq = 2.2 + seed * 1.5 // gentle resting wiggle; seed-varied so fish differ

	// Rest-pose spine: a near-horizontal centre line with a faint sinusoidal sway
	// so the silhouette isn't a dead-straight ruler. u ∈ [0,1] runs nose → tail.
	const spine = (u: number): Pt => ({
		x: x0 + u * len,
		y: cy + h * 0.04 * u * Math.sin(freq * u),
	})

	// Head-heavy teardrop radius: fat near the front (the `0.62 + 0.06` shifts the
	// bulge forward), tapering to almost nothing at the tail (the `1 - 0.78*u` term).
	const radius = (u: number): number => {
		const fat = Math.pow(Math.sin(Math.PI * Math.min(1, u * 0.62 + 0.06)), 0.8)
		return h * 0.34 * fat * (1 - 0.78 * u)
	}

	// --- chains[0]: the body spine (3 overlapping segments) -------------------
	// buildChain sets anchor = spine(0) and joints on the spine automatically.
	const body = buildChain(spine, radius, 3, {
		role: 'spine',
		amp: 4, // modest per-segment swing; renderer multiplies by (i+1)
		phaseLag: 0.7, // each segment trails the prior so a wave flows down the body
		phaseOffset: 0,
		overlap: 0.08, // segments overlap so the seams hide when the body bends
	})

	// --- chains[1]: the forked caudal fin, built by hand ----------------------
	// We want the tail to pivot at the JOIN point (where it meets the body), not at
	// the body's nose, so we construct the Chain explicitly rather than via buildChain.
	const pedY = spine(1).y // peduncle height (end of the body spine)
	const uJoin = 0.97 // sample the body just shy of the tail for the join geometry
	const xJoin = x0 + uJoin * len
	const joinR = radius(uJoin) // body half-thickness at the join (fin root height)
	const joinY = spine(uJoin).y
	const finX = w * 0.99 // outermost tip of the tail fin
	const innerX = xPed + (finX - xPed) * 0.45 // the notch between the two fin lobes

	// One closed ring: top fin root → upper lobe tip → inner notch → lower lobe tip
	// → bottom fin root. Closing back to the roots makes the classic forked fluke.
	const tailRing: Pt[] = [
		{ x: xJoin, y: joinY - joinR },
		{ x: finX, y: pedY - h * 0.3 },
		{ x: innerX, y: pedY },
		{ x: finX, y: pedY + h * 0.3 },
		{ x: xJoin, y: joinY + joinR },
	]

	const tail: Chain = {
		segments: [tailRing],
		joints: [{ x: xJoin, y: joinY }], // pivot at the join so the fin sweeps behind
		role: 'trailer',
		amp: 16, // big sweep — the tail does most of the visible motion
		phaseLag: 0,
		phaseOffset: 0,
		anchor: { x: xJoin, y: joinY },
		// Nest the tail in the body's LAST segment so it inherits the body's bend and
		// stays welded to the rear of the body as it undulates (instead of detaching).
		attachToChain: 0,
	}

	// --- Eye: a single dot riding the body spine (chain 0) --------------------
	// Sat just above the centre line near the front of the head.
	const dots = [
		{
			at: { x: x0 + 0.1 * len, y: spine(0.1).y - radius(0.1) * 0.25 },
			r: 0.9, // multiplier of strokeWidth
			chain: 0,
		},
	]

	return { chains: [body, tail], dots }
}

export const fishVariant: CreatureVariant = {
	geometry,
	// Fish undulate: a wave flows down the spine and the tail trailer sweeps behind.
	motion: { style: 'undulate', beatScale: 1 },
}
