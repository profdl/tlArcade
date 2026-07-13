import { atom } from 'tldraw'

/**
 * The Mixamo-style joint-placement model for rigging a hand-drawn figure.
 *
 * The user drops a marker on each joint of their drawing; the rig is then BUILT
 * from those positions (buildFigureFromJoints), so bone lengths, angles, and the
 * shoulder/hip widths all come from where the user placed the markers. A drawing
 * with short legs yields short leg bones automatically — no proportion inference,
 * no distortion of the art.
 *
 * A joint has a stable `key`, a human label, a `parent` joint (the two ends of a
 * bone are a joint and its parent), and a default page-offset from the pelvis used
 * only to seed the initial standing layout the user then drags onto their drawing.
 */
export interface JointSpec {
	key: JointKey
	label: string
	/** The joint one bone up the chain; the bone spans parent→this. Root has none. */
	parent?: JointKey
	/** Seed offset (px) from the pelvis for the initial standing layout. */
	dx: number
	dy: number
}

export type JointKey =
	| 'pelvis'
	| 'chest' // spine top / base of neck
	| 'neck' // neck top / base of head
	| 'head' // top of head (chin-to-crown tip)
	| 'shoulder-l'
	| 'elbow-l'
	| 'wrist-l'
	| 'shoulder-r'
	| 'elbow-r'
	| 'wrist-r'
	| 'hip-l'
	| 'knee-l'
	| 'ankle-l'
	| 'hip-r'
	| 'knee-r'
	| 'ankle-r'

// The joint tree. Offsets mirror the current rig's default proportions (spine 100,
// clavicle 46, upper-arm 66 + forearm 60, hip 30, thigh 88 + shin 82), so the
// initial layout reads as a familiar standing skeleton before the user adjusts it.
// (y grows downward.)
export const JOINTS: JointSpec[] = [
	{ key: 'pelvis', label: 'Pelvis', dx: 0, dy: 0 },
	{ key: 'chest', label: 'Chest', parent: 'pelvis', dx: 0, dy: -100 },
	{ key: 'neck', label: 'Neck', parent: 'chest', dx: 0, dy: -122 },
	{ key: 'head', label: 'Head', parent: 'neck', dx: 0, dy: -168 },

	{ key: 'shoulder-l', label: 'L shoulder', parent: 'chest', dx: -46, dy: -100 },
	{ key: 'elbow-l', label: 'L elbow', parent: 'shoulder-l', dx: -58, dy: -35 },
	{ key: 'wrist-l', label: 'L wrist', parent: 'elbow-l', dx: -63, dy: 25 },
	{ key: 'shoulder-r', label: 'R shoulder', parent: 'chest', dx: 46, dy: -100 },
	{ key: 'elbow-r', label: 'R elbow', parent: 'shoulder-r', dx: 58, dy: -35 },
	{ key: 'wrist-r', label: 'R wrist', parent: 'elbow-r', dx: 63, dy: 25 },

	{ key: 'hip-l', label: 'L hip', parent: 'pelvis', dx: -30, dy: 0 },
	{ key: 'knee-l', label: 'L knee', parent: 'hip-l', dx: -33, dy: 88 },
	{ key: 'ankle-l', label: 'L ankle', parent: 'knee-l', dx: -33, dy: 170 },
	{ key: 'hip-r', label: 'R hip', parent: 'pelvis', dx: 30, dy: 0 },
	{ key: 'knee-r', label: 'R knee', parent: 'hip-r', dx: 33, dy: 88 },
	{ key: 'ankle-r', label: 'R ankle', parent: 'knee-r', dx: 33, dy: 170 },
]

export type JointPositions = Record<JointKey, { x: number; y: number }>

/** Build the default standing layout centered on `origin` (page coords). */
export function defaultLayout(origin: { x: number; y: number }): JointPositions {
	const out = {} as JointPositions
	for (const j of JOINTS) out[j.key] = { x: origin.x + j.dx, y: origin.y + j.dy }
	return out
}

/**
 * Rig-mode state: null when off; otherwise the live joint positions the user is
 * editing. Reactive so the overlay + controls re-render as markers move. When the
 * user hits "Build rig", buildFigureFromJoints consumes these and rig mode exits.
 */
export const rigModeJoints = atom<JointPositions | null>('rigModeJoints', null)

export function enterRigMode(origin: { x: number; y: number }) {
	rigModeJoints.set(defaultLayout(origin))
}

export function exitRigMode() {
	rigModeJoints.set(null)
}

/** Move one joint (called from the marker drag). */
export function setJoint(key: JointKey, x: number, y: number) {
	const cur = rigModeJoints.get()
	if (!cur) return
	rigModeJoints.set({ ...cur, [key]: { x, y } })
}
