// Build the bundled pose catalog for the Poser demo from the HumanML3D motion
// dataset (TeoGchx/HumanML3D on Hugging Face). Run offline, occasionally:
//
//   node src/demos/poser/scripts/buildPoseCatalog.mjs > src/demos/poser/poses/poseCatalog.json
//
// It streams rows from the HF datasets-server REST API (no dataset download, no
// Python deps), decodes each motion's mid-frame into 22 joint positions, converts
// the joint chain into our rig's per-bone page-space angles, and greedily selects
// a diverse, expressively-captioned subset.
//
// Why this shape of data: HumanML3D stores each motion as a T×263 float matrix in
// the standard T2M feature layout. The first slice after the root channels is
// `ric_data` — the local (root-relative) XYZ of joints 1..21 — so a static pose is
// just those positions plus the root at the origin. No FBX, no Blender, no rotation
// decode needed for a single frame; the rest of the 263 dims (6D rotations, local
// velocities, foot contacts) we don't use.

const DATASET = 'TeoGchx/HumanML3D'
const CONFIG = 'default'
const SPLIT = 'test' // smaller split, plenty of variety for a demo catalog
const POOL_SIZE = 400 // rows to consider
const TARGET = 28 // poses to keep
const MIN_DISTINCT = 55 // min angle-space distance (deg, RMS) between kept poses

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

// Caption heuristics: promote recognizable, expressive actions; demote plain walking
// (whose mid-frame reads as a near-neutral stand and clutters the dropdown).
const EXPRESSIVE =
	/(jump|kick|punch|dance|sit|squat|kneel|throw|wave|clap|reach|bend|stretch|salute|bow|crouch|lunge|balance|climb|swing|pick|raise|arms|hands up|cross|point|golf|box)/
const PLAIN = /\b(walk|walks|walking)\b/

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

async function main() {
	const pool = []
	for (let off = 0; off < POOL_SIZE; off += 20) {
		pool.push(...(await fetchRows(off, 20)))
		process.stderr.write(`pool ${pool.length}\r`)
	}
	process.stderr.write(`\npool ${pool.length}\n`)

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

	// Priority score: expressive actions rank up, plain walking ranks down, and
	// genuinely grounded poses (meaningful pelvis drop) get an extra boost so the
	// catalog actually includes sitting / kneeling / crouching now that the rig can
	// render them.
	const score = (c) =>
		(EXPRESSIVE.test(c.caption) ? 2 : 0) - (PLAIN.test(c.caption) ? 1 : 0) + (c.pelvis.drop > 60 ? 2 : 0)
	candidates.sort((a, b) => score(b) - score(a))

	const chosen = []
	const seenNames = new Set()
	for (const c of candidates) {
		if (chosen.length >= TARGET) break
		const key = c.name.slice(0, 40)
		if (seenNames.has(key)) continue
		if (chosen.every((x) => poseDistance(x.angles, c.angles) > MIN_DISTINCT)) {
			seenNames.add(key)
			chosen.push({ name: c.name, angles: c.angles, pelvis: c.pelvis, frames: c.frames, fps: c.fps })
		}
	}

	const grounded = chosen.filter((c) => c.pelvis.drop > 60).length
	process.stderr.write(`kept ${chosen.length} distinct poses (${grounded} grounded)\n`)
	process.stdout.write(JSON.stringify(chosen, null, 2) + '\n')
}

main().catch((e) => {
	process.stderr.write(String(e) + '\n')
	process.exit(1)
})
