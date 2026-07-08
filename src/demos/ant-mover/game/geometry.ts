// Ant-mover shared geometry CONSTANTS. Pure — NO tldraw / React / DOM imports,
// so it can sit in the sim.ts import chain that ports into the Durable Object at
// step 4 (the DO must not pull tldraw). The tldraw-dependent starter-layout seed
// lives in seed.ts instead.
//
// As of step 3a the maze and the movable object are NATIVE tldraw shapes, read
// into planck bodies at play-start (see shapes.ts / sim.ts). This file no longer
// hardcodes the physics geometry; it keeps only the px↔m scale, the Vec2 type,
// and the page-space FIELD/EXIT bounds used for camera framing + (later) scoring.
//
// planck uses meters, tldraw uses pixels. We pick a scale (PX_PER_M) and convert
// at the sim boundary; page-space coords stay in px, the human-legible unit.

/** Pixels per planck meter. Box2D is tuned for objects ~0.1–10 m; keeping the
 * object a few meters across (not a few hundred) keeps the solver in its happy
 * range. */
export const PX_PER_M = 30

export interface Vec2 {
	x: number
	y: number
}

/** The playfield the object is dragged across (page-space bounds, for camera
 * framing on mount). */
export const FIELD = { minX: 0, minY: 0, maxX: 1200, maxY: 800 }

/** The exit zone the object must reach to win (page space). Framing now, scored
 * in step 7. */
export const EXIT = { cx: 1050, cy: 400, halfW: 80, halfH: 120 }
