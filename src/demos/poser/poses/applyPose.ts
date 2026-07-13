import type { Editor, TLShapeId } from 'tldraw'
import { withSuppressed } from '../pose/bindingSuppression'
import { bonesByName } from '../rig/buildFigure'
import { POSABLE_BONES } from '../rig/humanoidTemplate'
import catalog from './poseCatalog.json'

const DEG = Math.PI / 180

/**
 * A single posed frame: the same `angles` + `pelvis` shape a static pose uses.
 *
 * - `angles` — bone `name` → page-space angle in DEGREES, for the posable bones
 *   (spine, head/neck, arms, legs). Bones absent here keep their rig-template
 *   angle. The horizontal spreaders (clavicles, hips) are intentionally omitted so
 *   torso/hip width stays constant.
 * - `pelvis` — the ROOT's page-space transform relative to a standing baseline:
 *   `drop` is how far (px) to lower the pelvis (grounded/sitting poses drop it a
 *   lot; standing ≈ 0), and `lean` is the pelvis's own page-space angle in DEGREES
 *   (torso tilt for bowing / leaning). Optional for back-compat with older catalogs.
 */
export interface PoseFrame {
	angles: Record<string, number>
	pelvis?: { drop: number; lean: number }
}

/**
 * One entry in the bundled pose catalog. A `Pose` IS a `PoseFrame` (its static
 * mid-frame — what the picker applies) plus catalog metadata.
 *
 * - `name`   — display label (from the source motion's caption).
 * - `frames` — the full downsampled motion sequence for playback (rest → action →
 *   rest), each frame a `PoseFrame`. Optional: older catalogs (and any pose without
 *   motion) have none, so playback is simply unavailable for them.
 * - `fps`    — playback rate for `frames` (effective post-downsample fps). The
 *   player advances by wall-clock time using this, so different stride lengths
 *   still play at real speed.
 *
 * Generated offline from HumanML3D — see scripts/buildPoseCatalog.mjs.
 */
export interface Pose extends PoseFrame {
	name: string
	frames?: PoseFrame[]
	fps?: number
}

/** The bundled catalog, typed. */
export const POSES: Pose[] = catalog as Pose[]

// The order bones must be rotated in: a parent before any of its children, so that
// when we rotate/move a parent, the bone-joint binding re-pins each child onto the
// parent's new tail before we rotate that child. POSABLE_BONES (humanoidTemplate.ts)
// is already the trunk+limbs in top-down template order, so it IS this order — no
// hand-synced copy. The pelvis (root) is handled separately (translate + lean) before
// this list runs. Bones not in POSABLE_BONES (pelvis, spreaders) are never posed.
const APPLY_ORDER = POSABLE_BONES

/**
 * Apply a single posed FRAME to a specific figure — the shared core used by both
 * the static pose picker (`applyPose`) and the motion player (posePlayer.ts), so
 * one-shot posing and per-frame playback write the rig identically.
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
export function applyFrame(editor: Editor, figure: TLShapeId, frame: PoseFrame): void {
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
			if (pelvisId && frame.pelvis) {
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
						y: standingY + frame.pelvis.drop,
						rotation: frame.pelvis.lean * DEG,
						meta: { ...pelvis.meta, appliedDrop: frame.pelvis.drop },
					})
				}
			}

			// 2. Rotate posable bones top-down.
			for (const boneName of APPLY_ORDER) {
				const deg = frame.angles[boneName]
				if (deg == null) continue
				const id = byName.get(boneName)
				if (!id) continue
				editor.updateShape({ id, type: 'poser-bone', rotation: deg * DEG })
			}
		})
	})
}

/**
 * Apply a catalog pose's static frame (its mid-frame `angles`/`pelvis`) to a figure.
 * A thin wrapper over `applyFrame` — this is what the pose picker calls to snap the
 * figure straight to the pose without playing the motion.
 */
export function applyPose(editor: Editor, figure: TLShapeId, pose: Pose): void {
	applyFrame(editor, figure, pose)
}
