// Web Audio surface sounds for the sled. Framework-free (no React, no tldraw):
// the Rider rAF loop owns this engine and feeds it contact events that the pure
// physics sim reports (see ContactEvent in physics.ts). The sim stays silent;
// all sound lives here.
//
// Two voices per surface kind:
//   - impact: a one-shot fired when the sled NEWLY touches a surface (the Rider
//     does the enter-detection; we just play a burst).
//   - ride: a sustained voice that hums/scrapes while the sled stays in contact,
//     its gain/pitch scaled by speed. setRide() each frame ramps the present
//     kinds up and the absent ones down.
//
// Kind picks the timbre; the native shape type (draw/line/geo/arrow) nudges the
// pitch and (for arrow) the waveform, so the kind stays recognizable while each
// shape sounds a little different.

import type { ContactEvent, LineKind } from './physics'

// All tunables live here (mirrors the PHYSICS object) — no inline literals.
export const AUDIO = {
	masterGain: 0.5, // overall output level (pre-mute)
	rampTime: 0.04, // s; gain/pitch glide so voices don't click on/off
	muteRampTime: 0.08, // s; master fade for the mute toggle
	impactGain: 0.5, // peak gain of a one-shot impact
	impactDecay: 0.18, // s; how fast an impact tails off
	// Speed (px/s) at which a ride voice reaches full volume. Below this, volume
	// scales linearly with speed; above, it's clamped. Keeps a slow crawl quiet.
	rideFullSpeed: 900,
	rideMaxGain: 0.35, // peak gain of a sustained ride voice at full speed
	// How much ride pitch rises with speed, in cents at rideFullSpeed (accelerate
	// uses a stronger value below). 1200 cents = one octave.
	ridePitchCents: 200,
	// Per-shape pitch offset in semitones, applied to both impact and ride. arrow
	// also swaps to a square wave for a buzzier edge (see waveForShape).
	shapeSemitones: { draw: 0, line: 4, geo: -3, arrow: 7 } as Record<string, number>,
}

// Per-kind voice recipe. `osc`/`noise` select the sound source; `base` is the
// fundamental in Hz for tonal kinds. Tune by ear.
interface KindVoice {
	source: 'osc' | 'noise'
	wave: OscillatorType // for osc kinds
	base: number // Hz fundamental (osc) / filter center (noise)
	filterType: BiquadFilterType // shapes the noise / tames the osc
	filterQ: number
	pitchCents: number // ride pitch sensitivity to speed (overrides AUDIO default)
}

const KIND_VOICE: Record<LineKind, KindVoice> = {
	// soft low scrape
	solid: { source: 'noise', wave: 'sawtooth', base: 1200, filterType: 'bandpass', filterQ: 0.8, pitchCents: 200 },
	// oneway is a solid that only blocks one side — same voice.
	oneway: { source: 'noise', wave: 'sawtooth', base: 1200, filterType: 'bandpass', filterQ: 0.8, pitchCents: 200 },
	// rising tone that climbs hard with speed
	accelerate: { source: 'osc', wave: 'sawtooth', base: 220, filterType: 'lowpass', filterQ: 1, pitchCents: 900 },
	// low gritty grind
	brake: { source: 'noise', wave: 'sawtooth', base: 500, filterType: 'lowpass', filterQ: 1.2, pitchCents: 120 },
	// short pitched boing (mostly an impact; ride is faint)
	bounce: { source: 'osc', wave: 'sine', base: 330, filterType: 'lowpass', filterQ: 1, pitchCents: 300 },
	// dull damped low thud
	sticky: { source: 'osc', wave: 'triangle', base: 150, filterType: 'lowpass', filterQ: 0.7, pitchCents: 120 },
	// bright airy high glide
	ice: { source: 'osc', wave: 'sine', base: 1400, filterType: 'highpass', filterQ: 0.7, pitchCents: 350 },
	// scenery never collides, so it never sounds — present for type completeness.
	scenery: { source: 'osc', wave: 'sine', base: 440, filterType: 'lowpass', filterQ: 1, pitchCents: 0 },
}

function semitonesToRatio(semitones: number): number {
	return Math.pow(2, semitones / 12)
}

function centsToRatio(cents: number): number {
	return Math.pow(2, cents / 1200)
}

function waveForShape(base: OscillatorType, shape?: string): OscillatorType {
	// arrow gets a buzzier square; others keep the kind's base waveform.
	return shape === 'arrow' ? 'square' : base
}

/** Build a short looping white-noise buffer for the scrape/grind kinds. */
function makeNoiseBuffer(ctx: AudioContext): AudioBuffer {
	const length = Math.floor(ctx.sampleRate * 0.5)
	const buffer = ctx.createBuffer(1, length, ctx.sampleRate)
	const data = buffer.getChannelData(0)
	// Deterministic-ish fill (no Math.random needed): a cheap LCG so the noise is
	// reproducible and we avoid pulling in randomness that could differ per run.
	let seed = 0x2545f491
	for (let i = 0; i < length; i++) {
		seed = (seed * 1103515245 + 12345) & 0x7fffffff
		data[i] = (seed / 0x3fffffff) - 1 // ~[-1, 1)
	}
	return buffer
}

/** A live sustained voice for one kind: a source -> filter -> gain chain. */
interface RideVoice {
	gain: GainNode
	filter: BiquadFilterNode
	osc?: OscillatorNode
	noise?: AudioBufferSourceNode
	base: number
	pitchCents: number
	active: boolean // whether it's currently ramped up
}

export interface AudioEngine {
	/** Resume the context (call from a user gesture, e.g. Play). */
	resume(): void
	/** Fire a one-shot for a surface the sled just entered. */
	impact(kind: LineKind, shape: string | undefined, speed: number): void
	/** Drive the sustained ride voices from this frame's live contacts. */
	setRide(contacts: ContactEvent[]): void
	/** Master mute (fades, doesn't cut). */
	setMuted(muted: boolean): void
	/** Tear down the audio graph and close the context. */
	dispose(): void
}

/**
 * Lazily builds an AudioContext and per-kind voice graph on first use. Safe to
 * construct eagerly (nothing happens until resume()/the first sound). Returns a
 * no-op engine if the Web Audio API is unavailable.
 */
export function createAudioEngine(): AudioEngine {
	const Found =
		typeof window !== 'undefined'
			? window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
			: undefined
	if (!Found) return noopEngine()
	const Ctor: typeof AudioContext = Found

	let ctx: AudioContext | null = null
	let master: GainNode | null = null
	let noiseBuffer: AudioBuffer | null = null
	let muted = false
	const rides = new Map<LineKind, RideVoice>()

	function ensureContext(): AudioContext {
		if (ctx) return ctx
		ctx = new Ctor()
		master = ctx.createGain()
		master.gain.value = muted ? 0 : AUDIO.masterGain
		master.connect(ctx.destination)
		noiseBuffer = makeNoiseBuffer(ctx)
		return ctx
	}

	function getRide(kind: LineKind): RideVoice {
		const existing = rides.get(kind)
		if (existing) return existing
		const c = ensureContext()
		const recipe = KIND_VOICE[kind]
		const gain = c.createGain()
		gain.gain.value = 0
		const filter = c.createBiquadFilter()
		filter.type = recipe.filterType
		filter.frequency.value = recipe.base
		filter.Q.value = recipe.filterQ
		filter.connect(gain)
		gain.connect(master!)

		const voice: RideVoice = { gain, filter, base: recipe.base, pitchCents: recipe.pitchCents, active: false }
		if (recipe.source === 'noise') {
			const noise = c.createBufferSource()
			noise.buffer = noiseBuffer!
			noise.loop = true
			noise.connect(filter)
			noise.start()
			voice.noise = noise
		} else {
			const osc = c.createOscillator()
			osc.type = recipe.wave
			osc.frequency.value = recipe.base
			osc.connect(filter)
			osc.start()
			voice.osc = osc
		}
		rides.set(kind, voice)
		return voice
	}

	function resume() {
		const c = ensureContext()
		if (c.state === 'suspended') void c.resume()
	}

	function impact(kind: LineKind, shape: string | undefined, speed: number) {
		if (kind === 'scenery') return
		const c = ensureContext()
		const recipe = KIND_VOICE[kind]
		const now = c.currentTime
		const shapeRatio = semitonesToRatio(AUDIO.shapeSemitones[shape ?? 'draw'] ?? 0)
		// A louder hit for a faster entry, but always audible.
		const speedFrac = Math.min(1, speed / AUDIO.rideFullSpeed)
		const peak = AUDIO.impactGain * (0.5 + 0.5 * speedFrac)

		const env = c.createGain()
		env.gain.setValueAtTime(0, now)
		env.gain.linearRampToValueAtTime(peak, now + 0.005)
		env.gain.exponentialRampToValueAtTime(0.0001, now + AUDIO.impactDecay)
		env.connect(master!)

		if (recipe.source === 'noise') {
			const noise = c.createBufferSource()
			noise.buffer = noiseBuffer!
			const filter = c.createBiquadFilter()
			filter.type = recipe.filterType
			filter.frequency.value = recipe.base * shapeRatio
			filter.Q.value = recipe.filterQ
			noise.connect(filter)
			filter.connect(env)
			noise.start(now)
			noise.stop(now + AUDIO.impactDecay + 0.02)
		} else {
			const osc = c.createOscillator()
			osc.type = waveForShape(recipe.wave, shape)
			const f0 = recipe.base * shapeRatio
			osc.frequency.setValueAtTime(f0, now)
			// bounce gives a quick downward pitch drop for the "boing"; others hold.
			if (kind === 'bounce') osc.frequency.exponentialRampToValueAtTime(f0 * 0.6, now + AUDIO.impactDecay)
			osc.connect(env)
			osc.start(now)
			osc.stop(now + AUDIO.impactDecay + 0.02)
		}
	}

	function setRide(contacts: ContactEvent[]) {
		const c = ensureContext()
		const now = c.currentTime
		// Collapse this frame's contacts to one entry per kind: keep the fastest
		// (loudest) and its shape, since a sled touches at most 1-2 surfaces.
		const byKind = new Map<LineKind, { speed: number; shape?: string }>()
		for (const ev of contacts) {
			if (ev.kind === 'scenery') continue
			const prev = byKind.get(ev.kind)
			if (!prev || ev.speed > prev.speed) byKind.set(ev.kind, { speed: ev.speed, shape: ev.shape })
		}

		// Ramp present kinds toward their speed-scaled target; silence the rest.
		for (const [kind, recipe] of Object.entries(KIND_VOICE) as [LineKind, KindVoice][]) {
			void recipe
			const hit = byKind.get(kind)
			if (hit) {
				const voice = getRide(kind)
				const speedFrac = Math.min(1, hit.speed / AUDIO.rideFullSpeed)
				const targetGain = AUDIO.rideMaxGain * speedFrac
				voice.gain.gain.setTargetAtTime(targetGain, now, AUDIO.rampTime)
				const shapeRatio = semitonesToRatio(AUDIO.shapeSemitones[hit.shape ?? 'draw'] ?? 0)
				const pitchRatio = centsToRatio(voice.pitchCents * speedFrac)
				const targetFreq = voice.base * shapeRatio * pitchRatio
				const param = voice.osc ? voice.osc.frequency : voice.filter.frequency
				param.setTargetAtTime(targetFreq, now, AUDIO.rampTime)
				voice.active = true
			} else {
				const voice = rides.get(kind)
				if (voice && voice.active) {
					voice.gain.gain.setTargetAtTime(0, now, AUDIO.rampTime)
					voice.active = false
				}
			}
		}
	}

	function setMuted(next: boolean) {
		muted = next
		if (!ctx || !master) return
		master.gain.setTargetAtTime(next ? 0 : AUDIO.masterGain, ctx.currentTime, AUDIO.muteRampTime)
	}

	function dispose() {
		for (const voice of rides.values()) {
			try {
				voice.osc?.stop()
				voice.noise?.stop()
			} catch {
				// already stopped
			}
		}
		rides.clear()
		if (ctx) void ctx.close()
		ctx = null
		master = null
		noiseBuffer = null
	}

	return { resume, impact, setRide, setMuted, dispose }
}

/** Engine used when Web Audio is unavailable (SSR / unsupported browser). */
function noopEngine(): AudioEngine {
	return {
		resume() {},
		impact() {},
		setRide() {},
		setMuted() {},
		dispose() {},
	}
}
