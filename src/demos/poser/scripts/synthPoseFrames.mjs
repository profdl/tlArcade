// TEMPORARY synth generator: adds a `frames[]` + `fps` motion sequence to each
// pose in poseCatalog.json by easing rest → target → rest, so the Play/Stop
// feature is fully functional while HuggingFace's datasets-server is unavailable.
//
//   node src/demos/poser/scripts/synthPoseFrames.mjs
//
// It rewrites poseCatalog.json IN PLACE, preserving the existing static top-level
// `angles`/`pelvis` (the mid-frame) and only appending `frames`/`fps`. The frame
// SCHEMA is identical to what buildPoseCatalog.mjs emits from real HumanML3D
// motion, so once datasets-server recovers, re-running the real build replaces
// these synthesized clips with the authentic per-frame motion — no code changes.
//
// This file can be deleted once the real catalog has been generated.

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CATALOG = join(HERE, '..', 'poses', 'poseCatalog.json')

const FPS = 20 // match HumanML3D's native capture rate
const FRAMES = 32 // clip length: rest → hold → rest

// The rig-template rest angles for the posable bones (from rig/buildFigure.ts).
// Bones a pose omits fall back to these, and every clip starts/ends here.
const REST_ANGLES = {
	spine: -90, neck: -90, head: -90,
	'upper-arm-l': 100, 'forearm-l': 95, 'upper-arm-r': 80, 'forearm-r': 85,
	'thigh-l': 92, 'shin-l': 90, 'thigh-r': 88, 'shin-r': 90,
}
const REST_PELVIS = { drop: 0, lean: -90 }

// Smoothstep ease for a natural in/out, plus a hold near the top so the target
// pose is clearly readable mid-clip.
const smooth = (t) => t * t * (3 - 2 * t)
function envelope(i, n) {
	const t = i / (n - 1) // 0..1 across the clip
	// Ramp up over the first third, hold, ramp down over the last third → triangle
	// with eased shoulders, peaking at the target pose.
	const up = smooth(Math.min(1, t / 0.34))
	const down = smooth(Math.min(1, (1 - t) / 0.34))
	return Math.min(up, down)
}

// Shortest-path angular lerp (degrees) so a limb takes the short way to its target.
function lerpAngle(a, b, w) {
	let d = ((b - a) % 360 + 540) % 360 - 180 // signed shortest delta in (-180,180]
	return +(a + d * w).toFixed(1)
}
const lerp = (a, b, w) => +(a + (b - a) * w).toFixed(1)

function synthFrames(pose) {
	const targetAngles = { ...REST_ANGLES, ...pose.angles }
	const targetPelvis = pose.pelvis ?? REST_PELVIS
	const frames = []
	for (let i = 0; i < FRAMES; i++) {
		const w = envelope(i, FRAMES)
		const angles = {}
		for (const k of Object.keys(REST_ANGLES)) {
			angles[k] = lerpAngle(REST_ANGLES[k], targetAngles[k], w)
		}
		const pelvis = {
			drop: lerp(REST_PELVIS.drop, targetPelvis.drop, w),
			lean: lerpAngle(REST_PELVIS.lean, targetPelvis.lean, w),
		}
		frames.push({ angles, pelvis })
	}
	return frames
}

const catalog = JSON.parse(readFileSync(CATALOG, 'utf8'))
for (const pose of catalog) {
	pose.frames = synthFrames(pose)
	pose.fps = FPS
}
writeFileSync(CATALOG, JSON.stringify(catalog, null, 2) + '\n')
process.stderr.write(`Added synth frames to ${catalog.length} poses (${FRAMES} frames @ ${FPS}fps each).\n`)
