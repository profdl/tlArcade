import { atom } from 'tldraw'

/**
 * Whether the bone rig is visually shown. When hidden, bones still exist and still
 * pose (and any attached drawing still rides them) — only the bone capsules, joint
 * hubs, and IK handles stop rendering, so the user sees just their posed artwork.
 *
 * A reactive `atom` so components (BoneBody, IkHandlesOverlay) that read it via
 * `useValue` re-render when it flips. Module-level = shared across the whole demo.
 */
export const rigVisible = atom('rigVisible', true)

export function toggleRig() {
	rigVisible.set(!rigVisible.get())
}

/**
 * Restore the default (rig shown). This atom is module-level so it persists across a
 * demo unmount/remount; without a reset, remounting onto a fresh canvas could inherit
 * a hidden rig from the previous session, leaving bones invisible with no obvious way
 * back. Called from the demo's unmount cleanup.
 */
export function resetRigVisibility() {
	rigVisible.set(true)
}
