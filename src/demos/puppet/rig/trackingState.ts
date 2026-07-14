/**
 * A tiny module-level flag for whether face tracking is currently live. It's the
 * bridge between the React panel (which owns the tracking on/off state) and the
 * configured shape util below, which is a plain object tldraw constructs once and
 * can't take React props. `PuppetStage` writes it whenever tracking toggles; the
 * shape util's `canResize` reads it to disable resize handles on rig features
 * while the driver is animating them (resizing a shape mid-deform is what threw
 * the rig off — so we simply forbid it until the user pauses).
 *
 * A module-level singleton is safe here because only one puppet demo is ever
 * mounted at a time (see repo CLAUDE.md — one demo mounted at a time).
 */
let tracking = false

export function setTrackingLive(live: boolean): void {
	tracking = live
}

export function isTrackingLive(): boolean {
	return tracking
}
