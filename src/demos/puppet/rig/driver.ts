import { type Editor, type JsonObject, type TLShapeId, type TLShapePartial } from 'tldraw'
import { evalBinding, HEAD_PARENT_PARAM, resolveBinding } from './binding'
import type { PuppetParams } from './params'
import { getPuppetMeta, type RestPose, type RigFeature } from './roles'

const MIN_SCALE = 0.02 // never fully collapse a shape (0 breaks geometry + hit-testing)

/** Read `w`/`h` off a shape's props if it has them (geo, image, video, frame, …). */
function readSize(props: unknown): { w: number; h: number } | null {
	const p = props as { w?: unknown; h?: unknown }
	if (typeof p?.w === 'number' && typeof p?.h === 'number') return { w: p.w, h: p.h }
	return null
}

/**
 * The rig driver: reads the puppet features tagged on the canvas and, each
 * frame, writes their transforms from a set of PuppetParams. It never creates or
 * owns art — it only writes x/y/rotation and (where the shape has w/h props)
 * size, on shapes the user drew and tagged.
 *
 * CRITICAL invariant (learned from face-mask): the rest pose is IMMUTABLE
 * authored data stored in each shape's `meta.rest`, captured exactly once. The
 * driver deforms *from* rest every frame and NEVER re-derives rest from the live
 * (already-deformed) shape. That's what makes scan() idempotent and kills the
 * compounding feedback loop — face-mask does the same with its bind-time
 * `base*`/`offset*` props. All per-frame writes go through one
 * `editor.run(history:'ignore')` per the repo's authoring-vs-sim split.
 */
export class PuppetDriver {
	private features: RigFeature[] = []
	private editor: Editor
	/**
	 * The head feature (if the puppet has one) — its rest pivot in page space is
	 * the center every child feature orbits when the head rolls. Null when no
	 * shape is tagged `head`, in which case there's no parent rotation.
	 */
	private headPivotPage: { x: number; y: number } | null = null
	/** True while apply() is mid-write, so a store listener can ignore the driver's own churn. */
	isApplying = false

	constructor(editor: Editor) {
		this.editor = editor
	}

	/**
	 * (Re)scan the page for tagged puppet shapes. For each, read its rest pose
	 * from `meta.rest`; if absent (a freshly drawn/assigned feature), capture the
	 * shape's CURRENT transform as rest and persist it into meta — once. Safe to
	 * call any number of times: existing rest is never overwritten, so re-scanning
	 * mid-performance can't recapture a deformed shape.
	 */
	scan() {
		const features: RigFeature[] = []
		const captures: TLShapePartial[] = []

		for (const shape of this.editor.getCurrentPageShapes()) {
			const meta = getPuppetMeta(shape)
			if (!meta) continue

			let rest = meta.rest
			if (!rest) {
				const size = readSize((shape as { props?: unknown }).props)
				rest = {
					x: shape.x,
					y: shape.y,
					rotation: shape.rotation,
					w: size?.w ?? null,
					h: size?.h ?? null,
				}
				captures.push({
					id: shape.id,
					type: shape.type,
					meta: { ...(shape.meta as JsonObject), rest: rest as unknown as JsonObject },
				} as TLShapePartial)
			}

			features.push({ id: shape.id, role: meta.puppetRole, meta: { ...meta, rest }, rest })
		}

		// Persist any newly-captured rest poses (normal history — this is an authoring act).
		if (captures.length > 0) {
			this.isApplying = true
			try {
				this.editor.run(() => this.editor.updateShapes(captures), { ignoreShapeLock: true })
			} finally {
				this.isApplying = false
			}
		}

		this.features = features

		// Cache the head's rest pivot in page space — the shared orbit center for
		// head roll. Uses meta.pivot (local 0..1) against the head's rest bounds so
		// it's stable authored data, never read back from the deforming shape.
		const head = features.find((f) => f.role === 'head')
		if (head) {
			const pivot = head.meta.pivot ?? { x: 0.5, y: 0.5 }
			this.headPivotPage = {
				x: head.rest.x + (head.rest.w ?? 0) * pivot.x,
				y: head.rest.y + (head.rest.h ?? 0) * pivot.y,
			}
		} else {
			this.headPivotPage = null
		}
	}

	get featureCount() {
		return this.features.length
	}

	/** Recompute rest for a specific shape (e.g. user deliberately re-poses a feature and re-anchors it). */
	reanchor(id: string) {
		const shape = this.editor.getShape(id as RigFeature['id'])
		if (!shape || !getPuppetMeta(shape)) return
		const size = readSize((shape as { props?: unknown }).props)
		const rest: RestPose = { x: shape.x, y: shape.y, rotation: shape.rotation, w: size?.w ?? null, h: size?.h ?? null }
		this.isApplying = true
		try {
			this.editor.run(
				() =>
					this.editor.updateShapes([
						{ id: shape.id, type: shape.type, meta: { ...(shape.meta as JsonObject), rest: rest as unknown as JsonObject } } as TLShapePartial,
					]),
				{ ignoreShapeLock: true }
			)
		} finally {
			this.isApplying = false
		}
		this.scan()
	}

	/**
	 * Apply one frame of params to every feature.
	 *
	 * Two passes, both idempotent so nothing compounds:
	 *
	 * 1. **Head-neutral reset** (absolute, from immutable rest): place every
	 *    feature at its rest transform plus its own LOCAL deltas — translation,
	 *    scale, and any self-rotation (brow arch, body lean). Head roll is
	 *    deliberately excluded here.
	 * 2. **Parent rotation** (relative, via `editor.rotateShapesBy`): roll the
	 *    head and ALL its child features together, about the head's rest pivot, by
	 *    `headRoll`. Because pass 1 just reset the group to the same base pose, the
	 *    relative rotate always starts from an identical state and can't drift —
	 *    the same reason the rest pose stays immutable. This is what makes the
	 *    features orbit the head (true parenting) instead of each spinning on its
	 *    own center.
	 */
	apply(params: PuppetParams) {
		if (this.features.length === 0) return

		const updates: TLShapePartial[] = []

		for (const f of this.features) {
			const binding = resolveBinding(f.role, f.meta.binding)
			const d = evalBinding(binding, params)
			const sx = Math.max(MIN_SCALE, d.scaleX)
			const sy = Math.max(MIN_SCALE, d.scaleY)
			const pivot = f.meta.pivot ?? { x: 0.5, y: 0.5 }

			// All geometry from rest (immutable) — never from the live shape.
			const w0 = f.rest.w ?? 0
			const h0 = f.rest.h ?? 0

			// Writing w/h grows a shape from its top-left origin. To keep the pivot
			// fixed, shift the origin: as w goes w0 -> w0*sx, the pivot at local
			// pivot.x*w0 moves by pivot.x*w0*(sx-1); subtract it. Same for y.
			const scaleShiftX = -pivot.x * w0 * (sx - 1)
			const scaleShiftY = -pivot.y * h0 * (sy - 1)
			const baseX = f.rest.x + scaleShiftX
			const baseY = f.rest.y + scaleShiftY

			// Rotate the (scaled) origin about the pivot by the feature's LOCAL
			// rotation only (head roll is applied later as the shared parent turn).
			const px = f.rest.x + w0 * pivot.x
			const py = f.rest.y + h0 * pivot.y
			const relX = baseX - px
			const relY = baseY - py
			const cos = Math.cos(d.drot)
			const sin = Math.sin(d.drot)

			// Non-literal `type` can fail the discriminated-union check once other demos
			// widen the shape union (see repo CLAUDE.md); cast the whole partial per the
			// documented call-site pattern.
			const partial = {
				id: f.id,
				type: this.editor.getShape(f.id)!.type,
				x: px + relX * cos - relY * sin + d.dx,
				y: py + relX * sin + relY * cos + d.dy,
				rotation: f.rest.rotation + d.drot,
			} as TLShapePartial

			// Only write size when the shape has w/h at rest and something actually scales.
			if (f.rest.w !== null && f.rest.h !== null && (sx !== 1 || sy !== 1)) {
				;(partial as { props?: Record<string, number> }).props = { w: f.rest.w * sx, h: f.rest.h * sy }
			}

			updates.push(partial)
		}

		const headRoll = params[HEAD_PARENT_PARAM] as number
		const ids = this.features.map((f) => f.id)

		this.isApplying = true
		try {
			this.editor.run(
				() => {
					// Pass 1: reset the whole group to its head-neutral pose.
					this.editor.updateShapes(updates)
					// Pass 2: roll head + children together about the head's rest pivot.
					if (this.headPivotPage && headRoll !== 0) {
						this.editor.rotateShapesBy(ids as TLShapeId[], headRoll, { center: this.headPivotPage })
					}
				},
				{ history: 'ignore', ignoreShapeLock: true }
			)
		} finally {
			this.isApplying = false
		}
	}
}
