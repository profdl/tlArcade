import { type Editor, type JsonObject, type TLShape, type TLShapePartial } from 'tldraw'
import { getPuppetMeta, type PuppetMeta, type PuppetRole, type RestPose } from './roles'

/**
 * Authoring: turn ordinary drawn shapes into rig features (and back). This is the
 * "bring your own art" flow from the plan — the user draws whatever they like,
 * selects it, and assigns it a role. We only ever write `meta`; the shape itself
 * (draw stroke, geo, image, group…) is never replaced.
 *
 * Rest-pose invariant (shared with the driver): assigning a role captures the
 * shape's CURRENT transform as its immutable `meta.rest`. From then on the driver
 * deforms *from* rest and never re-derives it, so re-scanning can't recapture an
 * already-deformed pose. Re-assigning a role does NOT recapture rest — the pose
 * you drew at first assignment is the neutral one; use {@link reanchorRole} to
 * deliberately re-bake the current pose as the new rest.
 */

/** Read `w`/`h` off a shape's props if it has them (geo, image, video, frame, …). */
function readSize(props: unknown): { w: number; h: number } | null {
	const p = props as { w?: unknown; h?: unknown }
	if (typeof p?.w === 'number' && typeof p?.h === 'number') return { w: p.w, h: p.h }
	return null
}

/** The shape's current transform + size, captured as an immutable rest pose. */
function captureRest(shape: TLShape): RestPose {
	const size = readSize((shape as { props?: unknown }).props)
	return { x: shape.x, y: shape.y, rotation: shape.rotation, w: size?.w ?? null, h: size?.h ?? null }
}

/** The page-space center of a rest pose (falls back to its top-left when sizeless). */
function restCenter(rest: RestPose): { x: number; y: number } {
	return { x: rest.x + (rest.w ?? 0) / 2, y: rest.y + (rest.h ?? 0) / 2 }
}

/**
 * Assign a puppet role to one or more shapes, **taking over the role's slot** in
 * the rig:
 *
 * 1. Any shape that already holds `role` (the prior owner — e.g. the default
 *    puppet's feature) is *un-assigned*: its rig `meta` is stripped so it becomes
 *    plain art the user can keep or delete. It is never deleted for them.
 * 2. The newly-assigned shape is **moved so its center lands on the prior owner's
 *    rest center** and **rotated to match the prior owner's rest rotation**,
 *    keeping its own size — so hand-drawn art drops into the rig's layout slot
 *    instead of staying wherever it was drawn. The rotation is applied with
 *    tldraw's native `editor.rotateShapesBy` about the slot center (so the shape
 *    orbits the slot correctly, exactly like the driver rotates the head group),
 *    never by writing the `rotation` prop directly. With no prior owner, the shape
 *    stays put and is assigned in place.
 * 3. Its rest pose is then captured from the RESULTING live transform (after the
 *    move + rotate), immutable from then on per the driver's rest invariant.
 *
 * A shape re-assigned to the SAME role it already holds is just re-confirmed in
 * place (it is its own prior owner, so there's no slot to move into). All writes
 * go through one `editor.run` (normal history — a single undoable authoring step).
 * Returns the ids that were newly assigned the role.
 */
export function assignRole(editor: Editor, ids: readonly TLShape['id'][], role: PuppetRole): TLShape['id'][] {
	const assignSet = new Set(ids)
	// Prior owners of this role that are NOT among the shapes we're assigning.
	const priorOwners = editor
		.getCurrentPageShapes()
		.filter((s) => !assignSet.has(s.id) && getPuppetMeta(s)?.puppetRole === role)
	// The slot to drop into: the first prior owner's rest (stable authored data, not
	// the live/deformed transform) — its center and rotation. Null when unoccupied.
	const priorRest = priorOwners.map((s) => getPuppetMeta(s)!.rest).find((r): r is RestPose => !!r)
	const slot = priorRest ? { ...restCenter(priorRest), rotation: priorRest.rotation } : null

	const assigned: TLShape['id'][] = []
	editor.run(
		() => {
			// 1. Un-assign the prior owners (strip their rig meta; keep the art).
			stripRoleMeta(editor, priorOwners.map((s) => s.id))

			for (const id of ids) {
				const shape = editor.getShape(id)
				if (!shape) continue
				if (slot) {
					// 2a. Translate: center the shape on the slot (keep its own size).
					const size = readSize((shape as { props?: unknown }).props)
					const x = slot.x - (size?.w ?? 0) / 2
					const y = slot.y - (size?.h ?? 0) / 2
					editor.updateShapes([{ id: shape.id, type: shape.type, x, y } as TLShapePartial])
					// 2b. Rotate to match the slot's rotation, about the slot center, using
					// the native API so the shape orbits the center rather than spinning on
					// its own origin. Delta from the shape's current rotation.
					const delta = slot.rotation - shape.rotation
					if (delta !== 0) editor.rotateShapesBy([shape.id], delta, { center: { x: slot.x, y: slot.y } })
				}
				// 3. Capture rest from the resulting live transform.
				const live = editor.getShape(id)!
				const rest = captureRest(live)
				const meta: PuppetMeta = { ...(getPuppetMeta(live) ?? {}), puppetRole: role, rest }
				editor.updateShapes([{ id: live.id, type: live.type, meta: meta as unknown as JsonObject } as TLShapePartial])
				assigned.push(id)
			}
		},
		{ ignoreShapeLock: true }
	)
	return assigned
}

/** The puppet keys `clearRole`/`stripRoleMeta` remove from a shape's meta. */
const PUPPET_META_KEYS = ['puppetRole', 'pivot', 'binding', 'variant', 'rest'] as const

/**
 * Replace each shape's `meta` with a copy that omits every puppet key. Shared by
 * {@link clearRole} and {@link assignRole}'s takeover. Uses `editor.store.update`
 * (a full-record replace) because `updateShapes` *merges* meta and can't remove
 * keys, and passing `undefined` fails the store's json-serializable validator.
 * The caller is responsible for wrapping this in its own `editor.run`.
 */
function stripRoleMeta(editor: Editor, ids: readonly TLShape['id'][]): TLShape['id'][] {
	const cleared: TLShape['id'][] = []
	for (const id of ids) {
		const shape = editor.getShape(id)
		if (!shape || !getPuppetMeta(shape)) continue
		const nextMeta = { ...(shape.meta as Record<string, unknown>) }
		for (const key of PUPPET_META_KEYS) delete nextMeta[key]
		editor.store.update(id, (rec) => ({ ...rec, meta: nextMeta as JsonObject }))
		cleared.push(id)
	}
	return cleared
}

/**
 * Remove a shape from the rig: strip every puppet key from its `meta` (role,
 * pivot, binding, variant, rest) so the driver ignores it next scan. The art
 * stays exactly where it is — only the rig tagging is cleared.
 *
 * We can't do this with `updateShapes`: it *merges* `meta` (see tldraw's
 * `applyPartialToRecordWithProps` — for a `meta`/`props` key it copies the old
 * object then overlays the partial, and never removes keys), and passing
 * `undefined` to force a delete fails the store's json-serializable validator.
 * So we go through `editor.store.update`, which *replaces* the whole record: the
 * updater returns a shape whose `meta` is rebuilt with the puppet keys omitted.
 * Wrapped in `editor.run` so the removal is a single undoable authoring step.
 */
export function clearRole(editor: Editor, ids: readonly TLShape['id'][]): TLShape['id'][] {
	let cleared: TLShape['id'][] = []
	editor.run(() => {
		cleared = stripRoleMeta(editor, ids)
	}, { ignoreShapeLock: true })
	return cleared
}

/**
 * Re-bake the current pose of already-tagged shapes as their new immutable rest.
 * Use after the user deliberately re-poses a feature (moved/resized/rotated it)
 * and wants that to become the neutral pose the rig deforms from. Shapes without
 * a puppet role are skipped.
 */
export function reanchorRole(editor: Editor, ids: readonly TLShape['id'][]): TLShape['id'][] {
	const partials: TLShapePartial[] = []
	for (const id of ids) {
		const shape = editor.getShape(id)
		if (!shape || !getPuppetMeta(shape)) continue
		const rest = captureRest(shape)
		partials.push({
			id: shape.id,
			type: shape.type,
			meta: { ...(shape.meta as JsonObject), rest: rest as unknown as JsonObject },
		} as TLShapePartial)
	}
	if (partials.length === 0) return []
	editor.run(() => editor.updateShapes(partials), { ignoreShapeLock: true })
	return partials.map((p) => p.id)
}

/**
 * The single role shared by a selection, or null if the selection is empty,
 * unassigned, or mixed. Lets the assign UI show a checkmark next to the current
 * role and enable "clear"/"re-anchor" only when something is actually tagged.
 */
export function selectionRole(editor: Editor, ids: readonly TLShape['id'][]): PuppetRole | null {
	let role: PuppetRole | null = null
	for (const id of ids) {
		const shape = editor.getShape(id)
		const meta = shape ? getPuppetMeta(shape) : null
		if (!meta) return null
		if (role === null) role = meta.puppetRole
		else if (role !== meta.puppetRole) return null
	}
	return role
}
