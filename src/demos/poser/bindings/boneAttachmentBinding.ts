import { T, type TLBaseBinding } from 'tldraw'

/**
 * Makes an arbitrary drawn shape "ride" a bone. `fromId` is the bone, `toId` is the
 * drawn shape (a draw stroke, geo, image — anything the user made).
 *
 * Unlike `bone-joint` (which carries no props and only pins a head to a tail), an
 * attachment stores the shape's full rigid offset **in the bone's local frame**,
 * captured once at attach time: where the shape's origin sits relative to the bone
 * (`dx, dy` in the bone's local coords) and how much it's rotated relative to the
 * bone (`rot`, radians). When the bone later moves or rotates, we map that fixed
 * local offset back out to page space, so the artwork follows the bone rigidly —
 * the drawing poses along with the rig.
 */
export interface BoneAttachmentBindingProps {
	/** Shape origin in the bone's local space (bone head = origin, +x = along the bone). */
	dx: number
	dy: number
	/** Shape rotation relative to the bone's rotation (radians). */
	rot: number
}

export type BoneAttachmentBinding = TLBaseBinding<'bone-attachment', BoneAttachmentBindingProps>

// Register with tldraw's global binding-type union (see repo toolkit CLAUDE.md
// gotcha #6) so editor.createBinding accepts the 'bone-attachment' type.
declare module '@tldraw/tlschema' {
	interface TLGlobalBindingPropsMap {
		'bone-attachment': BoneAttachmentBindingProps
	}
}

export const boneAttachmentBindingProps = {
	dx: T.number,
	dy: T.number,
	rot: T.number,
} satisfies Record<keyof BoneAttachmentBindingProps, T.Validatable<unknown>>
