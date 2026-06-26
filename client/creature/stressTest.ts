/**
 * CREATURE STRESS TEST  (TEMPORARY dev-only harness — safe to delete)
 * ==================================================================
 * Answers "how many creatures before the app slows down?" by measuring REAL
 * frame rate in the running browser — the part the headless render bench can't
 * see (React reconciliation + SVG repaint + the swim loop's store writes).
 *
 * WHAT IT DOES (driven from the "Stress test" menu item, dev builds only):
 *   1. Drops one big geo "tank" rectangle in the viewport so spawned creatures
 *      actually ROAM (a tankless creature freezes and costs ~nothing — that
 *      would flatter the numbers). All creatures share the one tank.
 *   2. Ramps the population through TIERS (10, 50, 100, … ). At each tier it
 *      spawns the delta, waits a beat for React to mount + the swim loop to pick
 *      them up, then samples FPS over a fixed window via requestAnimationFrame.
 *   3. Logs a table (tier → mean FPS, p5 "worst" FPS, frame ms) to the console
 *      and a final one-line summary of the smooth / usable / wall thresholds.
 *
 * It writes ONLY normal shapes through the editor, so it's just an automated
 * version of clicking "Add creature" a few hundred times — no special hooks.
 * Remove this file and its menu item (client/ui/components.tsx) when done.
 */
import { Editor, TLShapeId, createShapeId } from 'tldraw'

/** Population sizes to sample, cumulative. */
const TIERS = [10, 50, 100, 150, 200, 300, 500, 750, 1000]
/** ms to let React mount + the swim loop adopt new creatures before sampling. */
const SETTLE_MS = 1200
/** ms to sample FPS at each tier. */
const SAMPLE_MS = 2500
/** FPS at/above this = "smooth"; below HALF of refresh = "wall". */
const SMOOTH_FPS = 55
const USABLE_FPS = 30

type TierResult = { count: number; meanFps: number; worstFps: number; frameMs: number }

/** Sample frame rate for `durationMs`, returning mean + p5 (worst) FPS. */
function sampleFps(durationMs: number): Promise<{ meanFps: number; worstFps: number; frameMs: number }> {
	return new Promise((resolve) => {
		const deltas: number[] = []
		let last = performance.now()
		const start = last
		function frame(now: number) {
			deltas.push(now - last)
			last = now
			if (now - start < durationMs) {
				requestAnimationFrame(frame)
			} else {
				const sorted = [...deltas].sort((a, b) => a - b)
				const mean = deltas.reduce((s, d) => s + d, 0) / deltas.length
				// p95 frame time = the slow 5% of frames → the "worst" FPS the user feels.
				const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
				resolve({ meanFps: 1000 / mean, worstFps: 1000 / p95, frameMs: mean })
			}
		}
		requestAnimationFrame(frame)
	})
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Spawn one big tank centred in the viewport; returns its page-space bounds. */
function spawnTank(editor: Editor): { id: TLShapeId; minX: number; minY: number; w: number; h: number } {
	const vp = editor.getViewportPageBounds()
	const w = Math.min(vp.width * 0.9, 1600)
	const h = Math.min(vp.height * 0.9, 1000)
	const minX = vp.center.x - w / 2
	const minY = vp.center.y - h / 2
	const id = createShapeId()
	// A native geo rectangle is what registerSwimming recognizes as a tank.
	editor.createShape({ id, type: 'geo', x: minX, y: minY, props: { geo: 'rectangle', w, h } })
	editor.sendToBack([id])
	return { id, minX, minY, w, h }
}

/** Run the ramp. Logs progress + a final table to the console. */
export async function runCreatureStressTest(editor: Editor) {
	// Clean slate so prior shapes don't skew the numbers.
	const existing = Array.from(editor.getCurrentPageShapeIds())
	if (existing.length) editor.deleteShapes(existing)

	const tank = spawnTank(editor)
	editor.setCurrentTool('select')

	// eslint-disable-next-line no-console
	console.log(
		`%c[creature stress] ramp ${TIERS.join(' → ')} in a ${Math.round(tank.w)}×${Math.round(tank.h)} tank`,
		'font-weight:bold'
	)
	// eslint-disable-next-line no-console
	console.log('refresh ceiling ≈', Math.round(await refreshRate()), 'Hz (your monitor caps FPS at this)')

	const results: TierResult[] = []
	let current = 0
	for (const target of TIERS) {
		// Spawn the delta to reach `target`, scattered across the tank interior so
		// they're all on-screen and roaming (not piled at one point / off-screen).
		const ids: { id: TLShapeId; x: number; y: number }[] = []
		for (let i = current; i < target; i++) {
			const fx = 0.06 + 0.88 * pseudo(i * 2 + 1)
			const fy = 0.06 + 0.88 * pseudo(i * 2 + 2)
			ids.push({
				id: createShapeId(),
				x: tank.minX + fx * tank.w - 30,
				y: tank.minY + fy * tank.h - 16,
			})
		}
		editor.run(
			() => {
				for (const c of ids) editor.createShape({ id: c.id, type: 'creature', x: c.x, y: c.y })
			},
			{ history: 'ignore' }
		)
		current = target

		await wait(SETTLE_MS)
		const { meanFps, worstFps, frameMs } = await sampleFps(SAMPLE_MS)
		results.push({ count: target, meanFps, worstFps, frameMs })
		// eslint-disable-next-line no-console
		console.log(
			`  ${String(target).padStart(4)} creatures  →  ${meanFps.toFixed(0).padStart(3)} fps mean   ` +
				`${worstFps.toFixed(0).padStart(3)} fps worst-5%   ${frameMs.toFixed(1)} ms/frame`
		)
	}

	// eslint-disable-next-line no-console
	console.table(
		results.map((r) => ({
			creatures: r.count,
			'mean fps': Math.round(r.meanFps),
			'worst 5% fps': Math.round(r.worstFps),
			'ms/frame': r.frameMs.toFixed(1),
		}))
	)

	const lastSmooth = [...results].reverse().find((r) => r.worstFps >= SMOOTH_FPS)?.count ?? 0
	const lastUsable = [...results].reverse().find((r) => r.worstFps >= USABLE_FPS)?.count ?? 0
	// eslint-disable-next-line no-console
	console.log(
		`%c[creature stress] smooth (≥${SMOOTH_FPS}fps worst) up to ${lastSmooth} · ` +
			`usable (≥${USABLE_FPS}fps worst) up to ${lastUsable}`,
		'font-weight:bold;color:#2a7'
	)
	return results
}

/** Stable pseudo-random in [0,1) from an integer — scatter without Math.random. */
function pseudo(n: number): number {
	const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
	return x - Math.floor(x)
}

/** Measure the display refresh rate (FPS cap) by timing a short rAF burst. */
function refreshRate(): Promise<number> {
	return sampleFps(400).then((r) => r.meanFps)
}
