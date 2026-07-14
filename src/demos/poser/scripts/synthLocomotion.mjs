// Procedurally synthesize perfectly-looping locomotion clips (walk / run / idle / jump)
// for the Poser catalog, and PREPEND them to poses/poseCatalog.json.
//
//   node src/demos/poser/scripts/synthLocomotion.mjs
//
// Why this exists alongside buildPoseCatalog.mjs: the HumanML3D-derived clips are real
// mocap but their loop seams need blending, and the fetch needs network/HF access. These
// synthetic cycles are stylized (sinusoidal), fully offline, and loop PERFECTLY by
// construction — every channel is a function of a phase that closes on itself, so frame
// N-1 → frame 0 is continuous with zero seam work. They give the Locomotion group usable
// walk/run/idle/jump immediately; re-running buildPoseCatalog.mjs replaces the mocap
// entries around them without touching these (they're matched by name and re-prepended).
//
// Angle convention (must match buildPoseCatalog.mjs / applyPose.ts): page space, y-DOWN,
// 0° = +x (right), so straight-up = -90°. The rig's rest spine is ~-90°; a bone hanging
// straight down is +90°. Left/right (…-l / …-r) are the figure's, mirrored to screen.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const CATALOG = join(HERE, '..', 'poses', 'poseCatalog.json')

const FRAMES = 24 // keyframes per cycle — smooth loop, small JSON
const DEG = 180 / Math.PI
const round = (n) => +n.toFixed(1)

// Build a clip: `channel(name, phase01)` returns each bone's angle (deg) and the pelvis
// {drop, lean} as a function of normalized cycle phase (0..1, exclusive of 1 so the loop
// closes). We sample FRAMES phases, take the mid-frame as the static preview.
function makeClip({ name, fps, pose }) {
	const frames = []
	for (let i = 0; i < FRAMES; i++) {
		const t = i / FRAMES // 0 .. <1
		frames.push(pose(t))
	}
	const mid = frames[Math.floor(FRAMES / 2)]
	return { name, category: 'locomotion', angles: mid.angles, pelvis: mid.pelvis, frames, fps }
}

// Shorthands.
const sin = (t, phase = 0) => Math.sin((t + phase) * 2 * Math.PI)
const TAU = 2 * Math.PI
// Smooth 0→1→0 pulse peaking at the centre of [lo,hi] within a [0,1) phase, 0 outside —
// used to place a knee fold or foot-lift inside a specific slice of the gait cycle. `wrap`
// handles a window that straddles the 0/1 seam (e.g. swing spanning 0.9→0.15).
function pulse(phase, lo, hi) {
	let p = phase
	if (hi < lo) {
		// window wraps the seam: shift into a contiguous range
		if (p < lo) p += 1
		hi += 1
	}
	if (p < lo || p > hi) return 0
	return 0.5 - 0.5 * Math.cos(((p - lo) / (hi - lo)) * TAU) // 0 at edges, 1 at centre
}

// One leg of a SIDE-READ 2D walk/run, driven by the leg's own cycle PHASE φ∈[0,1):
//   φ=0    contact — foot forward, knee ~straight (heel strike)
//   φ=0.25 mid-stance — foot under body, knee slightly bent under load
//   φ=0.5  push-off — foot back, knee straight (toe-off)
//   φ~0.75 swing — foot lifts and travels forward, KNEE FOLDS HARD to clear the ground
// The thigh sweeps forward→back across stance (φ 0→0.5) then whips back to front across
// swing (φ 0.5→1). The knee fold lives in the swing window, which is the fix: previously
// it peaked at mid-stance, reading as a limp. Both legs use this same model (just half a
// cycle apart), so both knees fold the same screen direction — never mirrored.
//   thigh: 90° = straight down; forward = smaller angle, back = larger.
//   shin:  thigh + bend, bend ≥ 0 (knee only folds one way).
function gaitLeg(phase, { reach, swingBend, stanceBend = swingBend * 0.18 }) {
	const p = ((phase % 1) + 1) % 1
	// Thigh fore/aft: +reach forward at contact, −reach back at push-off, smooth between.
	// cos(2πφ): +1 at φ=0 (forward contact), −1 at φ=0.5 (back push-off). Good.
	const thigh = 90 - reach * Math.cos(p * TAU)
	// Knee: a big fold through swing (centred ~φ=0.72, so the leg clears as it comes
	// forward) plus a small load-absorbing bend through mid-stance (centred ~φ=0.18).
	const bend = swingBend * pulse(p, 0.52, 0.95) + stanceBend * pulse(p, 0.05, 0.32)
	return { thigh: round(thigh), shin: round(thigh + bend) }
}

// The arm swings WITH its same-side leg (arm forward when that leg is forward). `phase` is
// the leg's phase. Like the knees, the elbow bends ONE consistent screen direction — and
// like the knee (which juts forward with the shin trailing), the forearm folds to the
// NEGATIVE side of the upper arm (`upper - bend`), so the elbow leads and the forearm
// hangs back/down rather than swinging up in front. `bend` stays ≥ 0 (one-way fold). The
// fold is largest as the arm swings FORWARD, least when it's back.
function gaitArm(phase, { rest, swing, elbow }) {
	const p = ((phase % 1) + 1) % 1
	const s = Math.cos(p * TAU) // +1 when same-side leg is forward → arm goes FORWARD too
	const upper = rest - swing * s // matches the leg: forward (smaller angle) when leg forward
	// s = +1 (arm fully forward) → max fold; s = −1 (arm back) → the resting fold only.
	const bend = elbow.rest + elbow.amp * (0.5 + 0.5 * s) // rest..rest+amp, ≥ 0
	return { upper: round(upper), fore: round(upper - bend) }
}

// ── Walk ──────────────────────────────────────────────────────────────────────
// A standard 2-beat walk. Right leg leads; left is half a cycle behind. Knee folds in
// swing, arms oppose their same-side leg, pelvis bobs down at each foot-plant (twice per
// cycle) and eases a hair forward.
const walk = makeClip({
	name: 'Walk (loop)',
	fps: 12,
	pose: (t) => {
		const legR = gaitLeg(t, { reach: 30, swingBend: 46 })
		const legL = gaitLeg(t + 0.5, { reach: 30, swingBend: 46 })
		// elbow fold is RELATIVE to the upper arm: ~12° resting, +18° as the arm swings front.
		const armR = gaitArm(t, { rest: 95, swing: 20, elbow: { rest: 12, amp: 18 } })
		const armL = gaitArm(t + 0.5, { rest: 95, swing: 20, elbow: { rest: 12, amp: 18 } })
		return {
			angles: {
				spine: -90,
				neck: -90,
				head: -90,
				'upper-arm-r': armR.upper,
				'forearm-r': armR.fore,
				'upper-arm-l': armL.upper,
				'forearm-l': armL.fore,
				'thigh-r': legR.thigh,
				'shin-r': legR.shin,
				'thigh-l': legL.thigh,
				'shin-l': legL.shin,
			},
			// Pelvis dips at each foot-plant: two dips per cycle (|sin| at 2×), small.
			pelvis: { drop: round(4 + 7 * Math.abs(sin(t, 0.25))), lean: -89 },
		}
	},
})

// ── Run ─────────────────────────────────────────────────────────────────────
// Bigger reach, deeper swing-knee fold, forward torso lean, harder bent arms, and a real
// airborne bob. Same phase model as walk — only the amplitudes and lean change.
const run = makeClip({
	name: 'Run (loop)',
	fps: 16,
	pose: (t) => {
		const legR = gaitLeg(t, { reach: 46, swingBend: 78, stanceBend: 22 })
		const legL = gaitLeg(t + 0.5, { reach: 46, swingBend: 78, stanceBend: 22 })
		// Runners hold elbows hard-bent (~75°) throughout, tucking a touch more up front.
		const armR = gaitArm(t, { rest: 68, swing: 40, elbow: { rest: 75, amp: 15 } })
		const armL = gaitArm(t + 0.5, { rest: 68, swing: 40, elbow: { rest: 75, amp: 15 } })
		return {
			angles: {
				spine: -76, // leaning forward into the run
				neck: -80,
				head: -80,
				'upper-arm-r': armR.upper,
				'forearm-r': armR.fore,
				'upper-arm-l': armL.upper,
				'forearm-l': armL.fore,
				'thigh-r': legR.thigh,
				'shin-r': legR.shin,
				'thigh-l': legL.thigh,
				'shin-l': legL.shin,
			},
			// One airborne push per stride → bob dips deeper, twice per cycle.
			pelvis: { drop: round(2 + 12 * Math.abs(sin(t, 0.25))), lean: -76 },
		}
	},
})

// ── Idle ────────────────────────────────────────────────────────────────────
// Standing rest with a slow breathing bob and a faint weight-shift sway. One breath
// per cycle so it loops seamlessly at a calm pace.
const idle = makeClip({
	name: 'Idle (loop)',
	fps: 8,
	pose: (t) => {
		const breath = sin(t) // one slow cycle
		const sway = sin(t, 0) * 1.5
		return {
			angles: {
				spine: round(-90 + sway * 0.5),
				neck: -90,
				head: round(-90 + breath * 1.5),
				'upper-arm-r': round(100 + breath * 1.2),
				'forearm-r': round(102),
				'upper-arm-l': round(100 + breath * 1.2),
				'forearm-l': round(102),
				'thigh-r': round(90 + sway),
				'shin-r': 92,
				'thigh-l': round(90 - sway),
				'shin-l': 92,
			},
			pelvis: { drop: round(2 + 2 * breath), lean: -90 },
		}
	},
})

// ── Jump ────────────────────────────────────────────────────────────────────
// A single crouch → launch → tuck → land cycle. Phase-driven so it loops (land settles
// back to the crouch it started from). Knees bend on crouch/land, extend at apex; arms
// throw up at launch; pelvis rises (drop→0) at apex, sinks (big drop) on crouch/land.
const jump = makeClip({
	name: 'Jump (loop)',
	fps: 14,
	pose: (t) => {
		// crouch at t=0/1, apex near t=0.5. `lift` 0..1 how airborne; `crouch` its inverse.
		const lift = (1 - Math.cos(t * 2 * Math.PI)) / 2 // 0 → 1 → 0
		const crouch = 1 - lift
		const armUp = lift // arms rise with the launch
		return {
			angles: {
				spine: round(-90 + crouch * 8), // lean forward when crouched
				neck: -90,
				head: -90,
				// Arms swing from down (crouch) to overhead (apex): +90° → -80°.
				'upper-arm-r': round(90 - 170 * armUp),
				'forearm-r': round(90 - 20 * armUp),
				'upper-arm-l': round(90 - 170 * armUp),
				'forearm-l': round(90 - 20 * armUp),
				// Knees deeply bent when crouched, straight at apex, tuck slightly airborne.
				'thigh-r': round(90 - crouch * 15 + lift * 5),
				'shin-r': round(90 + crouch * 55 - lift * 5),
				'thigh-l': round(90 - crouch * 15 + lift * 5),
				'shin-l': round(90 + crouch * 55 - lift * 5),
			},
			// Deep drop when crouched, rises to (and slightly above) baseline at apex.
			pelvis: { drop: round(crouch * 70), lean: -90 },
		}
	},
})

const SYNTH = [walk, run, idle, jump]
const SYNTH_NAMES = new Set(SYNTH.map((c) => c.name))

// Prepend the synthetic loops, replacing any prior synth entries (idempotent re-run).
const existing = JSON.parse(readFileSync(CATALOG, 'utf8')).filter((p) => !SYNTH_NAMES.has(p.name))
const merged = [...SYNTH, ...existing]
writeFileSync(CATALOG, JSON.stringify(merged, null, 2) + '\n')
process.stderr.write(`prepended ${SYNTH.length} synthetic loops; catalog now ${merged.length} poses\n`)
