/**
 * LINE-FISH VARIANT  (the fish, reduced to its centreline)
 * ========================================================
 * The fish variant drawn as a single LINE down its spine instead of a filled body:
 * every chain segment is a CENTRELINE point-run (not an outline ring), and the
 * renderer paints it as an OPEN stroked polyline (variant.render = 'line'). So this
 * is the SAME creature in every other respect — same two-chain body+tail layout,
 * same spine curve, same joints, same 'undulate' motion — it just isn't filled.
 *
 * Because it reuses the creature renderer + animator + swim loop wholesale (it's a
 * `kind` on the creature shape, not its own shape type), there is no per-frame code
 * here: this file only describes the rest-pose centrelines. The body is the same
 * head-heavy spine as fish.ts (so a line-fish lines up with a creature-fish), but we
 * sample the CENTRE only — no radius profile, no back/belly edges.
 *
 * Everything is PURE and DETERMINISTIC in (w, h, seed) — no Math.random, no Date —
 * so every client draws the identical line-fish (CLAUDE.md gotcha #5).
 */
import type { CreatureVariant, CreatureGeometry, Chain, Pt } from './types'

/** How many rigid centreline segments the spine is sliced into. Matches the fish
 *  body's 3 so the bend reads the same; the renderer multiplies swing by (i+1). */
const BODY_SEGMENTS = 3
/** Points sampling each segment's centreline so the faint resting sway reads (a few
 *  is plenty — these are straight `L` segments, built once at mount). */
const SEG_STEPS = 4

/**
 * Sample the spine centreline over [uStart, uEnd] into a short point-run — the open
 * polyline the renderer strokes for this segment. (Mirrors the fish's spine; we just
 * keep the centre instead of offsetting ±radius into a ring.)
 */
function centreline(spine: (u: number) => Pt, uStart: number, uEnd: number): Pt[] {
	const pts: Pt[] = []
	for (let i = 0; i <= SEG_STEPS; i++) {
		const u = uStart + (uEnd - uStart) * (i / SEG_STEPS)
		pts.push(spine(u))
	}
	return pts
}

function geometry(w: number, h: number, seed: number): CreatureGeometry {
	// Body extents + spine: IDENTICAL to fish.ts so a line-fish and a creature-fish
	// share the same skeleton (only the paint differs).
	const x0 = w * 0.06 // nose (u = 0)
	const xPed = w * 0.78 // caudal peduncle: body meets tail (u = 1)
	const len = xPed - x0
	const cy = h * 0.5
	const freq = 2.2 + seed * 1.5 // gentle resting wiggle, seed-varied
	const spine = (u: number): Pt => ({
		x: x0 + u * len,
		y: cy + h * 0.04 * u * Math.sin(freq * u),
	})

	// --- chains[0]: the body spine, as overlapping CENTRELINE segments -------------
	// Same slicing + overlap as buildChain, but each segment is a centreline run, not
	// a ring. joints sit on the spine at each segment's start (its rotation hinge).
	const overlap = 0.08
	const segments: Pt[][] = []
	const joints: Pt[] = []
	for (let i = 0; i < BODY_SEGMENTS; i++) {
		const uStart = i / BODY_SEGMENTS
		const uEnd = Math.min(1, (i + 1) / BODY_SEGMENTS + overlap)
		segments.push(centreline(spine, uStart, uEnd))
		joints.push(spine(uStart))
	}
	const body: Chain = {
		segments,
		joints,
		role: 'spine',
		amp: 4, // match the fish body's modest per-segment swing
		phaseLag: 0.7, // a wave flows head→tail
		phaseOffset: 0,
		anchor: spine(0),
	}

	// --- chains[1]: the tail, a single OPEN line from the join out to the tip -------
	// The fish's forked-fluke polygon becomes one straight centreline continuing past
	// the peduncle to the tail tip — no fork (a line has no area to fork). It pivots at
	// the join and nests in the body's last segment, exactly like the fish tail.
	const xJoin = x0 + 0.97 * len
	const joinY = spine(0.97).y
	const tailX = w * 0.99
	const tail: Chain = {
		segments: [[{ x: xJoin, y: joinY }, { x: tailX, y: cy }]],
		joints: [{ x: xJoin, y: joinY }],
		role: 'trailer',
		amp: 16, // big sweep — the tail does most of the visible motion (same as fish)
		phaseLag: 0,
		phaseOffset: 0,
		anchor: { x: xJoin, y: joinY },
		attachToChain: 0,
	}

	// --- Eye: same dot near the head as the fish, riding the body spine -------------
	const dots = [
		{ at: { x: x0 + 0.1 * len, y: spine(0.1).y - h * 0.12 }, r: 0.9, chain: 0 },
	]

	return { chains: [body, tail], dots }
}

export const lineFishVariant: CreatureVariant = {
	geometry,
	// Same swim as the fish: a wave flows down the spine, the tail sweeps behind.
	motion: { style: 'undulate', beatScale: 1 },
	// The ONE thing that makes it a line: paint chains as open centrelines, not fills.
	render: 'line',
}
