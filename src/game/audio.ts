// Piano surface sounds for the sled, voiced with the Salamander Grand piano via
// @tonejs/piano (on top of Tone.js). Framework-free (no React, no tldraw): the
// Rider rAF loop owns this engine and feeds it the contact events the pure
// physics sim reports (see ContactEvent in physics.ts). The sim stays silent;
// all sound lives here.
//
// Because a piano is a pitched, struck instrument (not a drone), surfaces are
// sonified as NOTES rather than the old noise/oscillator timbres:
//   - impact: a struck note fired when the sled NEWLY touches a surface (the
//     Rider does the enter-detection; we just play the note). Velocity scales
//     with entry speed.
//   - ride: while the sled stays in contact, we retrigger a soft note on a
//     speed-scaled cadence — faster riding = notes more often + a little louder —
//     so a sustained ride reads as a run of notes instead of silence.
//
// Each LineKind owns a base octave and a small scale; faster contact climbs the
// scale, so a kind keeps its register (ice high, sticky low...) while speed
// gives it melodic motion. The native shape type nudges the note up a few
// scale-degrees so draw/line/geo/arrow on the same kind don't all play in unison.
//
// Samples stream from the library's default CDN (tambien.github.io) on first
// load; the browser caches them after. load() is async and we simply skip all
// sound until it resolves — the sim is unaffected either way.

import { Piano } from '@tonejs/piano'
import * as Tone from 'tone'
import type { ContactEvent, LineKind } from './physics'

// All tunables live here (mirrors the PHYSICS object) — no inline literals.
export const AUDIO = {
	masterVolumeDb: -6, // overall piano output level in dB (pre-mute)
	mutedVolumeDb: -60, // master level while muted (a deep fade, not a hard cut)
	muteRampTime: 0.08, // s; master fade for the mute toggle
	velocities: 4, // sampled velocity layers to load (higher = bigger download)
	// Speed (px/s) at which a contact reaches full velocity / climbs to the top of
	// its kind's scale. Below this, both scale linearly; above, they clamp. Keeps a
	// slow crawl quiet and low-pitched.
	fullSpeed: 900,
	impactMinVel: 0.3, // note velocity (0..1) of the slowest audible impact
	impactMaxVel: 0.9, // note velocity of a full-speed impact
	rideMinVel: 0.12, // note velocity of the quietest ride retrigger
	rideMaxVel: 0.4, // note velocity of a full-speed ride retrigger
	// How often a sustained ride retriggers, in seconds. Slow riding uses the slow
	// interval, full speed the fast one — a speed-scaled note cadence.
	rideIntervalSlow: 0.32,
	rideIntervalFast: 0.09,
	// Per-shape offset in scale-degrees, so draw/line/geo/arrow differ on one kind.
	shapeDegrees: { draw: 0, line: 1, geo: -1, arrow: 2 } as Record<string, number>,
} as const

// Per-kind musical recipe: a root MIDI note and a scale (semitone offsets from
// the root). Speed selects an index into the scale, so each kind keeps its
// register while climbing as the sled goes faster. Tuned by ear.
//   60 = C4. Pentatonic/triad scales avoid dissonance when several kinds overlap.
interface KindNotes {
	root: number // MIDI note of the scale's bottom degree
	scale: number[] // semitone offsets; index chosen by speed
}

const MAJOR_PENT = [0, 2, 4, 7, 9, 12]
const MINOR_PENT = [0, 3, 5, 7, 10, 12]

const KIND_NOTES: Record<LineKind, KindNotes> = {
	// plain line: mid major pentatonic
	solid: { root: 60, scale: MAJOR_PENT },
	// oneway is a solid that only blocks one side — same voice.
	oneway: { root: 60, scale: MAJOR_PENT },
	// accelerate: a bright rising major run, an octave up
	accelerate: { root: 72, scale: [0, 2, 4, 5, 7, 9, 11, 12] },
	// brake: low, dark minor pentatonic
	brake: { root: 43, scale: MINOR_PENT },
	// bounce: a sparkly high triad
	bounce: { root: 76, scale: [0, 4, 7, 12, 16] },
	// sticky: very low, dull
	sticky: { root: 36, scale: MINOR_PENT },
	// ice: airy, high
	ice: { root: 84, scale: MAJOR_PENT },
	// scenery never collides, so it never sounds — present for type completeness.
	scenery: { root: 60, scale: MAJOR_PENT },
}

const MIDI_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** MIDI note number -> scientific pitch name (e.g. 60 -> "C4"). */
function midiToNote(midi: number): string {
	const clamped = Math.max(21, Math.min(108, Math.round(midi))) // piano range A0..C8
	const name = MIDI_NAMES[((clamped % 12) + 12) % 12]
	const octave = Math.floor(clamped / 12) - 1
	return `${name}${octave}`
}

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t
}

/**
 * Pick the note a contact should play: speed climbs the kind's scale, and the
 * shape type shifts a few scale-degrees so shapes differ. Returns a pitch name.
 */
function noteFor(kind: LineKind, shape: string | undefined, speedFrac: number): string {
	const recipe = KIND_NOTES[kind]
	const shapeShift = AUDIO.shapeDegrees[shape ?? 'draw'] ?? 0
	const top = recipe.scale.length - 1
	const degree = Math.round(speedFrac * top) + shapeShift
	const wrapped = ((degree % recipe.scale.length) + recipe.scale.length) % recipe.scale.length
	return midiToNote(recipe.root + recipe.scale[wrapped])
}

export interface AudioEngine {
	/** Resume Tone's context (call from a user gesture, e.g. Play) and kick off
	 *  the async sample load on first use. */
	resume(): void
	/** Fire a struck note for a surface the sled just entered. */
	impact(kind: LineKind, shape: string | undefined, speed: number): void
	/** Drive the sustained ride retriggers from this frame's live contacts. */
	setRide(contacts: ContactEvent[]): void
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
	// Per-kind ride bookkeeping: the last note time (s, Tone context time) so we
	// can throttle retriggers, and the currently-sounding note so we release it
	// when the ride changes pitch or ends.
	const ride = new Map<LineKind, { lastTime: number; note: string | null }>()

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

	function speedFrac(speed: number): number {
		return Math.min(1, Math.max(0, speed / AUDIO.fullSpeed))
	}

	function impact(kind: LineKind, shape: string | undefined, speed: number) {
		if (kind === 'scenery' || !loaded || !piano) return
		const frac = speedFrac(speed)
		const note = noteFor(kind, shape, frac)
		const velocity = lerp(AUDIO.impactMinVel, AUDIO.impactMaxVel, frac)
		// A struck note: key down now, release shortly after so it rings and decays
		// like a real keypress rather than sustaining forever.
		const now = Tone.now()
		piano.keyDown({ note, velocity, time: now })
		piano.keyUp({ note, time: now + 0.15 })
	}

	function setRide(contacts: ContactEvent[]) {
		if (!loaded || !piano) return
		const now = Tone.now()

		// Collapse this frame's contacts to one entry per kind: keep the fastest
		// (a sled touches at most 1-2 surfaces).
		const byKind = new Map<LineKind, { speed: number; shape?: string }>()
		for (const ev of contacts) {
			if (ev.kind === 'scenery') continue
			const prev = byKind.get(ev.kind)
			if (!prev || ev.speed > prev.speed) byKind.set(ev.kind, { speed: ev.speed, shape: ev.shape })
		}

		// Retrigger a soft note for each present kind on its speed-scaled cadence;
		// release and forget kinds no longer in contact.
		for (const kind of Object.keys(KIND_NOTES) as LineKind[]) {
			const hit = byKind.get(kind)
			const state = ride.get(kind)
			if (hit) {
				const frac = speedFrac(hit.speed)
				const interval = lerp(AUDIO.rideIntervalSlow, AUDIO.rideIntervalFast, frac)
				if (!state || now - state.lastTime >= interval) {
					// Release the previous ride note before striking the next.
					if (state?.note) piano.keyUp({ note: state.note, time: now })
					const note = noteFor(kind, hit.shape, frac)
					const velocity = lerp(AUDIO.rideMinVel, AUDIO.rideMaxVel, frac)
					piano.keyDown({ note, velocity, time: now })
					piano.keyUp({ note, time: now + interval * 0.9 })
					ride.set(kind, { lastTime: now, note })
				}
			} else if (state) {
				if (state.note) piano.keyUp({ note: state.note, time: now })
				ride.delete(kind)
			}
		}
	}

	function setMuted(next: boolean) {
		muted = next
		if (!piano) return
		const target = next ? AUDIO.mutedVolumeDb : AUDIO.masterVolumeDb
		piano.strings.rampTo(target, AUDIO.muteRampTime)
	}

	function dispose() {
		ride.clear()
		if (piano) {
			piano.stopAll()
			piano.dispose()
		}
		piano = null
		loaded = false
	}

	return { resume, impact, setRide, setMuted, dispose }
}

/** Engine used when Web Audio / Tone is unavailable (SSR / unsupported browser). */
function noopEngine(): AudioEngine {
	return {
		resume() {},
		impact() {},
		setRide() {},
		setMuted() {},
		dispose() {},
	}
}
