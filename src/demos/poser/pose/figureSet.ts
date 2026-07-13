import type { Atom, TLShapeId } from 'tldraw'

/**
 * Add or remove one figure id from an `atom<ReadonlySet<TLShapeId>>`, writing a fresh
 * Set so the atom's identity changes and `useValue` subscribers re-render. Shared by
 * the per-figure reactive flags (posePlayer's `playingFigures`, editMode's
 * `editingFigures`) so the immutable-set-update idiom lives in one place.
 */
export function setFigureFlag(atom: Atom<ReadonlySet<TLShapeId>>, figure: TLShapeId, on: boolean): void {
	const next = new Set(atom.get())
	if (on) next.add(figure)
	else next.delete(figure)
	atom.set(next)
}
