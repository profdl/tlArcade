/**
 * WORLD STYLE — the pluggable "feel" seam of Scale Rooms.
 * ========================================================
 * A world is a tree of nested rooms (roomTree.ts). The one per-room choice that gives it
 * its character is PLACEMENT — where a child room sits over its parent's floor:
 *   'corner'  — snapped to a parent corner (the size-chart look: nested corner squares).
 *   'center'  — centred in the parent (concentric, bullseye nesting).
 *   'offset'  — a seeded position within the parent, biased toward the child's anchor.
 * Children are always assigned DISTINCT corner anchors first (roomTree), so even
 * 'center'/'offset' worlds keep several children from perfectly coinciding.
 *
 * A style may fix the mode, or set it to 'mixed' — then roomTree picks per child from a
 * seeded draw, so one world shows all the modes at once. The picker (WorldControls.tsx)
 * swaps styles and rebuilds the world in place.
 */

export type PlacementMode = 'corner' | 'center' | 'offset'

export type WorldStyle = {
	/** Fixed placement mode, or 'mixed' to vary it per child from a seeded draw. */
	placement: PlacementMode | 'mixed'
}

/** The picker's presets. `mixed` is first (the default — every mode at once). */
export const STYLES = {
	mixed: { placement: 'mixed' },
	corners: { placement: 'corner' },
	centered: { placement: 'center' },
	scattered: { placement: 'offset' },
} satisfies Record<string, WorldStyle>

export type StyleName = keyof typeof STYLES

/** Display order for the preset UI. */
export const STYLE_ORDER: StyleName[] = ['mixed', 'corners', 'centered', 'scattered']

/** Human labels for the preset buttons. */
export const STYLE_LABELS: Record<StyleName, string> = {
	mixed: 'Mixed',
	corners: 'Corners',
	centered: 'Centered',
	scattered: 'Scattered',
}
