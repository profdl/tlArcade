// Build the bundled pose catalog for the Poser demo from the HumanML3D motion
// dataset (TeoGchx/HumanML3D on Hugging Face). Run offline, occasionally:
//
//   node src/demos/poser/scripts/buildPoseCatalog.mjs > src/demos/poser/poses/poseCatalog.json
//
// It fetches a pool of rows, decodes each motion's mid-frame into 22 joint
// positions, converts the joint chain into our rig's per-bone page-space angles,
// and greedily selects a diverse, expressively-captioned subset.
//
// Two data sources, tried in order (see loadRows):
//   1. HF datasets-server REST API — no download, no deps, streams JSON rows. This
//      is the preferred path, but the datasets-server is periodically down (503).
//   2. Direct parquet fallback — when the REST API is unavailable, download the
//      `test` split's first parquet shard once (via the `huggingface_hub` +
//      `duckdb` Python packages) and read the same rows out of it locally. Slower
//      first run (a few hundred MB), but immune to datasets-server outages. Requires
//      `python3` on PATH; the packages are auto-installed into a throwaway venv.
// Both paths yield rows of the identical shape ({ motion: number[][], caption }),
// so the decode below is source-agnostic.
//
// Why this shape of data: HumanML3D stores each motion as a T×263 float matrix in
// the standard T2M feature layout. The first slice after the root channels is
// `ric_data` — the local (root-relative) XYZ of joints 1..21 — so a static pose is
// just those positions plus the root at the origin. No FBX, no Blender, no rotation
// decode needed for a single frame; the rest of the 263 dims (6D rotations, local
// velocities, foot contacts) we don't use.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DATASET = 'TeoGchx/HumanML3D'
const CONFIG = 'default'
const SPLIT = 'test' // smaller split, plenty of variety for a demo catalog
const POOL_SIZE = 600 // rows to consider (larger, so locomotion buckets fill reliably)
const TARGET_ACTIONS = 22 // one-shot expressive poses to keep
const MIN_DISTINCT = 55 // min angle-space distance (deg, RMS) between kept poses

// Locomotion buckets — cyclic motions we always want represented, each with a caption
// matcher and a guaranteed number of slots. These are pulled BEFORE the diverse-action
// pass and seam-blended (see `loopify`) so they loop cleanly, unlike a raw mocap clip
// whose settle-at-each-end start/end poses don't match. A bucket's `frames` become one
// continuous cycle. `slots` is the max kept per bucket; fewer is fine if the pool is thin.
const LOCOMOTION = [
	{ key: 'walk', label: 'Walk', slots: 2, re: /\bwalk(s|ing)?\b/, exclude: /(backward|sit|stop|around|crouch)/ },
	{ key: 'run', label: 'Run', slots: 2, re: /\b(run|runs|running|jog|jogs|jogging|sprint\w*)\b/, exclude: /sit/ },
	{ key: 'jump', label: 'Jump', slots: 2, re: /\b(jump|jumps|jumping|hop|hops|leap\w*)\b/, exclude: null },
	{ key: 'idle', label: 'Idle', slots: 2, re: /\b(idle|stand(s|ing)? (still|in place)|shifts? (his|her|their) weight)\b/, exclude: null },
]

// Fraction of a locomotion clip's frames to cross-blend across the loop seam, so the
// last frame eases back into the first with no visible pop. 0.25 = blend the final
// quarter of the cycle toward the opening quarter.
const SEAM_BLEND = 0.25

// Motion-playback sampling. HumanML3D is captured at 20fps. We downsample each
// motion to at most MAX_FRAMES evenly-spaced keyframes (stride chosen per motion)
// so the bundled JSON stays modest, and store the effective playback fps so the
// runtime player advances at the right wall-clock speed regardless of stride.
const SRC_FPS = 20
const MAX_FRAMES = 40

// ── HumanML3D 263-dim feature decode ─────────────────────────────────────────
const N_JOINTS = 22
// [0] root angular vel · [1:3] root XZ vel · [3] root height Y · [4:67] ric_data
// = XYZ of joints 1..21 (root-relative). Joint 0 (pelvis) sits at (0, root_y, 0).
function jointsFromFrame(f) {
	const J = new Array(N_JOINTS)
	J[0] = { x: 0, y: f[3], z: 0 }
	for (let j = 1; j < N_JOINTS; j++) {
		const o = 4 + (j - 1) * 3
		J[j] = { x: f[o], y: f[o + 1], z: f[o + 2] }
	}
	return J
}

// SMPL 22-joint indices we reference.
const IDX = {
	pelvis: 0, neck: 12, head: 15,
	shldL: 16, elbowL: 18, wristL: 20, shldR: 17, elbowR: 19, wristR: 21,
	hipL: 1, kneeL: 4, ankleL: 7, hipR: 2, kneeR: 5, ankleR: 8,
}

// Page-space angle (deg) of the directed joint pair a→b. HumanML3D is +X=subject-
// left, +Y=up; the demo's page is y-DOWN with 0°=+x(right). We mirror X (subject-
// left → screen-right) and flip Y so the figure faces the viewer and stands upright,
// matching the rig template's angle convention (spine ≈ -90° = up).
function angleDeg(J, a, b) {
	const p = J[IDX[a]]
	const q = J[IDX[b]]
	return (Math.atan2(-(q.y - p.y), -(q.x - p.x)) * 180) / Math.PI
}

// Which joint pair defines each posable rig bone's direction. Structural spreaders
// (clavicle-l/r, hip-l/r) and the root pelvis are intentionally absent — they stay
// at their rig-template angle so torso and hip width stay stable across poses.
const BONE_FROM = {
	spine: ['pelvis', 'neck'],
	neck: ['neck', 'head'],
	head: ['neck', 'head'],
	'upper-arm-l': ['shldL', 'elbowL'],
	'forearm-l': ['elbowL', 'wristL'],
	'upper-arm-r': ['shldR', 'elbowR'],
	'forearm-r': ['elbowR', 'wristR'],
	'thigh-l': ['hipL', 'kneeL'],
	'shin-l': ['kneeL', 'ankleL'],
	'thigh-r': ['hipR', 'kneeR'],
	'shin-r': ['kneeR', 'ankleR'],
}

function poseFromFrame(frame) {
	const J = jointsFromFrame(frame)
	const angles = {}
	for (const [bone, [a, b]] of Object.entries(BONE_FROM)) {
		angles[bone] = +angleDeg(J, a, b).toFixed(1)
	}
	return angles
}

// Data→page scale. In HumanML3D units the torso (pelvis→neck) is ~0.51; the rig's
// spine bone is 100px, so 1 data-unit ≈ 100/0.51 ≈ 196 px. A standing pelvis sits at
// data-Y ≈ 0.95; grounded poses drop toward ~0.2. We convert that height loss into a
// downward page translation (page-y grows downward, so a drop is +px).
const DATA_TO_PX = 196
const STANDING_PELVIS_Y = 0.95

// The pelvis (root) transform for a frame: how far to lower the figure vs. standing,
// and the pelvis's own page-space lean (torso tilt). Lowering the pelvis is what lets
// sitting/kneeling/crouching read — the data encodes them as a big root-height drop,
// not as articulated hips.
function pelvisFromFrame(frame) {
	const J = jointsFromFrame(frame)
	const pelvisY = J[IDX.pelvis].y
	const drop = +((STANDING_PELVIS_Y - pelvisY) * DATA_TO_PX).toFixed(0)
	// Pelvis lean = the spine's base direction (pelvis→neck) as a page angle; a bowing
	// or reclining torso tilts this off -90°. Reuse the spine mapping so lean and the
	// spine bone stay consistent.
	const lean = +angleDeg(J, 'pelvis', 'neck').toFixed(1)
	// Clamp drop to non-negative — a pose can't lift the figure above its standing
	// baseline (jumping's mid-frame height isn't meaningful for a static pose).
	return { drop: Math.max(0, drop), lean }
}

// Decode a whole motion into a downsampled sequence of {angles, pelvis} keyframes
// for playback. We pick an integer stride so the kept frame count is ≤ MAX_FRAMES,
// always including the last frame, and return the effective post-stride fps.
function framesFromMotion(m) {
	const stride = Math.max(1, Math.ceil(m.length / MAX_FRAMES))
	const frames = []
	for (let i = 0; i < m.length; i += stride) {
		frames.push({ angles: poseFromFrame(m[i]), pelvis: pelvisFromFrame(m[i]) })
	}
	// Ensure the final frame is present so a play-once ends on the true last pose.
	const last = m.length - 1
	if ((last % stride) !== 0) {
		frames.push({ angles: poseFromFrame(m[last]), pelvis: pelvisFromFrame(m[last]) })
	}
	return { frames, fps: +(SRC_FPS / stride).toFixed(2) }
}

// ── Seam-blending for looping locomotion ─────────────────────────────────────
// A raw mocap clip settles to a rest pose at each end, so its first and last frames
// don't match — looping it pops. For cyclic motions (walk/run/idle/jump) we cross-
// blend the tail of the clip back toward its head so frame N-1 → frame 0 is continuous.

// Shortest-path circular interpolation between two angles (deg). Lerping raw degrees
// would take the long way around the +180/-180 seam; this always eases the short arc.
function lerpAngle(a, b, t) {
	let d = ((b - a) % 360 + 540) % 360 - 180 // signed shortest delta in (-180, 180]
	return a + d * t
}

// Blend one PoseFrame toward another by t∈[0,1] — every bone angle plus the pelvis
// drop/lean. Bones present in only one frame are carried through unchanged.
function blendFrames(a, b, t) {
	const angles = { ...a.angles }
	for (const k in b.angles) {
		angles[k] = k in a.angles ? +lerpAngle(a.angles[k], b.angles[k], t).toFixed(1) : b.angles[k]
	}
	let pelvis = a.pelvis ?? b.pelvis
	if (a.pelvis && b.pelvis) {
		pelvis = {
			drop: +(a.pelvis.drop + (b.pelvis.drop - a.pelvis.drop) * t).toFixed(0),
			lean: +lerpAngle(a.pelvis.lean, b.pelvis.lean, t).toFixed(1),
		}
	}
	return { angles, pelvis }
}

// Make `frames` loop seamlessly: cross-blend the final SEAM_BLEND fraction of the clip
// toward the opening frames, ramping the blend weight from 0 (start of the seam window)
// to full (last frame) so the clip eases into its own start. Returns a new frame array.
// A clip too short to blend (<4 frames) is returned unchanged.
function loopify(frames) {
	const n = frames.length
	if (n < 4) return frames
	const window = Math.max(1, Math.round(n * SEAM_BLEND))
	const out = frames.map((f) => ({ angles: { ...f.angles }, pelvis: f.pelvis ? { ...f.pelvis } : undefined }))
	for (let i = 0; i < window; i++) {
		const idx = n - window + i // frame being adjusted, walking toward the end
		const t = (i + 1) / window // 0 → 1 across the window, full blend at the last frame
		// Pull toward the head of the clip: the earlier the head frame, the more the tail
		// resembles the true loop point. Blend against the mirror-position opening frame.
		out[idx] = blendFrames(out[idx], frames[i], t * 0.5)
	}
	return out
}

// HumanML3D captions carry POS-tagged tokens after a `#`; keep the plain sentence.
function cleanCaption(c) {
	const plain = String(c).split('#')[0].trim().replace(/\.$/, '')
	const cap = plain.charAt(0).toUpperCase() + plain.slice(1)
	return cap.length > 52 ? cap.slice(0, 49) + '…' : cap
}

// RMS angular distance between two poses (deg), used to keep the set visibly diverse.
function poseDistance(a, b) {
	let sum = 0
	for (const k in a) {
		let d = Math.abs(a[k] - b[k]) % 360
		if (d > 180) d = 360 - d
		sum += d * d
	}
	return Math.sqrt(sum)
}

// Caption heuristics for the ACTION pass: promote recognizable, expressive actions.
// (Plain locomotion is no longer demoted here — walk/run/jump/idle are pulled first by
// the dedicated LOCOMOTION buckets and removed from this pass, so what's left is the
// grounded/expressive one-shots this scoring is meant to rank.)
const EXPRESSIVE =
	/(kick|punch|dance|sit|squat|kneel|throw|wave|clap|reach|bend|stretch|salute|bow|crouch|lunge|balance|climb|swing|pick|raise|arms|hands up|cross|point|golf|box)/

// ── Source 1: HF datasets-server REST API ────────────────────────────────────
// The datasets-server API is occasionally flaky (transient 502/503). Retry with
// backoff so a blip mid-stream doesn't abort the whole build.
async function fetchRows(offset, length, attempt = 0) {
	const url = `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(DATASET)}&config=${CONFIG}&split=${SPLIT}&offset=${offset}&length=${length}`
	try {
		const res = await fetch(url)
		if (!res.ok) throw new Error(`HTTP ${res.status}`)
		return (await res.json()).rows.map((r) => r.row)
	} catch (err) {
		if (attempt >= 4) throw new Error(`${err.message} at offset ${offset} (gave up after ${attempt + 1} tries)`)
		const wait = 500 * 2 ** attempt
		await new Promise((r) => setTimeout(r, wait))
		return fetchRows(offset, length, attempt + 1)
	}
}

// Pull the whole pool from the REST API in POOL_SIZE/20 pages.
async function rowsFromRestApi() {
	const pool = []
	for (let off = 0; off < POOL_SIZE; off += 20) {
		pool.push(...(await fetchRows(off, 20)))
		process.stderr.write(`  rest pool ${pool.length}\r`)
	}
	process.stderr.write(`\n`)
	return pool
}

// ── Source 2: direct parquet fallback (datasets-server-outage-proof) ──────────
// Download the `test` split's first parquet shard via huggingface_hub and read the
// first POOL_SIZE rows' {caption, motion} out of it with duckdb — both installed
// into a throwaway venv on first use. We drive Python because there's no pure-JS
// parquet reader in this repo's deps; keeping it out-of-band avoids adding one.
const PARQUET_FILE = 'data/test-00000-of-00002.parquet'
function rowsFromParquet() {
	if (!process.env.HF_TOKEN && !existsSync(join(process.env.HOME ?? '', '.cache/huggingface/token'))) {
		throw new Error(
			'parquet fallback needs a Hugging Face token (env HF_TOKEN or ~/.cache/huggingface/token; run `huggingface-cli login`)',
		)
	}
	const py = process.env.PYTHON ?? 'python3'
	const venv = join(mkdtempSync(join(tmpdir(), 'poser-hf-')), 'venv')
	process.stderr.write(`  creating venv at ${venv} …\n`)
	execFileSync(py, ['-m', 'venv', venv], { stdio: 'inherit' })
	const vpy = join(venv, 'bin', 'python')
	process.stderr.write(`  installing huggingface_hub + duckdb …\n`)
	execFileSync(vpy, ['-m', 'pip', 'install', '--quiet', 'huggingface_hub', 'duckdb'], { stdio: 'inherit' })
	const out = join(venv, 'rows.json')
	const script = `
import os, sys, json
from huggingface_hub import hf_hub_download
import duckdb
tok = os.environ.get("HF_TOKEN") or open(os.path.expanduser("~/.cache/huggingface/token")).read().strip()
p = hf_hub_download(repo_id=${JSON.stringify(DATASET)}, repo_type="dataset",
                    filename=${JSON.stringify(PARQUET_FILE)}, token=tok)
con = duckdb.connect()
rows = con.execute(f"SELECT caption, motion FROM read_parquet('{p}') LIMIT ${POOL_SIZE}").fetchall()
with open(${JSON.stringify(out)}, "w") as fh:
    json.dump([{"caption": c, "motion": m} for (c, m) in rows], fh)
print(f"parquet pool {len(rows)}", file=sys.stderr, flush=True)
`
	// Keep the child's stdout OFF our stdout — this process's stdout is the catalog
	// stream. Route child stdout to stderr; the child writes its result to `out`.
	execFileSync(vpy, ['-c', script], { stdio: ['ignore', 2, 'inherit'] })
	return JSON.parse(readFileSync(out, 'utf8'))
}

// Try the REST API; on any failure, fall back to reading the parquet directly.
async function loadRows() {
	try {
		process.stderr.write('loading rows via datasets-server REST API …\n')
		return await rowsFromRestApi()
	} catch (err) {
		process.stderr.write(`REST API unavailable (${err.message}); falling back to direct parquet …\n`)
		return rowsFromParquet()
	}
}

async function main() {
	const pool = await loadRows()
	process.stderr.write(`pool ${pool.length}\n`)

	// One candidate per motion: a settled mid-frame for the static pose/preview, plus
	// the full downsampled sequence for playback.
	const candidates = pool.map((r) => {
		const m = r.motion
		const frame = m[Math.floor(m.length / 2)]
		const { frames, fps } = framesFromMotion(m)
		return {
			name: cleanCaption(r.caption),
			caption: String(r.caption).split('#')[0].toLowerCase(),
			angles: poseFromFrame(frame),
			pelvis: pelvisFromFrame(frame),
			frames,
			fps,
		}
	})

	// Emit a chosen entry from a candidate, tagged with its category. For `locomotion`
	// we seam-blend the frames into one clean loop (`loopify`) and use a mid-clip frame
	// as the STATIC preview — a walk's true mid-stride reads as walking, whereas its
	// settle-frame mid-point reads as a plain stand. Actions keep their settled mid-frame.
	function toEntry(c, category) {
		if (category === 'locomotion') {
			const frames = loopify(c.frames)
			const mid = frames[Math.floor(frames.length / 2)] ?? frames[0]
			return {
				name: c.name,
				category,
				angles: mid.angles,
				pelvis: mid.pelvis,
				frames,
				fps: c.fps,
			}
		}
		return { name: c.name, category, angles: c.angles, pelvis: c.pelvis, frames: c.frames, fps: c.fps }
	}

	const chosen = []
	const seenNames = new Set()
	const usedCaptions = new Set() // captions consumed by locomotion, skipped by the action pass

	// A candidate is admissible if it's not a near-duplicate NAME and its pose is angle-
	// distinct from everything kept so far. Shared by both passes.
	const admissible = (c) => {
		const key = c.name.slice(0, 40)
		if (seenNames.has(key)) return false
		return chosen.every((x) => poseDistance(x.angles, c.angles) > MIN_DISTINCT)
	}
	const keep = (c, category) => {
		seenNames.add(c.name.slice(0, 40))
		usedCaptions.add(c.caption)
		chosen.push(toEntry(c, category))
	}

	// ── Pass 1: locomotion buckets ──────────────────────────────────────────────
	// Fill each bucket up to its slot count with clips whose caption matches (and isn't
	// excluded). Prefer clips with more frames — a longer capture gives a fuller cycle
	// to blend into a loop than a 2-frame stub.
	for (const bucket of LOCOMOTION) {
		const matches = candidates
			.filter((c) => bucket.re.test(c.caption) && !(bucket.exclude && bucket.exclude.test(c.caption)))
			.sort((a, b) => b.frames.length - a.frames.length)
		let filled = 0
		for (const c of matches) {
			if (filled >= bucket.slots) break
			if (!admissible(c)) continue
			keep(c, 'locomotion')
			filled++
		}
		process.stderr.write(`  ${bucket.label}: ${filled}/${bucket.slots}\n`)
	}

	// ── Pass 2: diverse expressive actions ──────────────────────────────────────
	// Rank by expressiveness + grounded-ness (pelvis drop), skipping captions already
	// consumed by locomotion, and keep an angle-distinct spread up to TARGET_ACTIONS.
	const score = (c) => (EXPRESSIVE.test(c.caption) ? 2 : 0) + (c.pelvis.drop > 60 ? 2 : 0)
	const actions = candidates.filter((c) => !usedCaptions.has(c.caption)).sort((a, b) => score(b) - score(a))
	let actionCount = 0
	for (const c of actions) {
		if (actionCount >= TARGET_ACTIONS) break
		if (!admissible(c)) continue
		keep(c, 'action')
		actionCount++
	}

	// Sort output so locomotion leads (matching the picker's optgroup order); within a
	// category, preserve insertion order (bucket order for locomotion, score for actions).
	chosen.sort((a, b) => (a.category === b.category ? 0 : a.category === 'locomotion' ? -1 : 1))

	const loco = chosen.filter((c) => c.category === 'locomotion').length
	const grounded = chosen.filter((c) => c.pelvis.drop > 60).length
	process.stderr.write(`kept ${chosen.length} poses (${loco} locomotion, ${grounded} grounded)\n`)
	process.stdout.write(JSON.stringify(chosen, null, 2) + '\n')
}

main().catch((e) => {
	process.stderr.write(String(e) + '\n')
	process.exit(1)
})
