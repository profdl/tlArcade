/**
 * CREATURE RENDER BENCHMARK  (framework-free, run via node)
 * =========================================================
 * Measures the per-render hotpath of CreatureShape — building the fish geometry
 * (creatureFish) and running BOTH outlines through tldraw's real perfect-freehand
 * pipeline (getStrokePoints → getSvgPathFromStrokePoints), which is the dominant
 * cost when dash:'draw' (the default we're keeping).
 *
 * It mirrors the actual render math in client/shapes/CreatureShape.tsx — SEGMENTS,
 * creatureFish(), and the closedPath() freehand call — so the numbers track what
 * the browser actually does each animation step. It does NOT measure React/DOM or
 * sync; it isolates the CPU-bound geometry that scales with creature count.
 *
 * For each fleet size it reports:
 *   • per-path  — µs to build one creature's body+tail paths once
 *   • frame     — ms to rebuild ALL visible creatures once (one animation step)
 *   • steps/s   — the adaptive quantization rate at that count (animationStepsPerSec)
 *   • render budget/s — frame · steps/s = ms of CPU/sec spent on path building
 *     (compared at the OLD fixed 30 steps/s and SEGMENTS=28 to show the win)
 *
 * Run:  node --experimental-strip-types client/creature/__tests__/render-bench.mjs
 */
import { createRequire } from 'node:module'
import { performance } from 'node:perf_hooks'

const require = createRequire(import.meta.url)
const { getStrokePoints } = require(
	'../../../node_modules/tldraw/dist-cjs/lib/shapes/shared/freehand/getStrokePoints.js'
)
const { getSvgPathFromStrokePoints } = require(
	'../../../node_modules/tldraw/dist-cjs/lib/shapes/shared/freehand/svg.js'
)

// ── replicate the adaptive step rate from client/creature/clock.ts ──────────────
function animationStepsPerSec(count) {
	if (count <= 60) return 60
	if (count <= 150) return 30
	if (count <= 300) return 16
	return 8
}

// ── replicate creatureFish() from CreatureShape.tsx, parameterized by SEGMENTS ──
function creatureFish(w, h, seed, beat, bank, SEGMENTS) {
	const x0 = w * 0.06
	const xPed = w * 0.78
	const len = xPed - x0
	const cy = h * 0.5
	const freq = 2.2 + seed * 1.5
	const spine = (u) => cy + h * 0.08 * u * Math.sin(freq * u - beat) + bank * h * 0.16 * u * u
	const radius = (u) => {
		const fat = Math.pow(Math.sin(Math.PI * Math.min(1, u * 0.62 + 0.06)), 0.8)
		return h * 0.34 * fat * (1 - 0.78 * u)
	}
	const top = []
	const bottom = []
	for (let i = 0; i <= SEGMENTS; i++) {
		const u = i / SEGMENTS
		const x = x0 + u * len
		top.push({ x, y: spine(u) - radius(u) })
		bottom.unshift({ x, y: spine(u) + radius(u) })
	}
	const body = [...top, ...bottom]
	const pedY = spine(1)
	const pedR = radius(1)
	const swing = h * 0.16 * Math.sin(beat)
	const finX = w * 0.97
	const tail = [
		{ x: xPed, y: pedY - pedR },
		{ x: finX, y: pedY - h * 0.3 + swing },
		{ x: w * 0.86, y: pedY + swing * 0.5 },
		{ x: finX, y: pedY + h * 0.3 + swing },
		{ x: xPed, y: pedY + pedR },
	]
	return { body, tail }
}

// the real draw-mode closedPath() from CreatureShape.tsx
function closedPath(pts, strokeWidth) {
	const sp = getStrokePoints(pts, { size: strokeWidth, streamline: 0.4, last: true })
	return getSvgPathFromStrokePoints(sp, true)
}

// Build one creature's two paths (body + tail) — exactly what a render does.
function renderOne(seed, beat, bank, segments, strokeWidth) {
	const fish = creatureFish(120, 64, seed, beat, bank, segments)
	const bodyD = closedPath(fish.body, strokeWidth)
	const tailD = closedPath(fish.tail, strokeWidth)
	return bodyD.length + tailD.length // touch the result so nothing is optimized away
}

// Time the average cost of one renderOne over `iters`, varying beat/seed per call
// so the work is realistic (no constant-folding).
function timePerPath(segments, strokeWidth, iters) {
	let sink = 0
	const t0 = performance.now()
	for (let i = 0; i < iters; i++) {
		const seed = (i % 100) / 100
		const beat = (i % 360) * (Math.PI / 180)
		const bank = Math.sin(i * 0.013) * 0.5
		sink += renderOne(seed, beat, bank, segments, strokeWidth)
	}
	const ms = performance.now() - t0
	if (sink < 0) throw new Error('unreachable') // keep sink live
	return (ms / iters) * 1000 // µs per creature (body+tail)
}

const STROKE_WIDTH = 1.75 // theme.strokeWidth(1) * STROKE_SIZES['m'](1.75)
const FLEETS = [10, 50, 100, 150, 200, 300, 500, 1000]

console.log('Creature render benchmark — dash:draw (perfect-freehand path build)')
console.log('Node', process.version, '·', process.platform, process.arch)
console.log('warming up…')
timePerPath(20, STROKE_WIDTH, 5000) // JIT warm-up

// Calibrate per-path cost once at each SEGMENTS value (it's independent of fleet).
const perPathNew = timePerPath(20, STROKE_WIDTH, 20000) // SEGMENTS = 20 (new)
const perPathOld = timePerPath(28, STROKE_WIDTH, 20000) // SEGMENTS = 28 (old)

console.log(
	`\nper-creature path build:  new(SEG=20) ${perPathNew.toFixed(1)}µs   old(SEG=28) ${perPathOld.toFixed(1)}µs   ` +
		`(${(((perPathOld - perPathNew) / perPathOld) * 100).toFixed(0)}% cheaper)\n`
)

const pad = (s, n) => String(s).padStart(n)
console.log(
	`${pad('fleet', 6)} | ${pad('frame ms', 9)} | ${pad('steps/s', 8)} | ${pad('NEW ms/s', 9)} | ${pad('OLD ms/s', 9)} | speedup`
)
console.log('-'.repeat(70))
for (const n of FLEETS) {
	// NEW: SEGMENTS=20, adaptive steps/s
	const frameNew = (perPathNew * n) / 1000 // ms to rebuild all N once
	const stepsNew = animationStepsPerSec(n)
	const budgetNew = frameNew * stepsNew // ms of path-build CPU per second
	// OLD: SEGMENTS=28, fixed 30 steps/s
	const frameOld = (perPathOld * n) / 1000
	const budgetOld = frameOld * 30
	const speedup = budgetOld / budgetNew
	console.log(
		`${pad(n, 6)} | ${pad(frameNew.toFixed(2), 9)} | ${pad(stepsNew, 8)} | ${pad(budgetNew.toFixed(0), 9)} | ${pad(budgetOld.toFixed(0), 9)} | ${speedup.toFixed(2)}×`
	)
}
console.log(
	'\nNEW ms/s = CPU-ms spent rebuilding paths per wall-second. 1000ms/s = one core saturated\n' +
		'just on path geometry (before React/DOM/sync). Lower is more headroom for everything else.'
)
