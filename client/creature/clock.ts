/**
 * CREATURE CLOCK  (the local animation tick)
 * ==========================================
 * A single, room-wide animation clock for every CreatureShape on this client.
 *
 * WHY THIS EXISTS (and why it is NOT in the store):
 * The creature's swim is a per-frame animation. If we wrote the phase into
 * `shape.props` every frame we would flood @tldraw/sync with writes (the
 * anti-pattern CLAUDE.md gotcha #7 warns about) and desync nothing useful —
 * the motion is purely cosmetic. So the clock lives LOCALLY, on each client,
 * and only the creature's `seed` is synced. Every client therefore draws the
 * SAME creature (deterministic from seed) but animates it on its own clock.
 *
 * WHY AN ATOM:
 * It is a tldraw `atom`, so a creature component reads it with `useValue` and
 * re-renders reactively each tick — the idiomatic reactive path (same pattern
 * as client/referee/privateReveals.ts). One atom serves N creatures: 10
 * creatures share one clock, not ten.
 *
 * NATIVE-FIRST — WHY NO requestAnimationFrame:
 * tldraw already runs a per-frame loop and emits `editor.on('tick', elapsedMs
 * => …)` (see client/physics/registerPhysics.ts, which rides the same event).
 * We listen to THAT instead of spinning our own rAF, so the whole client has a
 * single animation loop. The tick gives us elapsed milliseconds directly, so
 * we no longer track wall-clock timestamps ourselves.
 *
 * REF-COUNTING:
 * The listener attaches when the first creature mounts and detaches when the
 * last one unmounts, so an empty board never advances the clock.
 */
import { Editor, atom } from 'tldraw'

/**
 * Elapsed animation time in seconds. Reactive: read via
 * `useValue('creatureClock', () => creatureClock.get(), [])`.
 */
export const creatureClock = atom('creatureClock', 0)

/**
 * How many creatures are currently mounted (= visible / not unmounted) on this
 * client. Used to scale per-frame cost down as the fleet grows: the body
 * renderer quantizes the clock more coarsely (fewer path rebuilds/sec) and the
 * swim loop writes positions less often when this is large. It's a plain number
 * behind an atom so readers can react to it; it tracks subscribeCreatureClock's
 * ref count, which mounts/unmounts with each CreatureBody.
 */
export const creatureCount = atom('creatureCount', 0)

/**
 * Animation steps per second the body renderer quantizes the clock to, as a
 * function of how many creatures are live. Above the thresholds we step coarser
 * so N creatures rebuild their (perfect-freehand) paths fewer times per second —
 * the dominant render cost. Returned value also throttles the swim-loop writes.
 *
 *   ≤ 60 creatures → 60 steps/s (frame-rate smooth; we have the CPU headroom here)
 *   ≤ 150         → 30 steps/s
 *   ≤ 300         → 16 steps/s
 *   > 300         →  8 steps/s
 *
 * Pure function of the count so every reader (renderer + swim loop) agrees.
 */
export function animationStepsPerSec(count: number): number {
	if (count <= 60) return 60
	if (count <= 150) return 30
	if (count <= 300) return 16
	return 8
}

/**
 * How many times/sec the swim loop WRITES creature positions, as a function of
 * fleet size. Distinct from animationStepsPerSec because translation through
 * space looks STEPPED below frame rate, whereas the body's cyclic undulation
 * tolerates coarse quantization. So small fleets write EVERY frame (0 = no
 * throttle, the smoothest), and only large fleets throttle — to cut the x/y/
 * rotation sync-diff broadcast, where many fish moving per-frame is the cost.
 *
 *   ≤ 150 creatures → 0  (write every tick — fully smooth gliding)
 *   ≤ 300          → 30 writes/s
 *   > 300          → 20 writes/s
 *
 * Even the throttled tiers stay at/above the body's animation cadence, so
 * position never updates more coarsely than the creature visibly animates.
 */
export function positionWriteHz(count: number): number {
	if (count <= 150) return 0
	if (count <= 300) return 30
	return 20
}

/**
 * THE SHARED SWIM WAVE — the single source of "where in the tail-beat are we?".
 *
 * Both the body renderer (CreatureShape) and the movement loop (registerSwimming)
 * call this, so the forward THRUST lines up with the visible tail-FLICK and the
 * creature looks self-propelled. It is a PURE function of values every client
 * already shares — the clock (same on all clients), and the creature's synced
 * `seed`/`speed` — so the two systems stay coupled WITHOUT syncing anything new
 * (no per-frame phase in the store; CLAUDE.md gotchas #5 & #7). The movement
 * owner and a passive viewer compute the identical wave.
 *
 *   phase  — the tail-beat argument (radians). Beat rate scales with `speed`, so
 *            a faster fish beats faster. Feed into the body's travelling sine.
 *   thrust — 0..1 power-stroke envelope: ~1 mid-sweep (tail at full speed), ~0 at
 *            the turnaround. The swim loop multiplies forward motion by this, so
 *            the fish surges on each beat and glides between.
 */
export function tailBeat(clock: number, seed: number, speed: number): { phase: number; thrust: number } {
	// Beat frequency rises with speed (clamped so a still fish still idles a tail).
	const rate = 2 * (0.5 + Math.max(0, speed))
	const phase = clock * rate + seed * Math.PI * 2
	// |sin| gives two power strokes per cycle (tail sweeps both ways); square-ish
	// it slightly so thrust concentrates into the mid-sweep and eases at the ends.
	const s = Math.abs(Math.sin(phase))
	const thrust = s * s
	return { phase, thrust }
}

let mountCount = 0
let off: (() => void) | null = null

/** tldraw's tick gives elapsed ms; advance the clock in seconds. */
function tick(elapsedMs: number) {
	if (elapsedMs > 0) creatureClock.set(creatureClock.get() + elapsedMs / 1000)
}

/**
 * Call from a creature's mount effect (it has the editor via `useEditor()`);
 * returns the matching unsubscribe. The tick listener is attached only while at
 * least one creature is mounted.
 */
export function subscribeCreatureClock(editor: Editor): () => void {
	mountCount++
	creatureCount.set(mountCount)
	if (off === null) {
		editor.on('tick', tick)
		off = () => editor.off('tick', tick)
	}
	return () => {
		mountCount--
		if (mountCount <= 0 && off !== null) {
			off()
			off = null
			mountCount = 0
		}
		creatureCount.set(Math.max(0, mountCount))
	}
}
