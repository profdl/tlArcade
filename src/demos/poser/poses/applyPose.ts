import type { Editor, TLShapeId } from 'tldraw'
import { withSuppressed } from '../pose/bindingSuppression'
import { bonesByName } from '../rig/buildFigure'
import catalog from './poseCatalog.json'

const DEG = Math.PI / 180

/**
 * One entry in the bundled pose catalog.
 *
 * - `name`   — display label (from the source motion's caption).
 * - `angles` — bone `name` → page-space angle in DEGREES, for the posable bones
 *   (spine, head/neck, arms, legs). Bones absent here keep their rig-template
 *   angle. The horizontal spreaders (clavicles, hips) are intentionally omitted so
 *   torso/hip width stays constant.
 * - `pelvis` — the ROOT's page-space transform relative to a standing baseline:
 *   `drop` is how far (px) to lower the pelvis (grounded/sitting poses drop it a
 *   lot; standing ≈ 0), and `lean` is the pelvis's own page-space angle in DEGREES
 *   (torso tilt for bowing / leaning). Optional for back-compat with older catalogs.
 *
 * Generated offline from HumanML3D — see scripts/buildPoseCatalog.mjs.
 */
export interface Pose {
	name: string
	angles: Record<string, number>
	pelvis?: { drop: number; lean: number }
}

/** The bundled catalog, typed. */
export const POSES: Pose[] = catalog as Pose[]

// The order bones must be rotated in: a parent before any of its children, so that
// when we rotate/move a parent, the bone-joint binding re-pins each child onto the
// parent's new tail before we rotate that child. (Same parent→child order the rig
// builder uses.) The pelvis (root) is handled separately (translate + lean) before
// this list runs. Bones not listed here are never posed.
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
 * Apply a catalog pose to a specific figure.
 *
 * `figure` is the figure's id (its pelvis/root shape id — what buildFigure returns
 * and what `meta.figureId` holds). We resolve that figure's bones by name and pose
 * only them, so other figures on the page are untouched.
 *
 * Sequence, all inside one `editor.run` + `withSuppressed` (suppression stops the
 * bone-joint binding from reinterpreting these rig-internal writes as user drags,
 * while its parent-moved handler still slides each child onto its parent's new tail):
 *   1. Move + lean the PELVIS (root). Lowering the pelvis is what makes grounded /
 *      sitting poses read — HumanML3D encodes a sit as a ~30% root-height drop, not
 *      as articulated hips. The whole figure follows via the cascading bindings.
 *   2. Rotate the posable bones top-down (APPLY_ORDER).
 */
export function applyPose(editor: Editor, figure: TLShapeId, pose: Pose): void {
	const byName = bonesByName(editor, figure)
	if (byName.size === 0) return

	const ids = APPLY_ORDER.map((n) => byName.get(n)).filter((id): id is TLShapeId => id != null)
	const pelvisId = byName.get('pelvis')
	const suppressIds = pelvisId ? [pelvisId, ...ids] : ids

	editor.run(() => {
		withSuppressed(suppressIds, () => {
			// 1. Pelvis: translate down by `drop` and set its lean. The pelvis is the
			// root (no parent binding), so its (x, y) is page space; moving it drags the
			// entire figure. We anchor the drop to the CURRENT pelvis position so a pose
			// is applied relative to wherever the user placed the figure, and re-applying
			// the same pose is idempotent (drop is absolute vs. the standing baseline).
			if (pelvisId && pose.pelvis) {
				const pelvis = editor.getShape(pelvisId)
				if (pelvis) {
					// Standing baseline = current pelvis y minus whatever drop is already
					// applied (stored in meta). This makes pose→pose switches land at the
					// new pose's absolute drop with no accumulation, while still honoring
					// the user dragging the figure to a new spot between poses.
					const appliedDrop = typeof pelvis.meta?.appliedDrop === 'number' ? pelvis.meta.appliedDrop : 0
					const standingY = pelvis.y - appliedDrop
					editor.updateShape({
						id: pelvisId,
						type: 'poser-bone',
						y: standingY + pose.pelvis.drop,
						rotation: pose.pelvis.lean * DEG,
						meta: { ...pelvis.meta, appliedDrop: pose.pelvis.drop },
					})
				}
			}

			// 2. Rotate posable bones top-down.
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
