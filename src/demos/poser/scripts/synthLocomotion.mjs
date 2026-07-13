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

// Shorthands. A limb angle is built from a base (rest direction, deg) plus a swing.
const sin = (t, phase = 0) => Math.sin((t + phase) * 2 * Math.PI)

// ── Walk ──────────────────────────────────────────────────────────────────────
// Legs alternate (half-cycle out of phase); arms counter-swing to the legs; a gentle
// two-per-cycle vertical bob on the pelvis. Down-pointing rest ≈ +90°; we swing the
// thighs ±swing around vertical and bend the shins on the back-swing.
const walk = makeClip({
	name: 'Walk (loop)',
	fps: 12,
	pose: (t) => {
		const s = sin(t) // right side leads
		const s2 = sin(t, 0.5) // left side (opposite)
		const thighSwing = 22
		const armSwing = 18
		return {
			angles: {
				spine: -90,
				neck: -90,
				head: -90,
				// Arms hang ~ +90° (down); counter-swing to opposite legs.
				'upper-arm-r': round(95 + armSwing * s2),
				'forearm-r': round(100 + 8 * Math.max(0, s2)),
				'upper-arm-l': round(95 + armSwing * s),
				'forearm-l': round(100 + 8 * Math.max(0, s)),
				// Legs swing around straight-down (+90°); shin bends most as the leg lifts.
				'thigh-r': round(90 + thighSwing * s),
				'shin-r': round(95 + 30 * Math.max(0, -s)),
				'thigh-l': round(90 + thighSwing * s2),
				'shin-l': round(95 + 30 * Math.max(0, -s2)),
			},
			// Bob down twice per stride (once per foot-plant); small.
			pelvis: { drop: round(6 + 6 * Math.abs(sin(t, 0.25))), lean: -88 },
		}
	},
})

// ── Run ─────────────────────────────────────────────────────────────────────
// Like walk but bigger swings, forward torso lean, deeper knee bend, more airborne bob.
const run = makeClip({
	name: 'Run (loop)',
	fps: 16,
	pose: (t) => {
		const s = sin(t)
		const s2 = sin(t, 0.5)
		return {
			angles: {
				spine: -78, // leaning forward into the run
				neck: -82,
				head: -82,
				'upper-arm-r': round(70 + 45 * s2), // arms pump hard, bent
				'forearm-r': round(55),
				'upper-arm-l': round(70 + 45 * s),
				'forearm-l': round(55),
				'thigh-r': round(90 + 40 * s),
				'shin-r': round(80 + 55 * Math.max(0, -s)),
				'thigh-l': round(90 + 40 * s2),
				'shin-l': round(80 + 55 * Math.max(0, -s2)),
			},
			pelvis: { drop: round(10 * Math.abs(sin(t, 0.25))), lean: -78 },
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
