/**
 * INK-FISH VARIANT  (the line-fish, re-inked with perfect-freehand)
 * ================================================================
 * SAME creature as the line-fish in EVERY structural way: identical centreline
 * geometry (we literally reuse lineFish's geometry generator — no new chains, no new
 * points), identical two-chain body+tail layout, identical 'undulate' motion, the
 * identical swim loop. The ONLY difference is how its centreline is PAINTED:
 *
 *   line-fish  →  render:'line'  →  each centreline run is stroked as an OPEN polyline
 *                                   (a uniform-width drawn line).
 *   ink-fish   →  render:'ink'   →  each centreline run is pushed through perfect-
 *                                   freehand's FILLED outline (getStroke) ONCE at build
 *                                   time, with a fat→thin PRESSURE taper, and FILLED.
 *
 * So the same one-line skeleton becomes a tapered, hand-inked BODY — fat at the head,
 * thinning to a pointed tail — which reads as a fish rather than a line. Because the
 * outline is built once (in the renderer's build-once memo, exactly where the 'draw'
 * freehand body already is) and animated only by transforms, it is EXACTLY as cheap as
 * the line-fish (CLAUDE.md gotcha #9): no extra animated nodes, no per-frame path work.
 *
 * Everything stays PURE and DETERMINISTIC in (w, h, seed) — the geometry is line-fish's,
 * the taper is a pure function of each point's x — so every client draws the identical
 * ink-fish (gotcha #5).
 */
import type { CreatureVariant } from './types'
import { lineFishVariant } from './lineFish'

export const inkFishVariant: CreatureVariant = {
	// Reuse the line-fish skeleton verbatim — NO extra geometry, by design.
	geometry: lineFishVariant.geometry,
	// Same swim as the fish/line-fish: a wave flows down the spine, the tail sweeps.
	motion: { style: 'undulate', beatScale: 1 },
	// The ONE difference from the line-fish: re-ink the centrelines as a filled,
	// tapered perfect-freehand body instead of stroking them as plain lines.
	render: 'ink',
}
