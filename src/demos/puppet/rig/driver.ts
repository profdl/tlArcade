import { type Editor, type TLShapePartial } from 'tldraw'
import { evalBinding, resolveBinding } from './binding'
import type { PuppetParams } from './params'
import { getPuppetMeta, type RigFeature } from './roles'

/** A feature's rest pose + rest size, everything needed to deform it without compounding. */
type RestState = {
	feature: RigFeature
	/** Rest w/h from the shape's own props (geo/image/etc.), or null if the shape has no size props to scale. */
	size: { w: number; h: number } | null
}

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
 * Every write is computed ABSOLUTELY from a captured rest pose, so per-frame
 * writes never compound (the classic drift bug). Scale is done by setting w/h
 * directly rather than `editor.resizeShape`, which is stateful and compounds.
 * All writes go through one `editor.run(history:'ignore')` per the repo's
 * authoring-vs-sim split.
 */
export class PuppetDriver {
	private rest: RestState[] = []
	private editor: Editor

	constructor(editor: Editor) {
		this.editor = editor
	}

	/**
	 * (Re)scan the page for tagged puppet shapes and snapshot their rest poses.
	 * Call on mount and whenever the user assigns/redraws/removes a feature.
	 */
	scan() {
		const rest: RestState[] = []
		for (const shape of this.editor.getCurrentPageShapes()) {
			const meta = getPuppetMeta(shape)
			if (!meta) continue
			rest.push({
				feature: {
					id: shape.id,
					role: meta.puppetRole,
					meta,
					rest: { x: shape.x, y: shape.y, rotation: shape.rotation },
				},
				size: readSize((shape as { props?: unknown }).props),
			})
		}
		this.rest = rest
	}

	get featureCount() {
		return this.rest.length
	}

	/** Apply one frame of params to every feature. All values derived from rest. */
	apply(params: PuppetParams) {
		if (this.rest.length === 0) return

		const updates: TLShapePartial[] = []

		for (const { feature: f, size } of this.rest) {
			const binding = resolveBinding(f.role, f.meta.binding)
			const d = evalBinding(binding, params)
			const sx = Math.max(MIN_SCALE, d.scaleX)
			const sy = Math.max(MIN_SCALE, d.scaleY)
			const pivot = f.meta.pivot ?? { x: 0.5, y: 0.5 }

			// Scaling a shape by writing w/h grows it from its top-left origin. To keep
			// the pivot point fixed, shift the origin so the pivot stays put: as w goes
			// from w0 to w0*sx, the pivot at local (pivot.x*w0) moves by
			// pivot.x*w0*(sx-1); subtract that from x. Same for y.
			const w0 = size?.w ?? 0
			const h0 = size?.h ?? 0
			const scaleShiftX = -pivot.x * w0 * (sx - 1)
			const scaleShiftY = -pivot.y * h0 * (sy - 1)

			// Base (scaled, un-rotated) origin, with the scale-shift so the pivot holds.
			const baseX = f.rest.x + scaleShiftX
			const baseY = f.rest.y + scaleShiftY

			// Rotate that origin about the pivot (in page space, at rest position).
			const px = f.rest.x + w0 * pivot.x
			const py = f.rest.y + h0 * pivot.y
			const relX = baseX - px
			const relY = baseY - py
			const cos = Math.cos(d.drot)
			const sin = Math.sin(d.drot)

			const partial = {
				id: f.id,
				type: this.editor.getShape(f.id)!.type,
				x: px + relX * cos - relY * sin + d.dx,
				y: py + relX * sin + relY * cos + d.dy,
				rotation: f.rest.rotation + d.drot,
			} as TLShapePartial

			// Only write size when the shape actually has w/h props and something scales.
			if (size && (sx !== 1 || sy !== 1)) {
				;(partial as { props?: Record<string, number> }).props = { w: size.w * sx, h: size.h * sy }
			}

			// Non-literal `type` can fail the discriminated-union check once other demos
			// widen the shape union (see repo CLAUDE.md); the `as TLShapePartial` above
			// applies the documented call-site cast.
			updates.push(partial)
		}

		this.editor.run(
			() => {
				this.editor.updateShapes(updates)
			},
			{ history: 'ignore', ignoreShapeLock: true }
		)
	}
}
