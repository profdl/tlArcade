/**
 * CREATURE VARIANT CONTRACT
 * =========================
 * The shared interface every creature variant (fish, snake, jellyfish, crab, …)
 * conforms to, so ONE renderer + ONE animation loop drive them all. A variant
 * supplies pure GEOMETRY (rest-pose outlines, built once) + MOTION params (how the
 * renderer animates them via transforms). Nothing here knows about any specific
 * creature — that lives in the per-variant files in this folder.
 *
 * WHY THIS SHAPE: the renderer animates by mutating SVG-group `transform`s off the
 * React path (see CreatureShape.tsx). So a creature is modelled as a set of
 * PARTS, each a kinematic CHAIN of segments: each segment is a static outline that
 * rotates about its near JOINT, and because the chain's <g>s are nested, the
 * rotations compose into a continuous bend. A fish is one chain (body) + a tail
 * part; a crab is a body chain + several leg chains; a jellyfish is a bell part +
 * tentacle chains. This subsumes the original body+tail with no special-casing.
 */

export type Pt = { x: number; y: number }

/**
 * One kinematic chain (a body, a tail, a leg, a tentacle). `segments[i]` is a
 * closed outline ring drawn in shared local coords; `joints[i]` is the point
 * segment i rotates about. Segments should OVERLAP their neighbour slightly so the
 * seam hides when the chain bends (see the fish variant for the reference).
 */
export type Chain = {
	segments: Pt[][]
	joints: Pt[]
	/**
	 * How this chain animates, relative to the shared clock beat:
	 *   role 'spine'   — the main body; carries the turn-lean.
	 *   role 'trailer' — hangs off the body and follows it (tail, tentacle): bigger
	 *                    amplitude, phase trailing the body so motion flows outward.
	 *   role 'limb'    — a leg/appendage that twitches in place (crab scuttle).
	 */
	role: 'spine' | 'trailer' | 'limb'
	/** Per-segment swing amplitude in DEGREES (multiplied by (i+1) down the chain). */
	amp: number
	/** Per-segment phase lag in RADIANS (how much each segment trails the prior). */
	phaseLag: number
	/** Constant phase offset (radians) — stagger limbs/tentacles so they don't sync. */
	phaseOffset: number
	/**
	 * Where this chain attaches to the body, in shared local coords. The renderer
	 * positions the chain's group here and pivots the whole chain about joints[0].
	 * For the spine this is just its head; for limbs it's the hip/attach point.
	 */
	anchor: Pt
	/**
	 * Optional: index of the chain this one is RIGIDLY ATTACHED to. When set, this
	 * chain's <g> is NESTED inside the parent chain's LAST segment group, so it
	 * inherits the parent's full accumulated bend and stays joined to it as the
	 * parent moves (e.g. a fish tail must follow the body's rear segment — otherwise
	 * it detaches when the body undulates). When undefined the chain renders as a
	 * top-level sibling (the default, fine for limbs that attach to a near-static
	 * body). Attach to a chain with a LOWER index than this one (no cycles).
	 */
	attachToChain?: number
	/** IK WALK metadata for a 2-bone ant leg (see WalkLeg below); only ant legs set it. */
	walk?: WalkLeg
}

/**
 * WALK metadata for a 2-bone leg driven by INVERSE KINEMATICS (the ant). Unlike the
 * rotation-wave motion styles, a walking leg is SOLVED to plant its FOOT on a moving
 * target — the foot holds still on the ground through stance and snaps forward on the
 * swing — which is what reads as STEPPING instead of swimming. The animator's 'walk'
 * branch (walkLegTransform in CreatureShape.tsx) reads this to solve the hip + knee
 * angles each frame; the leg's two segments (femur about joints[0], tibia about
 * joints[1]) are rotated by the DELTA from this rest pose. Present only on ant legs.
 */
export type WalkLeg = {
	/** Hip (femur pivot) in local coords — = joints[0]. */
	hip: Pt
	/** Knee (tibia pivot) at REST — = joints[1]; sets the rest bone directions. */
	kneeRest: Pt
	/** Foot tip at REST — sets the rest tibia direction + the stance/swing path. */
	footRest: Pt
	/** Femur length (hip→knee) and tibia length (knee→foot), precomputed. */
	femurLen: number
	tibiaLen: number
	/** Tripod phase (radians): legs in the same tripod share a phase, the other tripod
	 *  is offset by π, so three feet are always planted. */
	phase: number
	/** Forward unit vector in local space (toward the head). Stance slides the foot
	 *  toward the REAR; the swing snaps it forward. */
	forward: Pt
}

/** A single static dot (eye, spot). Rides whichever chain index it's attached to. */
export type Dot = { at: Pt; r: number; chain: number }

/**
 * The full rest-pose geometry of a creature, in local coords spanning [0,0]→[w,h].
 * Pure function of (w, h, seed) — no time. Built once per shape; animated by the
 * renderer mutating transforms.
 */
export type CreatureGeometry = {
	/** All kinematic chains. chains[0] MUST be the body 'spine' (the renderer roots
	 *  every other chain's motion phase off it and rides the eye on it). */
	chains: Chain[]
	/** Eyes / spots, each pinned to a chain so they move with it. */
	dots: Dot[]
}

/**
 * How a variant's whole creature moves, read by the renderer's animation reactor.
 *   'undulate' — fish/snake: a wave flows down the spine; trailers sweep behind.
 *   'pulse'    — jellyfish: the bell contracts/expands rhythmically; tentacles drift.
 *   'scuttle'  — crab: body bobs slightly; limbs twitch out of phase.
 *   'walk'     — ant/insect: an alternating-TRIPOD gait. Legs swing fore↔aft along
 *                the body axis (protraction/retraction) in two interleaved tripods,
 *                their lower segments bending as they plant and push; antennae sweep.
 */
export type MotionStyle = 'undulate' | 'pulse' | 'scuttle' | 'walk'

export type MotionParams = {
	style: MotionStyle
	/** Multiplies the base beat rate for this variant (1 = same as the shared clock). */
	beatScale: number
}

/**
 * HOW the renderer PAINTS a variant's chains — the only thing that separates a
 * line-fish from a normal creature. Both share the identical geometry/animation/
 * swim machinery; they differ ONLY here:
 *   'fill' — each chain segment is a CLOSED silhouette ring, filled (the default —
 *            fish/snake/crab/etc. are solid bodies).
 *   'line' — each chain segment is drawn as an OPEN centreline polyline (no closing
 *            edge, stroked not filled), so the creature reads as a single drawn LINE
 *            that swims rather than a filled shape. A variant whose `segments` are
 *            centreline point-runs (not outline rings) sets this.
 */
export type RenderMode = 'fill' | 'line'

/**
 * A variant = a geometry generator + its motion params. Pure and stateless; the
 * generator is called once per shape (memoized on w/h/seed) and must be
 * deterministic in `seed` so every client draws the identical creature.
 */
export type CreatureVariant = {
	geometry: (w: number, h: number, seed: number) => CreatureGeometry
	motion: MotionParams
	/** How to paint the chains — see RenderMode. Defaults to 'fill' (a solid body)
	 *  when omitted; the line-fish variant sets 'line'. */
	render?: RenderMode
}
