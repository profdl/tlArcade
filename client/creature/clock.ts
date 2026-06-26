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
	}
}
