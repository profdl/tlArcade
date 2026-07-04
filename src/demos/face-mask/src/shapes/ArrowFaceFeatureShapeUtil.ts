import { ArrowShapeUtil } from 'tldraw'

/**
 * tldraw's built-in ArrowShapeUtil.canBind vetoes *any* binding that targets an arrow (its
 * `toShape`) — it's written to stop other shapes from using tldraw's own `arrow` binding type in
 * reverse, but the check isn't scoped to that binding type, so it also blocks our unrelated
 * `face-feature` binding from ever attaching to an arrow. Without this override, an arrow drawn
 * onto a face landmark silently never gets pinned: `createBinding` just drops the request.
 */
export class ArrowFaceFeatureShapeUtil extends ArrowShapeUtil {
	override canBind(opts: Parameters<ArrowShapeUtil['canBind']>[0]): boolean {
		if (opts.bindingType === 'face-feature') return true
		return super.canBind(opts)
	}
}
