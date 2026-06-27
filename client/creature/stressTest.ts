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
import type { CreatureKind } from '../../shared/shape-schemas'
import { getSwimOpts, setSwimOpts, type SwimOpts } from './registerSwimming'

/** Which creature KIND this harness ramps (all freeze unless over a tank). The
 *  line-fish is now a `creature` of kind 'lineFish', so the harness ramps kinds of
 *  the ONE creature shape — not separate shape types. */
const DEFAULT_KIND: CreatureKind = 'fish'

/** Population sizes to sample, cumulative. */
const TIERS = [10, 50, 100, 150, 200, 300, 500, 750, 1000]
/** ms to let React mount + the swim loop adopt new creatures before sampling. */
const SETTLE_MS = 1200
/** ms to sample FPS at each tier. */
const SAMPLE_MS = 2500

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

/** One ramp pass: spawn up to each tier and sample FPS. Returns per-tier results. */
async function rampPass(editor: Editor, tank: ReturnType<typeof spawnTank>, label: string, kind: CreatureKind): Promise<TierResult[]> {
	const results: TierResult[] = []
	let current = 0
	for (const target of TIERS) {
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
				for (const c of ids) editor.createShape({ id: c.id, type: 'creature', x: c.x, y: c.y, props: { kind } })
			},
			{ history: 'ignore' }
		)
		current = target

		await wait(SETTLE_MS)
		const { meanFps, worstFps, frameMs } = await sampleFps(SAMPLE_MS)
		results.push({ count: target, meanFps, worstFps, frameMs })
		// eslint-disable-next-line no-console
		console.log(
			`  [${label}] ${String(target).padStart(4)} ${kind}  →  ${meanFps.toFixed(0).padStart(3)} fps mean   ` +
				`${worstFps.toFixed(0).padStart(3)} fps worst-5%   ${frameMs.toFixed(1)} ms/frame`
		)
	}
	return results
}

/**
 * Run the ramp TWICE — once with the swim loop ON (full), once with it OFF
 * (render-only, via window.__SWIM_OFF). Comparing the two isolates whether the
 * per-tick O(N) swim work or the rendering is the scaling bottleneck: if FPS jumps
 * a lot with swim OFF, the swim loop is the cost; if it barely moves, rendering is.
 * Prints a side-by-side delta table.
 */
export async function runCreatureStressTest(editor: Editor, kind: CreatureKind = DEFAULT_KIND) {
	// Clean slate so prior shapes don't skew the numbers.
	const existing = Array.from(editor.getCurrentPageShapeIds())
	if (existing.length) editor.deleteShapes(existing)

	const tank = spawnTank(editor)
	editor.setCurrentTool('select')

	// eslint-disable-next-line no-console
	console.log(
		`%c[${kind} stress] A/B ramp ${TIERS.join(' → ')} in a ${Math.round(tank.w)}×${Math.round(tank.h)} tank`,
		'font-weight:bold'
	)
	// eslint-disable-next-line no-console
	console.log('refresh ceiling ≈', Math.round(await refreshRate()), 'Hz (your monitor caps FPS at this)')

	// PASS 1: full (swim on).
	window.__SWIM_OFF = false
	// eslint-disable-next-line no-console
	console.log('%c— PASS 1: FULL (swim loop ON) —', 'font-weight:bold')
	const full = await rampPass(editor, tank, 'full', kind)

	// Reset population for a clean second pass.
	const mid = Array.from(editor.getCurrentPageShapeIds()).filter((id) => id !== tank.id)
	if (mid.length) editor.deleteShapes(mid)
	await wait(SETTLE_MS)

	// PASS 2: render-only (swim off).
	window.__SWIM_OFF = true
	// eslint-disable-next-line no-console
	console.log('%c— PASS 2: RENDER-ONLY (swim loop OFF) —', 'font-weight:bold')
	const renderOnly = await rampPass(editor, tank, 'rndr', kind)
	window.__SWIM_OFF = false // restore

	// Side-by-side delta.
	// eslint-disable-next-line no-console
	console.table(
		TIERS.map((count, i) => {
			const f = full[i]
			const r = renderOnly[i]
			return {
				[kind]: count,
				'FULL mean': Math.round(f.meanFps),
				'FULL ms': f.frameMs.toFixed(1),
				'RENDER-ONLY mean': Math.round(r.meanFps),
				'RENDER-ONLY ms': r.frameMs.toFixed(1),
				'swim cost ms/frame': (f.frameMs - r.frameMs).toFixed(1),
			}
		})
	)

	const verdict =
		'If RENDER-ONLY is much faster than FULL, the swim loop (O(N) hit-tests/tick) is the ' +
		'bottleneck — cheap to fix. If they track closely, rendering is the wall — needs the overlay.'
	// eslint-disable-next-line no-console
	console.log(`%c[${kind} stress] ${verdict}`, 'font-weight:bold;color:#2a7')
	return { full, renderOnly }
}

// ── A/B/C OPTIMIZATION COMPARISON ──────────────────────────────────────────────
/**
 * Population to hold while measuring each optimization's effect. Picked in the range
 * where the A/B/C ramp showed the SWIM LOOP (not rendering) dominating the frame — so a
 * change in hit-testing cost actually moves the number. ~500 is past the render wall but
 * not so deep that everything pins at single-digit FPS (where deltas are unreadable).
 */
const OPT_TEST_COUNT = 500
/** Longer FPS window than the ramp — we're chasing smaller deltas, so average more frames. */
const OPT_SAMPLE_MS = 4000

/** Spawn `n` creatures of `kind`, scattered across the tank. */
function spawnCreatures(editor: Editor, tank: ReturnType<typeof spawnTank>, n: number, kind: CreatureKind): void {
	const ids: { id: TLShapeId; x: number; y: number }[] = []
	for (let i = 0; i < n; i++) {
		const fx = 0.06 + 0.88 * pseudo(i * 2 + 1)
		const fy = 0.06 + 0.88 * pseudo(i * 2 + 2)
		ids.push({ id: createShapeId(), x: tank.minX + fx * tank.w - 30, y: tank.minY + fy * tank.h - 16 })
	}
	editor.run(
		() => {
			for (const c of ids) editor.createShape({ id: c.id, type: 'creature', x: c.x, y: c.y, props: { kind } })
		},
		{ history: 'ignore' }
	)
}

/**
 * Measure how much EACH hit-testing optimization (A=spatial index, B=shared clusters,
 * C=amortized clearance) contributes, by holding a fixed heavy population and sampling
 * FPS under different flag combinations of the swim loop.
 *
 * The configs are chosen to attribute cost cleanly:
 *   • "none"        — all three OFF: the pre-optimization baseline.
 *   • "A only" / "B only" / "C only" — each opt alone vs the baseline = its OWN contribution.
 *   • "all"         — all three ON: the shipped path; vs "none" = the total win.
 * Comparing "all" against each "X off" (the leave-one-out you can read by eye from the
 * single-opt rows) shows whether the opts are additive or overlap. The swim loop reads the
 * flags live each tick, so flipping them needs no respawn — same fish, same positions,
 * only the hit-testing path changes, which is the cleanest possible isolation.
 */
export async function runSwimOptStressTest(editor: Editor, kind: CreatureKind = DEFAULT_KIND) {
	const saved = getSwimOpts() // restore the user's flags when we're done

	// Clean slate, one tank, one fixed population for the whole comparison.
	const existing = Array.from(editor.getCurrentPageShapeIds())
	if (existing.length) editor.deleteShapes(existing)
	const tank = spawnTank(editor)
	editor.setCurrentTool('select')
	window.__SWIM_OFF = false
	spawnCreatures(editor, tank, OPT_TEST_COUNT, kind)
	await wait(SETTLE_MS)

	// eslint-disable-next-line no-console
	console.log(
		`%c[${kind} opt-test] ${OPT_TEST_COUNT} ${kind} in a ${Math.round(tank.w)}×${Math.round(tank.h)} tank — ` +
			`A=spatialIndex B=sharedClusters C=amortizeClearance D=batchWrites`,
		'font-weight:bold'
	)

	const OFF: SwimOpts = {
		useSpatialIndex: false,
		useSharedClusters: false,
		amortizeClearance: false,
		batchWrites: false,
	}
	const configs: { label: string; opts: SwimOpts }[] = [
		{ label: 'none (baseline)', opts: { ...OFF } },
		{ label: 'A only', opts: { ...OFF, useSpatialIndex: true } },
		{ label: 'B only', opts: { ...OFF, useSharedClusters: true } },
		{ label: 'C only', opts: { ...OFF, amortizeClearance: true } },
		{ label: 'D only', opts: { ...OFF, batchWrites: true } },
		{
			label: 'all (A+B+C+D)',
			opts: { useSpatialIndex: true, useSharedClusters: true, amortizeClearance: true, batchWrites: true },
		},
	]

	const rows: { config: string; meanFps: number; worstFps: number; frameMs: number }[] = []
	let baselineMs = 0
	for (const cfg of configs) {
		setSwimOpts(cfg.opts)
		await wait(SETTLE_MS) // let the new path settle (cluster cache rebuild, etc.)
		const { meanFps, worstFps, frameMs } = await sampleFps(OPT_SAMPLE_MS)
		rows.push({ config: cfg.label, meanFps, worstFps, frameMs })
		if (cfg.label.startsWith('none')) baselineMs = frameMs
		// eslint-disable-next-line no-console
		console.log(
			`  [${cfg.label.padEnd(15)}]  ${meanFps.toFixed(0).padStart(3)} fps mean   ` +
				`${worstFps.toFixed(0).padStart(3)} fps worst-5%   ${frameMs.toFixed(1)} ms/frame`
		)
	}

	// Table with each config's ms saved vs the baseline (positive = faster).
	// eslint-disable-next-line no-console
	console.table(
		rows.map((r) => ({
			config: r.config,
			'mean fps': Math.round(r.meanFps),
			'worst-5% fps': Math.round(r.worstFps),
			'ms/frame': r.frameMs.toFixed(1),
			'ms saved vs baseline': (baselineMs - r.frameMs).toFixed(1),
		}))
	)
	// eslint-disable-next-line no-console
	console.log(
		`%c[${kind} opt-test] Each single-opt row minus "none" = that opt's own win; "all" minus "none" = total. ` +
			`If single wins sum to ≈ the total, they're additive; if "all" < the sum, they overlap.`,
		'font-weight:bold;color:#2a7'
	)

	setSwimOpts(saved) // restore
	return rows
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
