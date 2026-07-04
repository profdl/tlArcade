/**
 * SNAKE / EEL VARIANT
 * ===================
 * The "long & bendy" reference variant. Where the fish proves the kinematic chain
 * with 3 segments, the snake exists to prove it generalises to MANY bones: its body
 * is ONE 'spine' chain sliced into 6 overlapping segments, so a single traveling
 * wave can ripple all the way down a slender body. (See types.ts for the contract;
 * fish.ts for the worked 2-chain example.)
 *
 *   chains[0] — the BODY (the only chain): a long thin tube spanning ~2× the box
 *               width, with ROUNDED ends — the radius keeps a finite half-width at
 *               both tips, which the round strokeLinecap caps as smooth domes (rounded
 *               head AND tail, no pointy taper). MUST be index 0 — the renderer rides
 *               the eye on it. Many segments (12) carry a smooth wave down the length.
 *
 * Everything is PURE and DETERMINISTIC in (w, h, seed): no Math.random, no Date.
 * `seed` only nudges the rest-pose wave frequency (via `rand`), so every client
 * draws the identical snake. The renderer does NOT translate segments — they line up
 * at rest purely by their coordinates, which is why the spine + radius + tail ring
 * all live in the same [0,0]→[w,h] local space.
 */
import type { CreatureVariant, CreatureGeometry, Pt } from './types'
import { buildChain, rand } from './geometry'

/** Clamp a value into [lo, hi]. */
function clamp(v: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, v))
}

/**
 * Build the rest-pose geometry of one snake at the given size + seed.
 */
function geometry(w: number, h: number, seed: number): CreatureGeometry {
	// --- Body extents, all in shared local coords -----------------------------
	const x0 = w * 0.04 // nose (u = 0) — start near the left edge
	// Tail tip extends to ~2× the box width: a long serpent that trails past the
	// shape bounds (the shape's <svg> is overflow:visible, so it's not clipped; the
	// selection box still hugs the front). Doubled from the old w*0.96.
	const xEnd = w * 1.96
	const len = xEnd - x0 // body length the spine is parameterised over
	const cy = h * 0.5 // centre-line height
	// Gentle resting S-curve frequency, seed-varied so snakes differ. `rand` keeps it
	// deterministic (every client draws the identical creature).
	const freq = 3 + rand(seed, 0) * 1.5

	// Rest-pose spine: a long near-horizontal centre line with a faint multi-hump sway
	// so the silhouette reads as a relaxed serpent, not a straight rod. u ∈ [0,1] runs
	// nose → tail.
	const spine = (u: number): Pt => ({
		x: x0 + u * len,
		y: cy + h * 0.05 * Math.sin(freq * u),
	})

	// Slender, roughly-uniform tube with ROUNDED ends. We keep a finite half-width all
	// the way to both tips (a sine hump that bottoms out at `endR`, never 0), so the
	// outline has real width at the ends; the round strokeLinecap/join then caps them
	// as smooth domes — a rounded head AND a rounded tail, no pointy taper.
	const endR = h * 0.05 // half-width kept at the very ends (the roundness)
	const radius = (u: number): number =>
		endR + (h * 0.16 - endR) * Math.sin(Math.PI * clamp(u * 0.9 + 0.05, 0, 1))

	// --- chains[0]: the body spine (12 overlapping segments) ------------------
	// MANY bones is the whole point — and with the body now ~2× as long we use 12
	// segments (was 6) to keep the same bones-per-length, so the wave stays smooth
	// over the longer body. buildChain sets anchor = spine(0) and places joints on
	// the spine. NOTE: amp is multiplied by (i+1) down the chain, so with twice the
	// segments the rear would over-swing; we halve amp to keep the tail-end sweep sane.
	const body = buildChain(spine, radius, 12, {
		role: 'spine',
		amp: 3, // halved (was 6) because 12 segments × (i+1) would otherwise over-bend the tail
		phaseLag: 0.4, // smaller per-segment lag over more segments → a smooth full-body wave
		phaseOffset: 0,
		overlap: 0.08, // segments overlap so the seams hide when the body bends
	})

	// No separate tail fin: the rounded radius profile + round strokeLinecap give a
	// smooth domed tail on the body itself, so the snake is just the one body chain.

	// --- Eye: a single dot riding the body spine (chain 0) --------------------
	// Sat just above the centre line near the rounded head.
	const dots = [
		{
			at: { x: x0 + 0.08 * len, y: spine(0.08).y - radius(0.08) * 0.3 },
			r: 0.8, // multiplier of strokeWidth
			chain: 0,
		},
	]

	return { chains: [body], dots }
}

export const snakeVariant: CreatureVariant = {
	geometry,
	// Snakes undulate: a pronounced wave flows down the spine; a touch slower + more
	// serpentine than the fish.
	motion: { style: 'undulate', beatScale: 0.8 },
}
