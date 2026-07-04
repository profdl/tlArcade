/**
 * JELLYFISH VARIANT
 * =================
 * A drifting jellyfish: a domed BELL up top that rhythmically PUMPS, with a few
 * thin TENTACLES hanging from its rim that curl out of sync. Modelled as several
 * kinematic chains in one shared local space spanning [0,0]→[w,h] (see types.ts):
 *
 *   chains[0] — the BELL, a 'spine' chain built BY HAND as a single rounded-dome
 *               ring. It MUST be index 0. Under motion style 'pulse' the renderer
 *               drives JET PROPULSION: an ASYMMETRIC pump that CONTRACTS the bell
 *               (squeeze radially narrower + taller, jet forward) on a fast power
 *               stroke, then RELAXES it (open wide + round) on a slow recovery —
 *               scaled about `anchor` (the bell CENTRE / squeeze pivot). One segment.
 *   chains[1..] — TENTACLES, 'trailer' chains. Each runs top→bottom (its spine goes
 *               DOWN in y), so we can't use the shared `ring()` helper (that offsets
 *               thickness in ±y, which for a vertical spine would run ALONG the chain,
 *               not across it). Instead each tentacle segment is a thin ring built by
 *               hand with ±x thickness. Under 'pulse' the renderer TRAILS them behind
 *               the bell (the SAME pump envelope, a beat late): they recoil/bunch as
 *               the bell contracts and stream back out as it relaxes. phaseLag whips
 *               each segment down the chain; phaseOffset staggers them outward from
 *               centre so the trailing curtain ripples.
 *
 * Everything is PURE and DETERMINISTIC in (w, h, seed): no Math.random, no Date —
 * `rand(seed, i)` only nudges each tentacle's phase so individuals differ. The
 * renderer does NOT translate segments; they line up at rest purely by coordinates,
 * which is why bell + tentacles all speak the same [0,0]→[w,h] space.
 */
import type { CreatureVariant, CreatureGeometry, Chain, Pt } from './types'
import { rand } from './geometry'

// ── Tunables (kept tiny + readable for vibe-coding interns) ───────────────────
const TENTACLE_COUNT = 6 // a real jelly trails a fine curtain; 6 reads dense but cheap
const SEGS_PER_TENTACLE = 3 // each tentacle nests into a drifting curl
const BELL_SAMPLES = 18 // smoothness of the dome outline (built once, cheap)

/**
 * Build the rest-pose geometry of one jellyfish at the given size + seed.
 */
function geometry(w: number, h: number, seed: number): CreatureGeometry {
	// --- Bell extents, all in shared local coords -----------------------------
	// The reference animal is a TALL rounded dome (bullet/parachute), not a flat
	// mushroom cap, so the bell occupies more height and is narrower than the box.
	const cx = w * 0.5 // horizontal centre (bell is centred)
	const bellTop = h * 0.04 // top of the dome
	const bellBottom = h * 0.5 // rim height: bell occupies roughly the top half
	const bellRx = w * 0.38 // horizontal radius of the dome (narrower → taller read)
	const bellH = bellBottom - bellTop // vertical extent of the dome
	const rimY = bellBottom // tentacles hang from here

	// The pump pivot: the bell's centre. The 'pulse' animator scales segment 0 of
	// chains[0] about THIS point, so placing it mid-dome makes the cap breathe in
	// place rather than sliding.
	const bellAnchor: Pt = { x: cx, y: (bellTop + bellBottom) * 0.5 }

	// --- chains[0]: the BELL — one rounded-dome ring ---------------------------
	// Top arc: a smooth tall dome from left rim → apex → right rim, shaped with a
	// power curve so the apex is rounded (parachute) rather than a pointed half-
	// ellipse. Bottom edge: a smooth in-curved rim (the bell margin tucks slightly
	// UNDER, the way a real bell's lip does) closing the ring. Built by hand so we
	// control the anchor + dome shape.
	const top: Pt[] = []
	for (let i = 0; i <= BELL_SAMPLES; i++) {
		// t ∈ [0,1] sweeps left rim → right rim; angle θ ∈ [π,0] across the dome.
		const t = i / BELL_SAMPLES
		const theta = Math.PI * (1 - t)
		// Round the apex: ease the vertical profile (^0.8) so the crown is fuller.
		const dome = Math.pow(Math.sin(theta), 0.8)
		top.push({ x: cx - bellRx * Math.cos(theta), y: bellBottom - bellH * dome })
	}
	// Underside: a smooth lip that curves gently UP into the bell at the centre
	// (the hollow margin), closing right rim → left rim — no scallops, which read
	// as a sea-anemone, not a jellyfish.
	const bottom: Pt[] = []
	for (let i = 0; i <= BELL_SAMPLES; i++) {
		const t = 1 - i / BELL_SAMPLES // right → left
		const x = cx - bellRx * Math.cos(Math.PI * (1 - t))
		// Lift the underside up into the dome mid-span (deepest tuck at centre).
		const tuck = Math.sin(Math.PI * t) * h * 0.06
		bottom.push({ x, y: rimY - tuck })
	}
	const bellRing: Pt[] = [...top, ...bottom]

	const bell: Chain = {
		segments: [bellRing], // ONE segment so the pulse scales the whole cap as a unit
		joints: [bellAnchor], // (rotation hinge; pulse uses anchor for the scale pump)
		role: 'spine',
		amp: 2, // the spine barely waves under 'pulse' (renderer damps it further)
		phaseLag: 0,
		phaseOffset: 0,
		anchor: bellAnchor, // THE PUMP PIVOT — bell centre, per the 'pulse' contract
	}

	// --- chains[1..]: the TENTACLES, hanging from the rim ----------------------
	// Spread attach x-positions across the bell rim (inset from the very edges so they
	// hang from under the dome, not off its corners). Each tentacle is SEGS_PER_TENTACLE
	// thin segments running straight down, with a slight inward drift so they don't read
	// as stiff rods. Built by hand with ±x thickness (vertical spine ⇒ ring() won't do).
	const tentacles: Chain[] = []
	const span = bellRx * 1.3 // roots span most of the rim → a trailing curtain
	const tentLen = (h - rimY) * 2.2 // long, trailing tentacles (extend past the box;
	// the shape's <svg> is overflow:visible so they're not clipped)
	for (let t = 0; t < TENTACLE_COUNT; t++) {
		// Evenly spread the roots across the rim span, centred on cx. (Math.max guards
		// the single-tentacle case so we never divide by zero.)
		const frac = t / Math.max(1, TENTACLE_COUNT - 1)
		const rootX = cx - span * 0.5 + span * frac
		// Each tentacle is a slightly different length (outer ones a touch shorter),
		// so the curtain doesn't read as a flat fringe.
		const lenVar = tentLen * (0.78 + 0.22 * (1 - Math.abs(frac - 0.5) * 2) + rand(seed, t) * 0.15)
		const segLen = lenVar / SEGS_PER_TENTACLE
		// Slight horizontal drift away from centre so outer tentacles splay outward.
		const drift = (rootX - cx) * 0.1

		const segments: Pt[][] = []
		const joints: Pt[] = []
		for (let s = 0; s < SEGS_PER_TENTACLE; s++) {
			const y0 = rimY + s * segLen
			const y1 = rimY + (s + 1) * segLen + (s < SEGS_PER_TENTACLE - 1 ? segLen * 0.12 : 0) // overlap neighbour
			const x0 = rootX + drift * s
			const x1 = rootX + drift * (s + 1)
			// Taper hair-thin toward the tip: half-width shrinks down the chain. Real
			// tentacles are fine threads, so start narrow and fade to a point.
			const r0 = Math.max(0.5, w * 0.012 * (1 - (s / SEGS_PER_TENTACLE) * 0.85))
			const r1 = Math.max(0.4, w * 0.012 * (1 - ((s + 1) / SEGS_PER_TENTACLE) * 0.85))
			// A thin quad ring with ±x thickness (across the vertical spine).
			segments.push([
				{ x: x0 - r0, y: y0 },
				{ x: x1 - r1, y: y1 },
				{ x: x1 + r1, y: y1 },
				{ x: x0 + r0, y: y0 },
			])
			joints.push({ x: x0, y: y0 }) // hinge at the segment's top
		}

		tentacles.push({
			segments,
			joints,
			role: 'trailer',
			// Modest per-segment sweep. It's multiplied by (si+1) down the chain AND the
			// tentacles are long, so even small per-segment angles give a visible tip
			// excursion — keep this low so the OUTWARD CURL reads as a graceful trail, not
			// a wide side-to-side wag that swamps the up/down propulsion.
			amp: 1.8 + rand(seed, t) * 1, // 1.8–2.8°: a subtle bow; the up/down surge leads
			phaseLag: 0.5, // each segment trails the one above ⇒ a curl flows to the tip
			// Stagger by distance from centre so the curtain ripples outward (the
			// animator also widens the sweep of higher-offset tentacles).
			phaseOffset: Math.abs(frac - 0.5) * 4 + rand(seed, t), // stagger so they don't sync
			anchor: { x: rootX, y: rimY }, // attaches at its rim root
		})
	}

	// --- Eyes: two subtle spots on the bell (chain 0) -------------------------
	// Jellyfish have no eyes; a couple of faint sense-organ spots near the rim just
	// give the cap a little life. Small radius so they stay understated.
	const dots = [
		{ at: { x: cx - bellRx * 0.35, y: bellBottom - bellH * 0.25 }, r: 0.7, chain: 0 },
		{ at: { x: cx + bellRx * 0.35, y: bellBottom - bellH * 0.25 }, r: 0.7, chain: 0 },
	]

	return { chains: [bell, ...tentacles], dots }
}

export const jellyfishVariant: CreatureVariant = {
	geometry,
	// Slow, graceful jet-pulsing: a quick bell contraction, a long relaxed drift,
	// tentacles streaming behind. The pump envelope (CreatureShape) supplies the
	// fast-squeeze/slow-recover asymmetry; beatScale just sets the overall tempo.
	motion: { style: 'pulse', beatScale: 0.75 },
}
