import { createBindingId, createShapeId, type Editor, type TLShapeId } from 'tldraw'
import type { BoneShape } from '../shapes/boneShape'
import { HUMANOID_BONES, POSABLE_BONES, sharedBoneProps } from './humanoidTemplate'

const DEG = Math.PI / 180

const SHOULDER_HALF_WIDTH = 46 // clavicle length: neck → each shoulder
const HIP_HALF_WIDTH = 30 // hip length: pelvis → each hip socket

// Per-bone GEOMETRY for the default fixed-template figure: initial page-space angle
// (degrees, y-down: 90° = down, 0° = right) and length (px). Topology, names, and
// styling come from HUMANOID_BONES (humanoidTemplate.ts); this map is only the
// numbers that make the template stand in a neutral pose. Every HUMANOID_BONES entry
// must have one here.
//
//   pelvis  — a tiny hub at the base of the trunk (head≈tail); spine, hips, and the
//             pelvis itself pivot around the same low point.
//   spine/neck/head — the trunk column rising to the skull.
//   clavicles — horizontal spreaders to the shoulder keypoints (180 = left, 0 = right).
//   hips      — horizontal spreaders to the hip sockets, off the pelvis root.
//   arms/legs — drop from each shoulder / hip.
const GEOMETRY: Record<string, { angle: number; length: number }> = {
	pelvis: { angle: -90, length: 12 },
	spine: { angle: -90, length: 100 },
	neck: { angle: -90, length: 22 },
	head: { angle: -90, length: 46 },
	'clavicle-l': { angle: 180, length: SHOULDER_HALF_WIDTH },
	'clavicle-r': { angle: 0, length: SHOULDER_HALF_WIDTH },
	'upper-arm-l': { angle: 100, length: 66 },
	'forearm-l': { angle: 95, length: 60 },
	'upper-arm-r': { angle: 80, length: 66 },
	'forearm-r': { angle: 85, length: 60 },
	'hip-l': { angle: 180, length: HIP_HALF_WIDTH },
	'hip-r': { angle: 0, length: HIP_HALF_WIDTH },
	'thigh-l': { angle: 92, length: 88 },
	'shin-l': { angle: 90, length: 82 },
	'thigh-r': { angle: 88, length: 88 },
	'shin-r': { angle: 90, length: 82 },
}

/**
 * The rig-template neutral pose ("rest"), derived from the GEOMETRY table (the same
 * numbers buildFigure spawns at) so it can never drift from how the figure is built.
 * This is the frame edit-mode snaps a figure to before unbinding its artwork, so
 * re-attach captures each piece's offset against the same neutral baseline.
 *
 * Shaped as a PoseFrame (see applyPose.ts) so applyFrame can apply it directly:
 * - `angles` — page-space degrees for the posable bones only (POSABLE_BONES, the same
 *   set applyFrame touches), so adding/re-angling a template bone updates rest
 *   automatically with no hand-synced list.
 * - `pelvis` — the root sits at its standing baseline: no drop, lean = the pelvis
 *   template's own page-space angle.
 *
 * Kept as a plain object (not importing PoseFrame's type, to avoid a rig→pose import
 * cycle); applyFrame accepts this structurally.
 */
const templateAngle = (name: string): number => GEOMETRY[name]?.angle ?? 0
export const REST_FRAME: { angles: Record<string, number>; pelvis: { drop: number; lean: number } } = {
	angles: Object.fromEntries(POSABLE_BONES.map((n) => [n, templateAngle(n)])),
	pelvis: { drop: 0, lean: templateAngle('pelvis') },
}

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
		for (const spec of HUMANOID_BONES) {
			const geom = GEOMETRY[spec.name]
			if (!geom) continue // template bone with no geometry entry — skip rather than NaN

			const id = spec.name === 'pelvis' ? figureId : createShapeId()
			ids.set(spec.name, id)

			const rotation = geom.angle * DEG
			// A child's head is its parent's tail. HUMANOID_BONES is ordered parent-first,
			// so the parent's tail is always already computed; guard anyway so a future
			// reorder degrades to "start at origin" instead of a NaN position.
			const head = spec.parent ? tails.get(spec.parent) ?? { x: origin.x, y: origin.y } : { x: origin.x, y: origin.y }

			editor.createShape<BoneShape>({
				id,
				type: 'poser-bone',
				x: head.x,
				y: head.y,
				rotation,
				meta: { figureId },
				props: sharedBoneProps(spec.color, geom.length, spec.name),
			})

			// Tail = head + length along the bone's angle.
			tails.set(spec.name, {
				x: head.x + Math.cos(rotation) * geom.length,
				y: head.y + Math.sin(rotation) * geom.length,
			})

			const parentId = spec.parent ? ids.get(spec.parent) : undefined
			if (parentId) {
				editor.createBinding({
					id: createBindingId(),
					type: 'bone-joint',
					fromId: parentId, // parent
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
