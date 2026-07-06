/**
 * Engine — event sounds for the platformer, voiced with the Salamander Grand
 * piano via @tonejs/piano (on top of Tone.js). Framework-free (no React, no
 * tldraw): the GameRuntime rAF loop owns this engine and calls it at the game's
 * event sites (jump, land, collect, stomp, spring, checkpoint, death, win). The
 * sim stays silent; all sound lives here.
 *
 * This REUSES the line-rider demo's audio infrastructure (line-rider-side/game/
 * audio.ts): the lazy Piano build + CDN sample stream, the no-op fallback for
 * SSR/unsupported browsers, the fade-not-cut mute ramp, and the "all tunables in
 * one AUDIO object" discipline. What differs is the SOUND MODEL: line-rider
 * sonifies CONTINUOUS surface contact (impact + ride); a platformer is driven by
 * DISCRETE game events, so here each event maps to a struck note (or a short
 * two-note motif for win), with an optional 0..1 intensity that scales note
 * velocity (e.g. a bigger fall lands harder).
 *
 * The pure event→note / event→loudness mapping lives in audioMap.ts (no Tone
 * import, so it's unit-testable under Vitest); this file adds only the Piano/Tone
 * I/O. Samples stream from the library's default CDN on first load; load() is
 * async and we skip all sound until it resolves — the runtime is unaffected.
 */

import { Piano } from '@tonejs/piano'
import * as Tone from 'tone'
import { AUDIO, SOUNDS, midiToNote, soundVelocity, type GameSound } from './audioMap'

export type { GameSound } from './audioMap'
export { AUDIO } from './audioMap'

export interface AudioEngine {
  /** Resume Tone's context (call from a user gesture, e.g. Play) and kick off the
   *  async sample load on first use. */
  resume(): void
  /** Play the note(s) for one game event. `intensity` (0..1) scales velocity for
   *  events whose recipe is `scaled`; ignored otherwise. */
  play(sound: GameSound, intensity?: number): void
  /** Master mute (fades, doesn't cut). */
  setMuted(muted: boolean): void
  /** Tear down the piano and release audio resources. */
  dispose(): void
}

/**
 * Builds the piano lazily on first resume() and streams its samples from the CDN
 * (async; all sound is skipped until loaded). Returns a no-op engine when Web
 * Audio / Tone is unavailable (SSR / unsupported browser).
 */
export function createAudioEngine(): AudioEngine {
  if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') {
    return noopEngine()
  }

  let piano: Piano | null = null
  let loaded = false
  let muted = false

  function ensurePiano(): Piano {
    if (piano) return piano
    piano = new Piano({ velocities: AUDIO.velocities })
    piano.toDestination()
    piano.strings.value = muted ? AUDIO.mutedVolumeDb : AUDIO.masterVolumeDb
    void piano.load().then(() => {
      loaded = true
    })
    return piano
  }

  function resume() {
    ensurePiano()
    // Tone gates audio behind a user gesture; resume on the Play click.
    void Tone.start()
  }

  /** Strike one note now, releasing it after keyUpDelay so it rings and decays. */
  function strike(p: Piano, midi: number, velocity: number, at: number) {
    const note = midiToNote(midi)
    p.keyDown({ note, velocity, time: at })
    p.keyUp({ note, time: at + AUDIO.keyUpDelay })
  }

  function play(sound: GameSound, intensity?: number) {
    if (!loaded || !piano) return
    const recipe = SOUNDS[sound]
    const velocity = soundVelocity(sound, intensity)
    const now = Tone.now()
    strike(piano, recipe.note, velocity, now)
    // A two-note flourish (win): strike the motif note a beat later.
    if (recipe.motif != null) {
      strike(piano, recipe.note + recipe.motif, velocity, now + AUDIO.winMotifGap)
    }
  }

  function setMuted(next: boolean) {
    muted = next
    if (!piano) return
    const target = next ? AUDIO.mutedVolumeDb : AUDIO.masterVolumeDb
    piano.strings.rampTo(target, AUDIO.muteRampTime)
  }

  function dispose() {
    if (piano) {
      piano.stopAll()
      piano.dispose()
    }
    piano = null
    loaded = false
  }

  return { resume, play, setMuted, dispose }
}

/** Engine used when Web Audio / Tone is unavailable (SSR / unsupported browser). */
function noopEngine(): AudioEngine {
  return {
    resume() {},
    play() {},
    setMuted() {},
    dispose() {},
  }
}
