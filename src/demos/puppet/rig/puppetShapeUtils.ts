import { GeoShapeUtil, type TLGeoShape } from 'tldraw'
import { getPuppetMeta } from './roles'
import { isTrackingLive } from './trackingState'

/**
 * The default puppet is built from native `geo` shapes, and users bring their own
 * geo art too. We subclass GeoShapeUtil to change ONE behavior: a rig feature
 * can't be resized WHILE TRACKING IS LIVE. (`ShapeUtil.configure` only patches the
 * util's `options` object, not methods like `canResize`, so a subclass is the way
 * to override it.)
 *
 * Why block it rather than handle it: the driver rewrites each feature's transform
 * ~60×/second from its immutable rest pose. A user resize during that fights the
 * per-frame deform — the driver keeps snapping the shape back to the old rest,
 * which read as "always scales from the top-left," and any attempt to re-bake rest
 * mid-deform races the driver into a runaway. So the rule is simple: pause tracking
 * to resize. When paused, `canResize` returns true and the paused reanchor path
 * re-bakes the new size into rest cleanly.
 *
 * Non-feature geo shapes, and all resizing while paused, are unaffected. We only
 * override `canResize` — every other GeoShapeUtil behavior is inherited untouched.
 */
export class PuppetGeoShapeUtil extends GeoShapeUtil {
	override canResize(shape: TLGeoShape): boolean {
		if (isTrackingLive() && getPuppetMeta(shape) !== null) return false
		return super.canResize(shape)
	}
}
