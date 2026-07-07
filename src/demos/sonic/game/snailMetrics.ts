// Pure geometry of the snail character — no React/JSX/tldraw, so both the art
// (SnailArt.tsx) and the pure physics sim (physics.ts) can import it. This is the
// single source of truth for the snail's placed size, factored out of SnailArt so
// physics can DERIVE the rig's collision radius from the drawn silhouette instead
// of carrying a hand-tuned magic number kept in sync by a dev-only warning.

// Source art box (from snail.svg's viewBox), in the SVG's absolute page space.
export const SRC = {
	x: 498.21846771077793,
	y: 286.65631950196723,
	w: 69.45903235230732,
	h: 54.1944535310243,
}

// Target on-canvas size of the snail, in page px. Comfortably larger than the
// runner base so the character reads, while its belly aligns to the track line.
export const SNAIL_LEN = 64

// Uniform scale that maps the source width to the target length.
export const SCALE = SNAIL_LEN / SRC.w

// Lift the art by a hair so the rounded belly kisses the line rather than sinking
// in. In source px (pre-SCALE); applied inside the art's scale() transform.
export const BELLY_LIFT = 3

// Translate (in source px) that puts the belly-midpoint at the local origin. The
// art's belly sits along the BOTTOM of its box (max y); its mid-x is the center.
export const TX = -(SRC.x + SRC.w / 2)
export const TY = -(SRC.y + SRC.h)

// Vertical distance (in placed page px) from the art's belly-origin UP to the
// visual center of the snail's box. The box is SRC.h tall, scaled by SCALE; its
// center sits half a box-height above the bottom (the belly), minus the small
// BELLY_LIFT we already raised the art by. The rig uses this to center the whole
// graphic on a point (e.g. the start marker) rather than its belly.
export const SNAIL_CENTER_OFFSET = (SRC.h / 2) * SCALE - BELLY_LIFT * SCALE

// Half the snail's drawn height, in placed page px. With the graphic centered on
// the rig center, the visible belly sits this far BELOW the center. Physics sizes
// the rig's collision reach to this so the body stops at the snail's silhouette
// instead of letting the art sink through lines (see PHYSICS.bodyRadius, which is
// derived from this).
export const SNAIL_HALF_HEIGHT = (SRC.h / 2) * SCALE
