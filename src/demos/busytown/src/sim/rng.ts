/**
 * Tiny RNG helpers for the live sim. The app uses Math.random (the seeded RNG
 * in sim.py only mattered for measuring cadence over many seeds). Ranges match
 * the [min, max] inclusive convention used throughout config.ts → TIMING.
 */

/** Inclusive integer in [min, max]. */
export function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/** Inclusive integer from a [min, max] tuple (the TIMING duration shape). */
export function randRange([min, max]: readonly [number, number]): number {
  return randInt(min, max)
}

/** Float in [min, max). */
export function randFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min
}

/** Uniform pick from a non-empty array. */
export function choice<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}
