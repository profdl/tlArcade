/**
 * ANT VARIANT  (top-view walker)
 * ==============================
 * A top-down ant — the test case for a true WALKING gait. Where the crab just
 * twitches its limbs in place ('scuttle'), the ant uses the 'walk' motion style:
 * an alternating-TRIPOD gait where the six legs swing fore↔aft in two interleaved
 * sets of three, their lower segments bending as they plant and push (see the
 * `walk` branch in CreatureShape.tsx's animator). The antennae sweep gently.
 *
 * ANATOMY (all in the shared [0,0]→[w,h] local space, drawn HEAD-LEFT so forward
 * is −x — the convention every variant follows and the swim loop faces along):
 *   chains[0]  — the BODY 'spine': head (front/left) → thorax (mid) → a pinched
 *                PETIOLE waist → gaster/abdomen (rear/right, the big teardrop).
 *                One spine with a radius profile that bulges, pinches, bulges —
 *                the classic three-lobe ant silhouette. MUST be index 0 (the
 *                renderer roots phases off it and rides the eyes/antennae on it).
 *   chains[1..6] — the six LEGS, three mirrored pairs hinged on the THORAX. Each is
 *                a 2-segment 'limb' chain (femur → tibia) that reaches out and a
 *                little back, so a swing about the hip steps it fore/aft. They split
 *                into the two tripods via `phaseOffset` (0 vs π): front-left,
 *                mid-right, rear-left move together, opposite to the other three.
 *   chains[7..8] — the two ANTENNAE, thin 2-segment 'limb' chains on the HEAD that
 *                sweep slowly (small amp, slow lag) — a feeler twitch, not a step.
 *
 * COORDINATE SPACE (the subtle bit, same as crab): the renderer never translates
 * segments — it only ROTATES each chain's nested <g>s about their joints. So every
 * leg's joints AND segments must already sit at the body in local space: a leg's
 * hip (joints[0] / anchor) is on the thorax edge, and its spine runs from that hip
 * outward (and slightly toward the rear). `buildChain` builds exactly that.
 *
 * Everything is PURE + DETERMINISTIC in (w, h, seed) — jitter is rand(seed, i), no
 * Math.random / Date — so every client draws the identical ant.
 */
import type { CreatureVariant, CreatureGeometry, Chain, Pt } from './types'
import { buildChain, rand } from './geometry'

function geometry(w: number, h: number, seed: number): CreatureGeometry {
	const cy = h * 0.5

	// --- BODY: three EQUAL circles (head, thorax, gaster) -----------------------
	// The ant body is THREE identical circles laid out head-LEFT (forward = −x): head
	// at the front, thorax in the middle (the legs hang off this), gaster at the rear.
	// All on chain 0 so the eyes ride the head and the body stays one rigid 'spine'
	// (amp 0 → it doesn't bob; the legs do all the moving).
	const bodyR = h * 0.22 // shared radius — all three circles are the same size
	// Space the three centres evenly so the equal circles just touch/slightly overlap.
	const gap = bodyR * 1.7
	const headCx = w * 0.5 - gap
	const thoraxCx = w * 0.5
	const gasterCx = w * 0.5 + gap
	// Kept so the leg/eye code below (which references these) stays unchanged.
	const headR = bodyR
	const thoraxR = bodyR

	// A closed circle ring centred at (cx, cy) with radius r — sampled finely so it
	// reads smooth. Built once at mount, so the sample count is free.
	const circle = (cx: number, r: number): Pt[] => {
		const pts: Pt[] = []
		const STEPS = 40
		for (let i = 0; i < STEPS; i++) {
			const a = (i / STEPS) * Math.PI * 2
			pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r })
		}
		return pts
	}

	// The body chain: three equal circle segments, head → thorax → gaster.
	const body: Chain = {
		segments: [circle(headCx, bodyR), circle(thoraxCx, bodyR), circle(gasterCx, bodyR)],
		joints: [
			{ x: headCx, y: cy },
			{ x: thoraxCx, y: cy },
			{ x: gasterCx, y: cy },
		],
		role: 'spine',
		amp: 0, // rigid — the legs do the walking, the body just translates
		phaseLag: 0,
		phaseOffset: 0,
		anchor: { x: thoraxCx, y: cy },
	}

	// --- LEGS: three mirrored pairs on the thorax -------------------------------
	// Each leg hinges on the thorax edge and reaches OUT (±y) toward its fore/aft
	// station, so its rest pose splays like a real ant. It's a 2-bone chain — femur
	// (hip→knee) + tibia (knee→foot) — drawn with a slight bend so the IK has a
	// defined elbow. The 'walk' animator does NOT wave these; it SOLVES each leg to a
	// stepping FOOT TARGET (walkLegTransform), which is what reads as walking.
	//
	// TRIPOD ASSIGNMENT: a hexapod's stable gait alternates two tripods —
	//   tripod A = front-LEFT, mid-RIGHT, rear-LEFT   (gait phase 0)
	//   tripod B = front-RIGHT, mid-LEFT, rear-RIGHT  (gait phase π)
	// so three feet are always planted. `addLeg` takes the tripod's base phase, stored
	// as `walk.phase`; the animator advances all legs off the one shared beat.
	const legs: Chain[] = []
	let legIndex = 0

	/**
	 * Build one 2-segment leg.
	 *   hip      — attach point on the thorax (its pivot / anchor).
	 *   sideDir  — +1 for the LEFT side in screen terms? No — +1 reaches toward +y
	 *              (screen-down), −1 toward −y (screen-up). We pass the body side.
	 *   foreAft  — fraction of w the foot sits fore(−)/aft(+) of the hip, so legs
	 *              fan forward/back like an ant's stance (front legs reach ahead).
	 *   reach    — how far out (±y) the foot extends, as a fraction of h.
	 *   phase0   — this leg's tripod base phase (0 or π).
	 */
	function addLeg(hip: Pt, sideDir: 1 | -1, foreAft: number, reach: number, phase0: number): void {
		// The REST foot. The leg is drawn slightly BENT at the knee (a real ant leg is
		// a shallow 'Z'): the rest spine goes hip → knee → foot where the knee is kicked
		// OUTWARD from the straight hip→foot line, so the 2-bone IK has a defined elbow
		// to bend and never has to flip.
		const foot: Pt = { x: hip.x + foreAft * w, y: hip.y + sideDir * reach * h }
		const mid: Pt = { x: (hip.x + foot.x) / 2, y: (hip.y + foot.y) / 2 }
		// Kick the knee outward (further from the body in ±y) so the rest pose is bent.
		const knee: Pt = { x: mid.x, y: mid.y + sideDir * h * 0.06 }

		// Build the OUTLINE along hip → knee → foot (a bent spine) so the drawn leg has
		// a visible joint. u∈[0,0.5] is the femur, [0.5,1] the tibia.
		const legSpine = (u: number): Pt => {
			if (u <= 0.5) {
				const t = u / 0.5
				return { x: hip.x + (knee.x - hip.x) * t, y: hip.y + (knee.y - hip.y) * t }
			}
			const t = (u - 0.5) / 0.5
			return { x: knee.x + (foot.x - knee.x) * t, y: knee.y + (foot.y - knee.y) * t }
		}
		// Thin, tapering toward the foot — an ant leg is a fine filament.
		const legRadius = (u: number): number => h * 0.03 * (1 - 0.6 * u)
		// A hair of per-leg jitter so the gait isn't mechanically perfect.
		const jitter = (rand(seed, legIndex) - 0.5) * 0.4
		const chain = buildChain(legSpine, legRadius, 2, {
			role: 'limb',
			amp: 0, // unused for 'walk' (IK-driven); kept 0 so any fallback is inert
			phaseLag: 0,
			phaseOffset: 0,
			overlap: 0.15, // generous overlap so the thin knee seam stays hidden when bent
		})
		// buildChain put joints[0] at hip and joints[1] at the segment-1 start (u=0.5 =
		// the KNEE), exactly the two pivots the IK rotates about. Attach the walk data.
		chain.walk = {
			hip,
			kneeRest: knee,
			footRest: foot,
			femurLen: Math.hypot(knee.x - hip.x, knee.y - hip.y),
			tibiaLen: Math.hypot(foot.x - knee.x, foot.y - knee.y),
			phase: phase0 + jitter,
			forward: { x: -1, y: 0 }, // head is at −x (forward); stance slides the foot +x (rear)
		}
		legs.push(chain)
		legIndex++
	}

	/** A mirrored pair at one fore/aft station, split across the two tripods. The
	 *  `leftInA` flag picks which side joins tripod A (phase 0) vs B (phase π) so the
	 *  diagonal alternation comes out right (front-left + mid-right + rear-left). */
	function addPair(hipX: number, foreAft: number, reach: number, leftInA: boolean): void {
		const hipUp: Pt = { x: hipX, y: cy - thoraxR * 0.6 } // screen-up side
		const hipDn: Pt = { x: hipX, y: cy + thoraxR * 0.6 } // screen-down side
		const A = 0
		const B = Math.PI
		// "up" = one side, "down" = the other; leftInA decides which gets phase A.
		addLeg(hipUp, -1, foreAft, reach, leftInA ? A : B)
		addLeg(hipDn, 1, foreAft, reach, leftInA ? B : A)
	}

	// FRONT legs reach AHEAD (−x), REAR legs reach BEHIND (+x), middle legs straight
	// out — the natural ant splay. Alternate which side leads each tripod down the
	// body so the planted feet always form a stable triangle.
	addPair(thoraxCx - thoraxR * 0.5, -0.16, 0.34, true) // front pair
	addPair(thoraxCx, 0.0, 0.36, false) // middle pair
	addPair(thoraxCx + thoraxR * 0.5, 0.16, 0.34, true) // rear pair

	// --- ANTENNAE: two thin feelers on the head, sweeping slowly -----------------
	// They hinge near the front of the head and reach forward-out, ending with a
	// slight elbow (the classic geniculate ant antenna). Tiny amp + slow lag = a
	// gentle sweep, not a step. They're 'limb' chains so the 'walk' animator sweeps
	// them, but we keep amp small so they read as feelers.
	const antennae: Chain[] = []
	function addAntenna(sideDir: 1 | -1): void {
		const base: Pt = { x: headCx - headR * 0.3, y: cy + sideDir * headR * 0.4 }
		const tip: Pt = { x: base.x - w * 0.14, y: base.y + sideDir * h * 0.14 }
		const antSpine = (u: number): Pt => ({
			x: base.x + (tip.x - base.x) * u,
			y: base.y + (tip.y - base.y) * u,
		})
		const antRadius = (u: number): number => h * 0.022 * (1 - 0.5 * u)
		antennae.push(
			buildChain(antSpine, antRadius, 2, {
				role: 'limb',
				amp: 7, // small — a feeler sweep, not a stride
				phaseLag: 0.8,
				phaseOffset: sideDir > 0 ? 0.5 : -0.5, // the two feelers sweep slightly apart
				overlap: 0.18,
			})
		)
	}
	addAntenna(-1)
	addAntenna(1)

	// No eyes — the ant is a clean three-circle silhouette.
	return { chains: [body, ...legs, ...antennae], dots: [] }
}

export const antVariant: CreatureVariant = {
	geometry,
	// Walk: the alternating-tripod gait. beatScale a touch above 1 so the little
	// legs patter along at a brisk insect cadence.
	motion: { style: 'walk', beatScale: 1.4 },
}
