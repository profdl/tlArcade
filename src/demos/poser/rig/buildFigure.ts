import {
	createBindingId,
	createShapeId,
	type Editor,
	type TLDefaultColorStyle,
	type TLDefaultSizeStyle,
	type TLShapeId,
} from 'tldraw'
import type { BoneShape } from '../shapes/boneShape'

const DEG = Math.PI / 180

/** One bone in the rig template. `parent` refers to another bone's `name`; the root has none. */
interface BoneSpec {
	name: string
	length: number
	/** Native size style → rendered bone diameter (see BONE_THICKNESS in boneShape.ts). */
	size: TLDefaultSizeStyle
	/** Native theme color style. */
	color: TLDefaultColorStyle
	/** Initial angle in degrees, measured page-space (0 = pointing right, 90 = down). */
	angle: number
	parent?: string
}

// A humanoid rig matching the classic COCO-18 keypoint skeleton (OpenPose):
// a central spine, with SHOULDERS spread horizontally from the neck and HIPS
// spread horizontally from the pelvis, so arms and legs drop from separated
// points rather than all radiating from one — that shoulder/hip breadth is what
// makes it read as a person instead of a bug.
//
// Skeleton (COCO index → our bone tail):
//   0 nose/head, 1 neck, 2/5 shoulders, 3/6 elbows, 4/7 wrists,
//   8/11 hips, 9/12 knees, 10/13 ankles.
//
// The clavicle and hip bones are the horizontal spreaders: short, thin
// connective segments whose tails ARE the shoulder / hip keypoints. Arms and
// legs pin to those tails, so widening the torso is just their `length`.
//
// Angles are page-space degrees (y-down, so 90° points down, 0° points right).
// Each child pins its head to its parent's tail via a bone-joint binding, so
// posing propagates down the chain.
//
// Colors are native theme palette names (they adapt to light/dark and share the
// style panel). `size` picks the rendered diameter from BONE_THICKNESS: the trunk
// and head are heavy (l/xl), limbs medium (m), connective spreaders slim (s).
const SPINE: TLDefaultColorStyle = 'grey'
const LIMB: TLDefaultColorStyle = 'blue'
const HEAD_C: TLDefaultColorStyle = 'light-blue'
const CONNECT: TLDefaultColorStyle = 'grey' // clavicle / hip spreaders — read as connective structure

const SHOULDER_HALF_WIDTH = 46 // clavicle length: neck → each shoulder
const HIP_HALF_WIDTH = 30 // hip length: pelvis → each hip socket

const FIGURE: BoneSpec[] = [
	// ── spine column, bottom→top (pelvis is the root) ───────────────────────────
	// `pelvis` is a tiny hub at the base of the trunk — its head (the origin) and
	// tail nearly coincide, so the spine (up), the two hips (sideways), and the
	// pelvis itself all pivot around the same low point, the way COCO's hip
	// keypoints (8/11) sit at the bottom of the torso. `spine` rises to the neck
	// (COCO 1); `neck` is a short segment to the head base; `head` is the skull.
	{ name: 'pelvis', length: 12, size: 'l', color: SPINE, angle: -90 },
	{ name: 'spine', length: 100, size: 'l', color: SPINE, angle: -90, parent: 'pelvis' },
	{ name: 'neck', length: 22, size: 'm', color: SPINE, angle: -90, parent: 'spine' },
	{ name: 'head', length: 46, size: 'xl', color: HEAD_C, angle: -90, parent: 'neck' },

	// ── shoulders: clavicles spread left/right from the neck (COCO 2, 5) ─────────
	// Tails = the shoulder keypoints. angle 180 = left, 0 = right.
	{ name: 'clavicle-l', length: SHOULDER_HALF_WIDTH, size: 's', color: CONNECT, angle: 180, parent: 'neck' },
	{ name: 'clavicle-r', length: SHOULDER_HALF_WIDTH, size: 's', color: CONNECT, angle: 0, parent: 'neck' },

	// arms drop from each shoulder (upper arm → COCO 3/6 elbow → COCO 4/7 wrist)
	{ name: 'upper-arm-l', length: 66, size: 'm', color: LIMB, angle: 100, parent: 'clavicle-l' },
	{ name: 'forearm-l', length: 60, size: 'm', color: LIMB, angle: 95, parent: 'upper-arm-l' },
	{ name: 'upper-arm-r', length: 66, size: 'm', color: LIMB, angle: 80, parent: 'clavicle-r' },
	{ name: 'forearm-r', length: 60, size: 'm', color: LIMB, angle: 85, parent: 'upper-arm-r' },

	// ── hips: spread left/right from the pelvis base (COCO 8, 11) ────────────────
	// Parented to `pelvis` (the ROOT), so hips sit at the bottom of the trunk.
	{ name: 'hip-l', length: HIP_HALF_WIDTH, size: 'm', color: CONNECT, angle: 180, parent: 'pelvis' },
	{ name: 'hip-r', length: HIP_HALF_WIDTH, size: 'm', color: CONNECT, angle: 0, parent: 'pelvis' },

	// legs drop from each hip (thigh → COCO 9/12 knee → COCO 10/13 ankle)
	{ name: 'thigh-l', length: 88, size: 'm', color: LIMB, angle: 92, parent: 'hip-l' },
	{ name: 'shin-l', length: 82, size: 'm', color: LIMB, angle: 90, parent: 'thigh-l' },
	{ name: 'thigh-r', length: 88, size: 'm', color: LIMB, angle: 88, parent: 'hip-r' },
	{ name: 'shin-r', length: 82, size: 'm', color: LIMB, angle: 90, parent: 'thigh-r' },
]

/**
 * Builds one humanoid figure centered near `origin` (page coords) and returns
 * the root bone's id (which doubles as the figure's stable `figureId`). Bones are
 * created top-down so a parent exists before its children pin to it; each child's
 * initial (x, y) is computed from its parent's tail so the figure starts already
 * assembled, then the binding keeps it that way as you pose.
 *
 * Every bone is stamped with `meta.figureId` = the pelvis (root) shape id, so the
 * whole figure has one shared identity. This is what lets multiple figures coexist
 * on the page: pose application, IK-chain discovery, and the per-figure toolbar all
 * group/filter bones by `meta.figureId` instead of by bone name (names repeat across
 * figures). See figureId() in this module for reading it back.
 */
export function buildFigure(editor: Editor, origin: { x: number; y: number }): TLShapeId {
	const ids = new Map<string, TLShapeId>()
	// Where each bone's tail ends up in page space — children read their parent's tail from here.
	const tails = new Map<string, { x: number; y: number }>()

	// Mint the pelvis id up front so it can serve as the shared figureId for every
	// bone (including the pelvis itself). The FIGURE template lists pelvis first.
	const figureId = createShapeId()

	editor.run(() => {
		for (const spec of FIGURE) {
			const id = spec.name === 'pelvis' ? figureId : createShapeId()
			ids.set(spec.name, id)

			const rotation = spec.angle * DEG
			const head = spec.parent
				? tails.get(spec.parent)!
				: { x: origin.x, y: origin.y } // root pelvis head sits at the origin

			editor.createShape<BoneShape>({
				id,
				type: 'poser-bone',
				x: head.x,
				y: head.y,
				rotation,
				meta: { figureId },
				props: {
					length: spec.length,
					size: spec.size,
					color: spec.color,
					dash: 'solid',
					fill: 'solid',
					name: spec.name,
				},
			})

			// Tail = head + length along the bone's angle.
			tails.set(spec.name, {
				x: head.x + Math.cos(rotation) * spec.length,
				y: head.y + Math.sin(rotation) * spec.length,
			})

			if (spec.parent) {
				editor.createBinding({
					id: createBindingId(),
					type: 'bone-joint',
					fromId: ids.get(spec.parent)!, // parent
					toId: id, // child
					props: {},
				})
			}
		}
	})

	return figureId
}

/**
 * The figure a bone belongs to, or `undefined` if the shape isn't a rigged bone.
 * Reads `meta.figureId` (stamped by buildFigure). This is the single source of
 * figure identity used by pose application, IK discovery, and the toolbar.
 */
export function figureId(editor: Editor, shapeId: TLShapeId): TLShapeId | undefined {
	const shape = editor.getShape(shapeId)
	if (!shape || shape.type !== 'poser-bone') return undefined
	const id = shape.meta?.figureId
	return typeof id === 'string' ? (id as TLShapeId) : undefined
}

/** All `poser-bone` shape ids belonging to `figure`, keyed by their bone `name`. */
export function bonesByName(editor: Editor, figure: TLShapeId): Map<string, TLShapeId> {
	const byName = new Map<string, TLShapeId>()
	for (const shape of editor.getCurrentPageShapes()) {
		if (shape.type !== 'poser-bone') continue
		if (shape.meta?.figureId !== figure) continue
		byName.set((shape as BoneShape).props.name, shape.id)
	}
	return byName
}

/** Every distinct figureId currently on the page, in a stable page order. */
export function allFigureIds(editor: Editor): TLShapeId[] {
	const seen = new Set<TLShapeId>()
	const out: TLShapeId[] = []
	for (const shape of editor.getCurrentPageShapes()) {
		if (shape.type !== 'poser-bone') continue
		const id = shape.meta?.figureId
		if (typeof id !== 'string' || seen.has(id as TLShapeId)) continue
		seen.add(id as TLShapeId)
		out.push(id as TLShapeId)
	}
	return out
}
