import type { Editor, TLShapeId } from 'tldraw'
import type { BoneShape } from '../shapes/boneShape'
import { withSuppressed } from '../pose/bindingSuppression'
import catalog from './poseCatalog.json'

const DEG = Math.PI / 180

/**
 * One entry in the bundled pose catalog: a display `name` and a partial map of
 * bone `name` → page-space angle in DEGREES. Only the posable bones (spine,
 * head/neck, arms, legs) are listed; structural spreaders (clavicles, hips) and
 * the root pelvis are left at their rig-template angle, which keeps torso/hip
 * width stable across poses.
 *
 * The catalog is generated offline from the HumanML3D motion dataset — see
 * `scripts/buildPoseCatalog.mjs` for the decode (263-dim motion vector → 22
 * joints → per-bone page-space angle) and `poseCatalog.json` for the data.
 */
export interface Pose {
	name: string
	angles: Record<string, number>
}

/** The bundled catalog, typed. */
export const POSES: Pose[] = catalog as Pose[]

// The order bones must be rotated in: a parent before any of its children, so
// that when we rotate a parent, the bone-joint binding re-pins each child onto
// the parent's *new* tail before we then rotate that child. (Same parent→child
// order the rig builder uses.) Bones not listed here are never posed.
const APPLY_ORDER = [
	'spine',
	'neck',
	'head',
	'upper-arm-l',
	'forearm-l',
	'upper-arm-r',
	'forearm-r',
	'thigh-l',
	'shin-l',
	'thigh-r',
	'shin-r',
] as const

/**
 * Apply a catalog pose to the (single) figure on the page.
 *
 * Bones are addressed by their `name` prop, exactly like the IK chain lookup in
 * effectors.ts — for the current single-figure rig each name is unique. Rotations
 * are written top-down (see APPLY_ORDER) inside one `editor.run` and one
 * `withSuppressed` block: suppression stops the bone-joint binding from
 * reinterpreting these rig-internal rotation writes as user drags, while the
 * binding's own parent-moved handler still fires to slide each child's head back
 * onto its parent's freshly-rotated tail. The result is a fully assembled pose.
 */
export function applyPose(editor: Editor, pose: Pose): void {
	// name → shape id for this figure's bones (first of each name; single-figure).
	const byName = new Map<string, TLShapeId>()
	for (const shape of editor.getCurrentPageShapes()) {
		if (shape.type !== 'poser-bone') continue
		const name = (shape as BoneShape).props.name
		if (!byName.has(name)) byName.set(name, shape.id)
	}
	if (byName.size === 0) return

	const ids = APPLY_ORDER.map((n) => byName.get(n)).filter((id): id is TLShapeId => id != null)

	editor.run(() => {
		withSuppressed(ids, () => {
			for (const boneName of APPLY_ORDER) {
				const deg = pose.angles[boneName]
				if (deg == null) continue
				const id = byName.get(boneName)
				if (!id) continue
				editor.updateShape({ id, type: 'poser-bone', rotation: deg * DEG })
			}
		})
	})
}
