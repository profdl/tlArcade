/**
 * Busytown — verified configuration
 * ----------------------------------
 * Every number here was measured, not guessed. The sweep (6 seeds, ~10 min of
 * sim time each) showed 7 townsfolk + 4 birds lands at ~1.5–2 concurrent
 * interactions: something happening ~87% of the time, rarely a pile-up.
 *
 * Time unit is the TICK. The sim runs at TICK_MS below (~10 fps); the canvas is
 * synced at the same cadence. 1 tick ≈ 100 ms, so a duration of 20 ticks ≈ 2 s.
 *
 * What ports reliably: interaction CADENCE (geometry + timing). What won't
 * transfer 1:1: nothing fragile here — there's no equilibrium to collapse.
 * If you want to retune density without changing counts, the two live knobs
 * are interaction DURATION (longer dwell = more overlap) and GREET_RADIUS.
 */

export const TICK_MS = 100 // sim + canvas-sync cadence (10 fps). Do not raise.

/** Spatial scale of the whole scene. The "feel" sweep was measured at SCALE 1
 *  (1000×700). We render at SCALE 2 so sprites are big enough to carry tldraw's
 *  absolute Draw stroke weights (S/M/L/XL = 2/3.5/5/10 px). Only DISTANCES scale
 *  — speeds and radii scale with it, durations stay in ticks — so the verified
 *  interaction cadence is preserved. */
export const SCALE = 2

/** Movement. WALK crosses the 1000px canvas in ~125 ticks (~12.5 s) — a
 *  readable strolling pace. The van moves 1.6× faster along the path. */
export const MOVE = {
  WALK: 8.0 * SCALE, // px / tick
  VAN_SPEED_MULT: 1.6,
  ARRIVE_EPS: 8.0 * SCALE, // distance at which a mover counts as "arrived"
} as const

/** Whim weights — what a townsperson wants next when it re-rolls. Tuned so the
 *  social affordances (stall, benches) stay busy without crowding. Must sum 1. */
export const WHIM_WEIGHTS = {
  shop: 0.4,
  rest: 0.35,
  wander: 0.15,
  home: 0.1,
} as const

/** Durations (in ticks) and the proximity radii that fire interactions. These
 *  are the verified "feel" numbers and the main tuning surface. Ranges are
 *  [min, max] inclusive and get sampled per use to de-sync the loops. */
export const TIMING = {
  GREET_RADIUS: 45 * SCALE, // two walkers closer than this greet
  GREET_DUR: 20, // ~2 s pause + bubble
  GREET_COOLDOWN: 120, // before the same pair can greet again (~12 s)

  DWELL_BENCH: [60, 140] as [number, number], // seated; 2 on a bench => chat
  BENCH_CAPACITY: 2,
  DWELL_STALL: [10, 25] as [number, number], // buying
  WHIM_COOLDOWN: [15, 60] as [number, number], // idle gap between whims

  FLEE_RADIUS: 70 * SCALE, // bird bolts if a person/van is this close
  FLEE_DUR: 25,
  BIRD_PERCH: [200, 500] as [number, number], // perched before a voluntary hop

  VAN_RESTOCK_DUR: 18, // van parked at the stall, refilling
} as const

/** Stall stock. The van refills it to STALL_MAX; townsfolk decrement on "buy".
 *  This is a relay race that READS as commerce — nothing is conserved. */
export const STALL_MAX = 5

/** Birds flock to a seated person and ring around their feet (feeding). A
 *  WALKING person or the van still scares them off (FLEE_RADIUS); a SEATED
 *  person is an attractor, not a threat. */
export const BIRD = {
  FLY_SPEED: 11 * SCALE, // px/tick when flying to a feeder — quicker than a stroll
  FEED_RING: 26 * SCALE, // how far out the flock rings around the feet
  FEET_OFFSET: 18 * SCALE, // px below a person's centre ≈ their feet
} as const

// Scene identity — bounds, prop layout, and starting roster — is no longer a
// module constant. It lives in swappable SceneDefs under src/content/scenes/;
// the systems read scene bounds via SimContext (sim/systems.ts). SCALE stays
// here because it's a render constant (stroke weight / sprite px), not scene
// identity.
