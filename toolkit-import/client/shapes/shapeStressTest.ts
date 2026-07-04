/**
 * SHAPE STRESS TEST  (TEMPORARY dev-only harness — safe to delete)
 * ===============================================================
 * One parameterized FPS-ramp harness for any animated shape, so bloom / hydra / frond
 * (and anything else) all run the SAME protocol and are directly comparable. Replaces
 * the three near-identical per-shape files.
 *
 * Measures REAL browser frame rate (the part a headless bench can't see): at each tier
 * it replaces the whole population with a tight grid, ZOOMS TO FIT so every shape stays
 * on-screen (a culled shape freezes and would flatter the numbers), settles, then
 * samples mean / worst-5% FPS over a window. Logs a table + a smooth/usable/wall verdict.
 *
 * Driven from the DEV-only "Stress test (…)" menu items in client/ui/components.tsx.
 * Remove this file + those items when done.
 */
import { Editor, TLShape, TLShapeId, TLShapePartial, createShapeId } from 'tldraw'

const DEFAULT_TIERS = [10, 25, 50, 100, 150, 250, 400, 600]
const SETTLE_MS = 1200
const SAMPLE_MS = 2500
const SHAPE_SIZE = 110

type TierResult = { count: number; meanFps: number; worstFps: number; frameMs: number }

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
				const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
				resolve({ meanFps: 1000 / mean, worstFps: 1000 / p95, frameMs: mean })
			}
		}
		requestAnimationFrame(frame)
	})
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function layout(target: number): { id: TLShapeId; x: number; y: number }[] {
	const cols = Math.ceil(Math.sqrt(target))
	const gap = SHAPE_SIZE * 1.15
	const out: { id: TLShapeId; x: number; y: number }[] = []
	for (let i = 0; i < target; i++) {
		out.push({ id: createShapeId(), x: (i % cols) * gap, y: Math.floor(i / cols) * gap })
	}
	return out
}

/** Ramp `type` through `tiers`, keeping every shape on-screen, sampling real FPS. */
export async function runShapeStressTest(editor: Editor, type: TLShape['type'], tiers: number[] = DEFAULT_TIERS) {
	const existing = Array.from(editor.getCurrentPageShapeIds())
	if (existing.length) editor.deleteShapes(existing)
	editor.setCurrentTool('select')

	// eslint-disable-next-line no-console
	console.log(`%c[${type} stress] ramp ${tiers.join(' → ')} (all kept on-screen)`, 'font-weight:bold')
	// eslint-disable-next-line no-console
	console.log('refresh ceiling ≈', Math.round(await refreshRate()), 'Hz')

	const results: TierResult[] = []
	for (const target of tiers) {
		const prev = Array.from(editor.getCurrentPageShapeIds())
		const shapes = layout(target)
		editor.run(
			() => {
				if (prev.length) editor.deleteShapes(prev)
				for (const s of shapes) editor.createShape({ id: s.id, type, x: s.x, y: s.y } as TLShapePartial)
			},
			{ history: 'ignore' }
		)
		editor.zoomToFit({ animation: { duration: 0 } })

		await wait(SETTLE_MS)
		const { meanFps, worstFps, frameMs } = await sampleFps(SAMPLE_MS)
		results.push({ count: target, meanFps, worstFps, frameMs })
		// eslint-disable-next-line no-console
		console.log(
			`  ${String(target).padStart(4)} ${type}  →  ${meanFps.toFixed(0).padStart(3)} fps mean   ` +
				`${worstFps.toFixed(0).padStart(3)} fps worst-5%   ${frameMs.toFixed(1)} ms/frame`
		)
	}

	// eslint-disable-next-line no-console
	console.table(
		results.map((r) => ({
			[type]: r.count,
			'mean fps': Math.round(r.meanFps),
			'worst-5% fps': Math.round(r.worstFps),
			'ms/frame': r.frameMs.toFixed(1),
		}))
	)

	const smooth = [...results].reverse().find((r) => r.meanFps >= 55)?.count
	const usable = [...results].reverse().find((r) => r.meanFps >= 30)?.count
	const wall = results.find((r) => r.meanFps < 30)?.count
	// eslint-disable-next-line no-console
	console.log(
		`%c[${type} stress] smooth (≥55fps) ≤ ${smooth ?? '?'} · usable (≥30fps) ≤ ${usable ?? '?'} · ` +
			`wall (<30fps) at ${wall ?? '> ' + tiers[tiers.length - 1]}`,
		'font-weight:bold;color:#2a7'
	)
	return results
}

function refreshRate(): Promise<number> {
	return sampleFps(400).then((r) => r.meanFps)
}
