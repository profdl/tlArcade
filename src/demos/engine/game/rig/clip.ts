/**
 * Engine — keyframed animation clips (R2b scaffold).
 *
 * PURE, editor-free. A `Clip` is per-bone keyframe tracks (time → BonePose); a clip
 * evaluated at time `t` produces a `Pose` the evaluator already knows how to apply.
 * This is the DATA path for animation, sitting beside the PROCEDURAL path (walk.ts):
 * both just return a `Pose`, so a state can be authored either way and the state
 * machine treats them uniformly. Phase 1' ships procedural states; this type + the
 * sampler are here so keyframed / AI-authored clips drop in later WITHOUT reworking
 * the pose pipeline (the reusability half of the plan).
 *
 * Interpolation is linear per channel, deltas ADDED to rest (same convention as a
 * BonePose delta in evaluate.ts) — so an empty clip, or all-zero keys, yields rest.
 */
import type { BonePose, Pose } from './evaluate'

/** One keyframe on a bone's track: a time (seconds) and the bone-local delta there. */
export interface Keyframe {
  t: number
  pose: BonePose
}

/** A clip: independent keyframe tracks per bone id, plus the loop period. */
export interface Clip {
  /** Loop length in seconds; `t` is wrapped into [0, duration) when `loop`. */
  duration: number
  loop: boolean
  /** boneId → keyframes, each track sorted ascending by `t`. */
  tracks: Record<string, Keyframe[]>
}

/** The channels a keyframe can carry (BonePose keys), interpolated independently. */
const CHANNELS = ['rotation', 'x', 'y', 'scaleX', 'scaleY', 'shearX', 'shearY'] as const

/** Linear lerp. */
function lerp(a: number, b: number, u: number): number {
  return a + (b - a) * u
}

/**
 * The value of a single channel on a track at time `t`. Holds the endpoints outside
 * the keyframed range (no extrapolation). Scale channels default to 1 (multiplicative,
 * matching evaluate.ts); the rest default to 0 (additive).
 */
function sampleChannel(keys: Keyframe[], ch: (typeof CHANNELS)[number], t: number): number | undefined {
  // Find the surrounding keyframes.
  let prev: Keyframe | undefined
  let next: Keyframe | undefined
  for (const k of keys) {
    if (k.pose[ch] === undefined) continue
    if (k.t <= t) prev = k
    if (k.t >= t && !next) next = k
  }
  if (!prev && !next) return undefined
  if (prev && !next) return prev.pose[ch]
  if (!prev && next) return next.pose[ch]
  if (prev === next) return prev!.pose[ch]
  const a = prev!.pose[ch]!
  const b = next!.pose[ch]!
  const span = next!.t - prev!.t
  const u = span > 0 ? (t - prev!.t) / span : 0
  return lerp(a, b, u)
}

/**
 * Sample a clip at time `t` (seconds) → a `Pose`. Wraps `t` into the loop period when
 * `clip.loop`. Only bones/channels the clip actually keys appear in the result, so it
 * composes cleanly with a procedural base pose (absent bones stay at rest).
 */
export function sampleClip(clip: Clip, t: number): Pose {
  const time = clip.loop && clip.duration > 0 ? ((t % clip.duration) + clip.duration) % clip.duration : t
  const pose: Pose = {}
  for (const [boneId, keys] of Object.entries(clip.tracks)) {
    const bp: BonePose = {}
    let any = false
    for (const ch of CHANNELS) {
      const v = sampleChannel(keys, ch, time)
      if (v !== undefined) {
        bp[ch] = v
        any = true
      }
    }
    if (any) pose[boneId] = bp
  }
  return pose
}

/**
 * Merge pose `b` ONTO `a` (b wins per channel), the way you'd layer a clip over a
 * procedural base. Additive channels add; scale channels multiply — matching how
 * evaluate.ts layers a BonePose onto rest — so layering is associative with rest.
 */
export function mergePose(a: Pose, b: Pose): Pose {
  const out: Pose = {}
  const ids = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const id of ids) {
    const pa = a[id] ?? {}
    const pb = b[id] ?? {}
    out[id] = {
      rotation: (pa.rotation ?? 0) + (pb.rotation ?? 0),
      x: (pa.x ?? 0) + (pb.x ?? 0),
      y: (pa.y ?? 0) + (pb.y ?? 0),
      scaleX: (pa.scaleX ?? 1) * (pb.scaleX ?? 1),
      scaleY: (pa.scaleY ?? 1) * (pb.scaleY ?? 1),
      shearX: (pa.shearX ?? 0) + (pb.shearX ?? 0),
      shearY: (pa.shearY ?? 0) + (pb.shearY ?? 0),
    }
  }
  return out
}
