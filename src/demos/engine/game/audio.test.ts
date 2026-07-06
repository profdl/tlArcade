/**
 * Engine — audio unit tests (the PURE mapping only).
 *
 * The AudioEngine itself is I/O (Piano/Tone); what's worth testing without a
 * browser AudioContext is the pure event→note / event→loudness mapping and the
 * MIDI→pitch-name conversion the engine strikes notes with. Mirrors how physics.ts
 * / props.ts keep their decisions pure and colocate the test.
 */
import { describe, expect, it } from 'vitest'
import { AUDIO, midiToNote, soundVelocity } from './audioMap'

describe('midiToNote', () => {
  it('maps reference MIDI numbers to scientific pitch names', () => {
    expect(midiToNote(60)).toBe('C4')
    expect(midiToNote(72)).toBe('C5')
    expect(midiToNote(69)).toBe('A4')
    expect(midiToNote(61)).toBe('C#4')
  })

  it('clamps to the piano range A0..C8 and rounds', () => {
    expect(midiToNote(0)).toBe('A0') // below A0 (21) clamps up
    expect(midiToNote(200)).toBe('C8') // above C8 (108) clamps down
    expect(midiToNote(60.4)).toBe('C4') // rounds to nearest key
  })
})

describe('soundVelocity', () => {
  it('uses the fixed base velocity for unscaled events (intensity ignored)', () => {
    // jump/stomp/spring/checkpoint/death/win are not `scaled`: intensity is a no-op.
    expect(soundVelocity('jump')).toBe(AUDIO.velMid)
    expect(soundVelocity('jump', 0)).toBe(AUDIO.velMid)
    expect(soundVelocity('jump', 1)).toBe(AUDIO.velMid)
    expect(soundVelocity('death')).toBe(AUDIO.velHigh)
  })

  it('maps intensity across velLow..velHigh for scaled events (land/collect)', () => {
    expect(soundVelocity('land', 0)).toBeCloseTo(AUDIO.velLow)
    expect(soundVelocity('land', 1)).toBeCloseTo(AUDIO.velHigh)
    expect(soundVelocity('land', 0.5)).toBeCloseTo((AUDIO.velLow + AUDIO.velHigh) / 2)
  })

  it('clamps out-of-range intensity for scaled events', () => {
    expect(soundVelocity('collect', -1)).toBeCloseTo(AUDIO.velLow)
    expect(soundVelocity('collect', 5)).toBeCloseTo(AUDIO.velHigh)
  })

  it('falls back to the base velocity when a scaled event gets no intensity', () => {
    // A scaled recipe with intensity omitted plays at its base velocity.
    expect(soundVelocity('land')).toBe(AUDIO.velLow)
  })
})
