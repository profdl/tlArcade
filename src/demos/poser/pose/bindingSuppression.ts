import type { TLShapeId } from 'tldraw'

/**
 * Shared "in-flight" set of bone ids whose changes are being written by the rig
 * itself (the bone-joint binding re-pinning a joint, or the IK solver setting a
 * limb's rotation) rather than by a user drag.
 *
 * The bone-joint binding's `onAfterChangeToShape` normally reinterprets any child
 * change as "the user grabbed this bone → rotate it around its joint". When the
 * IK solver writes a bone's rotation directly, that would be wrong — the solver
 * has already decided the angle. So the solver adds the affected ids here for the
 * duration of its write, and the binding checks this set and skips its
 * reinterpretation for suppressed ids. Same mechanism the binding already uses
 * for its own self-writes; centralized here so both modules share one set.
 */
const suppressed = new Set<string>()

/** True if changes to `id` should be treated as rig-internal, not a user drag. */
export function isSuppressed(id: TLShapeId): boolean {
	return suppressed.has(id)
}

/** Mark `ids` as rig-internal for the duration of `fn` (removed even if it throws). */
export function withSuppressed<T>(ids: Iterable<TLShapeId>, fn: () => T): T {
	const added: string[] = []
	for (const id of ids) {
		if (!suppressed.has(id)) {
			suppressed.add(id)
			added.push(id)
		}
	}
	try {
		return fn()
	} finally {
		for (const id of added) suppressed.delete(id)
	}
}
