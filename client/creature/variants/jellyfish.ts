/**
 * JELLYFISH VARIANT
 * =================
 * A drifting jellyfish: a domed BELL up top that rhythmically PUMPS, with a few
 * thin TENTACLES hanging from its rim that curl out of sync. Modelled as several
 * kinematic chains in one shared local space spanning [0,0]→[w,h] (see types.ts):
 *
 *   chains[0] — the BELL, a 'spine' chain built BY HAND as a single half-ellipse
 *               (mushroom-cap) ring. It MUST be index 0. Under motion style 'pulse'
 *               the renderer BOBS this segment UP/DOWN and squashes it (flatter as it
 *               pushes down, rounder as it rises) about `anchor` — real jellyfish
 *               locomotion. One segment; `anchor` is the bell CENTRE (the squash pivot).
 *   chains[1..] — TENTACLES, 'trailer' chains. Each runs top→bottom (its spine goes
 *               DOWN in y), so we can't use the shared `ring()` helper (that offsets
 *               thickness in ±y, which for a vertical spine would run ALONG the chain,
 *               not across it). Instead each tentacle segment is a thin ring built by
 *               hand with ±x thickness. Under 'pulse' the renderer SYNCS them to the
 *               bell's bob (same sin(beat) cycle): they ride its vertical travel and
 *               sweep out as it rises / gather as it pushes down. phaseLag whips each
 *               segment down the chain; phaseOffset keeps tentacles from being identical.
 *
 * Everything is PURE and DETERMINISTIC in (w, h, seed): no Math.random, no Date —
 * `rand(seed, i)` only nudges each tentacle's phase so individuals differ. The
 * renderer does NOT translate segments; they line up at rest purely by coordinates,
 * which is why bell + tentacles all speak the same [0,0]→[w,h] space.
 */
import type { CreatureVariant, CreatureGeometry, Chain, Pt } from './types'
import { rand } from './geometry'

// ── Tunables (kept tiny + readable for vibe-coding interns) ───────────────────
const TENTACLE_COUNT = 4 // 3–5 reads well; 4 keeps the path count efficient
const SEGS_PER_TENTACLE = 3 // each tentacle nests into a drifting curl
const BELL_SAMPLES = 16 // smoothness of the dome outline (built once, cheap)

/**
 * Build the rest-pose geometry of one jellyfish at the given size + seed.
 */
function geometry(w: number, h: number, seed: number): CreatureGeometry {
	// --- Bell extents, all in shared local coords -----------------------------
	const cx = w * 0.5 // horizontal centre (bell is centred)
	const bellTop = h * 0.05 // top of the dome
	const bellBottom = h * 0.45 // rim height: bell occupies roughly the top 45%
	const bellRx = w * 0.42 // horizontal radius of the dome
	const bellH = bellBottom - bellTop // vertical extent of the dome
	const rimY = bellBottom // tentacles hang from here

	// The pump pivot: the bell's centre. The 'pulse' animator scales segment 0 of
	// chains[0] about THIS point, so placing it mid-dome makes the cap breathe in
	// place rather than sliding.
	const bellAnchor: Pt = { x: cx, y: (bellTop + bellBottom) * 0.5 }

	// --- chains[0]: the BELL — one half-ellipse (mushroom cap) ring ------------
	// Top arc: a smooth dome from left rim → apex → right rim. Bottom edge: a gently
	// scalloped underside that closes the ring. Built by hand (not buildChain) so we
	// control the anchor and the dome shape.
	const top: Pt[] = []
	for (let i = 0; i <= BELL_SAMPLES; i++) {
		// t ∈ [0,1] sweeps left rim → right rim; angle θ ∈ [π,0] across the dome.
		const t = i / BELL_SAMPLES
		const theta = Math.PI * (1 - t)
		top.push({ x: cx - bellRx * Math.cos(theta), y: bellBottom - bellH * Math.sin(theta) })
	}
	// Underside: scalloped rim (a few shallow lobes) closing right rim → left rim.
	const bottom: Pt[] = []
	const lobes = 4
	for (let i = 0; i <= BELL_SAMPLES; i++) {
		const t = 1 - i / BELL_SAMPLES // right → left
		const x = cx - bellRx * Math.cos(Math.PI * (1 - t))
		// shallow scallops along the rim; deepest mid-span, flat at the edges.
		const scallop = Math.sin(Math.PI * t) * h * 0.04 * Math.abs(Math.cos(lobes * Math.PI * t))
		bottom.push({ x, y: rimY + scallop })
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
	const span = bellRx * 0.7 // roots clustered near the centre (was 1.4 — too spread)
	const tentLen = (h - rimY) * 1.5 // long, trailing tentacles (extend past the box;
	// the shape's <svg> is overflow:visible so they're not clipped)
	for (let t = 0; t < TENTACLE_COUNT; t++) {
		// Evenly spread the roots across the rim span, centred on cx. (Math.max guards
		// the single-tentacle case so we never divide by zero.)
		const frac = t / Math.max(1, TENTACLE_COUNT - 1)
		const rootX = cx - span * 0.5 + span * frac
		const segLen = tentLen / SEGS_PER_TENTACLE
		// Slight horizontal drift away from centre so outer tentacles splay outward.
		const drift = (rootX - cx) * 0.12

		const segments: Pt[][] = []
		const joints: Pt[] = []
		for (let s = 0; s < SEGS_PER_TENTACLE; s++) {
			const y0 = rimY + s * segLen
			const y1 = rimY + (s + 1) * segLen + (s < SEGS_PER_TENTACLE - 1 ? segLen * 0.12 : 0) // overlap neighbour
			const x0 = rootX + drift * s
			const x1 = rootX + drift * (s + 1)
			// Taper thin toward the tip: half-width shrinks down the chain.
			const r0 = Math.max(0.8, w * 0.018 * (1 - s / SEGS_PER_TENTACLE))
			const r1 = Math.max(0.6, w * 0.018 * (1 - (s + 1) / SEGS_PER_TENTACLE))
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
			amp: 5 + rand(seed, t) * 3, // modest 5–8° so they drift, not flail
			phaseLag: 0.6, // each segment trails the one above ⇒ a curl flows down
			phaseOffset: t * 0.8 + rand(seed, t), // stagger so tentacles don't sync
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
	// Slow, graceful pulsing: the bell pumps, the tentacles drift behind it.
	motion: { style: 'pulse', beatScale: 0.6 },
}
