import { type TLBaseBinding } from 'tldraw'

/**
 * Pins a child bone's *head* (its local origin) to its parent bone's *tail*
 * (the parent's distal joint). `fromId` is the parent bone, `toId` is the child.
 *
 * The child keeps its own rotation, so when the parent swings, the child
 * translates to stay attached but doesn't inherit the parent's spin — that's
 * forward kinematics for a limb chain. (Inheriting rotation too would make the
 * whole arm rigid; we want the elbow to bend independently.)
 */
export type BoneJointBindingProps = Record<string, never>

export type BoneJointBinding = TLBaseBinding<'bone-joint', BoneJointBindingProps>

// Register with tldraw's global binding-type union (see repo toolkit CLAUDE.md
// gotcha #6) so editor.getShape/createBinding accept the 'bone-joint' type.
declare module '@tldraw/tlschema' {
	interface TLGlobalBindingPropsMap {
		'bone-joint': BoneJointBindingProps
	}
}

export const boneJointBindingProps = {} satisfies Record<string, never>
