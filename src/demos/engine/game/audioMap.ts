/**
 * Engine — the PURE audio mapping (no Tone/Piano import).
 *
 * Split out of audio.ts so the event→note / event→loudness math and the AUDIO
 * tunables can be unit-tested WITHOUT importing Tone.js — Tone's ESM build doesn't
 * resolve under Vitest's Node environment (the same class of env-incompatibility
 * the repo notes for the Cloudflare Vite plugin). audio.ts imports from here and
 * adds only the Piano/Tone I/O. Framework-free; no side effects.
 */

/** The discrete game events the runtime sonifies. */
export type GameSound =
  | 'jump'
  | 'land'
  | 'collect'
  | 'stomp'
  | 'spring'
  | 'checkpoint'
  | 'death'
  | 'win'

/** All tunables live here (mirrors physics.ts PHYSICS) — no inline literals. */
export const AUDIO = {
  masterVolumeDb: -6, // overall piano output level in dB (pre-mute)
  mutedVolumeDb: -60, // master level while muted (a deep fade, not a hard cut)
  muteRampTime: 0.08, // s; master fade for the mute toggle
  velocities: 4, // sampled velocity layers to load (higher = bigger download)
  keyUpDelay: 0.15, // s; how long a struck note rings before release
  // Note velocities (0..1) for events with no intensity, and the range for those
  // that carry one (land/collect climb with intensity).
  velLow: 0.4,
  velMid: 0.6,
  velHigh: 0.85,
  // The second note of the win motif fires this long after the first (s).
  winMotifGap: 0.16,
} as const

/**
 * Per-event musical recipe: a struck note (MIDI), a base velocity, and whether an
 * intensity 0..1 scales the velocity between velLow..velHigh. `motif` plays a
 * second note (offset semitones, delayed by winMotifGap) for a two-note flourish.
 * Tuned by ear; 60 = C4. Pitches chosen so overlapping events stay consonant.
 */
export interface SoundRecipe {
  note: number // MIDI note struck
  vel: number // base note velocity (0..1) when no intensity is given
  scaled?: boolean // if true, an intensity 0..1 scales velocity velLow..velHigh
  motif?: number // optional second note, this many semitones above `note`
}

export const SOUNDS: Record<GameSound, SoundRecipe> = {
  // A bright upward hop — mid-high, quick.
  jump: { note: 72, vel: AUDIO.velMid }, // C5
  // A soft low thud, harder with a bigger fall (intensity = fall speed frac).
  land: { note: 48, vel: AUDIO.velLow, scaled: true }, // C3
  // A sparkly coin ping, a touch brighter as you grab more (intensity optional).
  collect: { note: 84, vel: AUDIO.velMid, scaled: true }, // C6
  // A satisfying stomp: mid register, firm.
  stomp: { note: 64, vel: AUDIO.velHigh }, // E4
  // A springy launch: high triad root, jumps up.
  spring: { note: 79, vel: AUDIO.velHigh }, // G5
  // A reassuring checkpoint chime.
  checkpoint: { note: 76, vel: AUDIO.velMid }, // E5
  // A low, dark death note.
  death: { note: 41, vel: AUDIO.velHigh }, // F2
  // A rising two-note win flourish (root then a fifth above).
  win: { note: 72, vel: AUDIO.velHigh, motif: 7 }, // C5 -> G5
}

const MIDI_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** MIDI note number -> scientific pitch name (e.g. 60 -> "C4"). Clamped to the
 *  piano range A0..C8. Pure. */
export function midiToNote(midi: number): string {
  const clamped = Math.max(21, Math.min(108, Math.round(midi))) // piano range A0..C8
  const name = MIDI_NAMES[((clamped % 12) + 12) % 12]
  const octave = Math.floor(clamped / 12) - 1
  return `${name}${octave}`
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * The note velocity (0..1) for a game sound. A `scaled` recipe (land/collect) maps
 * an intensity 0..1 across velLow..velHigh (clamped); everything else plays at its
 * fixed base velocity regardless of intensity.
 */
export function soundVelocity(sound: GameSound, intensity?: number): number {
  const recipe = SOUNDS[sound]
  if (recipe.scaled && intensity != null) {
    return lerp(AUDIO.velLow, AUDIO.velHigh, Math.min(1, Math.max(0, intensity)))
  }
  return recipe.vel
}
