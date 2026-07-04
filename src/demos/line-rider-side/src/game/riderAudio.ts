// Contact diffing for the sled's audio, extracted from Rider's rAF loop.
//
// The pure sim reports surface contacts into a buffer each substep; this turns
// that stream into the two things the AudioEngine wants:
//  - a one-shot `impact` for any surface the sled NEWLY touched this substep
//    (a contact key absent from the previous substep's set), and
//  - the frame's aggregated contacts that drive the sustained ride voices.
//
// It keeps the loop's allocation discipline: the frame aggregate is rebuilt per
// frame but the per-substep dedup set is the only churn, and the impact/ride
// fan-out matches the original tick exactly. Owns the AudioEngine so the Rider
// just forwards substep/frame/stop events and the mute toggle.

import { createAudioEngine, type AudioEngine } from './audio'
import type { ContactEvent } from './physics'

const contactKey = (c: ContactEvent) => `${c.kind}|${c.shape ?? ''}`

/**
 * Wraps an AudioEngine with the enter-detection the Rider used to do inline.
 * Construct once per mount; call onSubstep() for each fixed substep's contacts,
 * onFrame() once per rendered frame to drive the ride voices, and stop() when a
 * run ends / pauses. dispose() tears down the underlying engine.
 */
export class RiderAudio {
	private readonly engine: AudioEngine
	// Surfaces (kind|shape) touched on the PREVIOUS substep; diffing finds NEW
	// contacts to fire a one-shot impact for.
	private prevContactKeys = new Set<string>()
	// This frame's deduped contacts, aggregated across its substeps so the ride
	// voices read the whole frame, not just the last substep. Rebuilt each frame.
	private frameContacts: ContactEvent[] = []
	private muted: boolean

	constructor(muted: boolean) {
		this.engine = createAudioEngine()
		this.muted = muted
		this.engine.setMuted(muted)
	}

	/** Resume the audio context on a user-gesture run start, re-arming impacts. */
	beginRun(): void {
		this.engine.resume()
		this.prevContactKeys = new Set<string>()
	}

	/** Start a fresh frame's contact aggregate (call once before its substeps). */
	beginFrame(): void {
		this.frameContacts = []
	}

	/**
	 * Process one substep's contacts: fire an impact for each surface newly entered
	 * (a key not in the previous substep's set), then carry this substep's deduped
	 * contacts into the frame aggregate for the ride voices.
	 */
	onSubstep(contacts: ContactEvent[]): void {
		const substepKeys = new Set<string>()
		for (const c of contacts) {
			const key = contactKey(c)
			if (substepKeys.has(key)) continue
			substepKeys.add(key)
			if (!this.prevContactKeys.has(key)) this.engine.impact(c.kind, c.shape, c.speed)
			this.frameContacts.push(c)
		}
		this.prevContactKeys = substepKeys
	}

	/** Drive the sustained ride voices from this frame's aggregated contacts. */
	endFrame(): void {
		this.engine.setRide(this.frameContacts)
	}

	/**
	 * Silence sustained voices and drop contact state (so the next run re-arms
	 * impacts). No-op when already stopped, matching the original guard.
	 */
	stop(): void {
		if (this.prevContactKeys.size > 0) {
			this.engine.setRide([])
			this.prevContactKeys = new Set<string>()
		}
	}

	/** Mirror the mute atom into the engine; cheap, only acts on a change. */
	setMuted(muted: boolean): void {
		if (muted === this.muted) return
		this.muted = muted
		this.engine.setMuted(muted)
	}

	dispose(): void {
		this.engine.dispose()
	}
}
