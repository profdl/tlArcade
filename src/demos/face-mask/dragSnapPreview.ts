import { atom, type TLShapeId } from 'tldraw'

export type DragSnapCandidate = {
	faceShapeId: TLShapeId
	landmark: string
	/** Set when the shape would attach in two-landmark axis mode (e.g. a head outline spanning forehead+chin) — both markers halo. */
	secondaryLandmark?: string
} | null

/**
 * The landmark a shape currently being dragged would snap to if dropped right now. Plain
 * mutable UI state, not part of the document — read imperatively from the face-video shape's
 * draw loop (no need for React reactivity there) and written from App's pointer-move handler.
 */
export const dragSnapCandidateAtom = atom<DragSnapCandidate>('dragSnapCandidate', null)
