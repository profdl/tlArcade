import type { PuppetParams } from './params'
import type { PuppetRole } from './roles'

/**
 * A binding maps the puppet params to a feature's per-frame transform *delta*
 * from its rest pose. Each field is a linear combination of params: for a role,
 * `dx = Σ (params[p] * gain)`. This is deliberately simple (affine-only) so it
 * works on *any* shape — the driver only ever nudges x/y/rotation/scale/opacity,
 * which every tldraw shape supports. Richer deformation (mesh warp) is M7.
 *
 * Gains are in tldraw page units for dx/dy, radians for drot, and unitless
 * multipliers for scale. They're tuned for a ~200px-tall default head; the
 * driver scales dx/dy/pivot by the feature's own size so hand-drawn art of any
 * size reads proportionally.
 */
export type BindingTerm = Partial<Record<keyof PuppetParams, number>>

export type FeatureBinding = {
	dx?: BindingTerm // horizontal offset
	dy?: BindingTerm // vertical offset
	drot?: BindingTerm // rotation (radians)
	dscaleX?: BindingTerm // horizontal scale delta (added to 1)
	dscaleY?: BindingTerm // vertical scale delta (added to 1)
	/** For swap-sets: the param whose value selects/cross-fades variants, plus the variant order. */
	swap?: { param: keyof PuppetParams; variants: string[] }
}

/** Evaluate one binding term against the current params. */
function term(t: BindingTerm | undefined, params: PuppetParams): number {
	if (!t) return 0
	let sum = 0
	for (const key of Object.keys(t) as (keyof PuppetParams)[]) {
		const v = params[key]
		if (typeof v === 'number') sum += v * (t[key] as number)
	}
	return sum
}

export type FeatureDelta = {
	dx: number
	dy: number
	/**
	 * The feature's OWN local rotation delta (brow arch, body lean, …) — spun
	 * about its own pivot. Head roll is deliberately NOT folded in here: it's the
	 * shared, parent rotation that orbits the whole head group about the head's
	 * pivot, and the driver applies it once via `editor.rotateShapesBy`. See
	 * `HEAD_PARENT_PARAM`.
	 */
	drot: number
	scaleX: number
	scaleY: number
}

/**
 * The single param that acts as the head's (and thus the whole face group's)
 * rigid rotation. Every feature is a child of the head for roll: the driver
 * pulls this term OUT of each binding's `drot` and applies it once, to the head
 * plus all its children together, about the head's pivot — so the eyes/mouth/
 * brows orbit the head instead of each spinning on its own center.
 */
export const HEAD_PARENT_PARAM: keyof PuppetParams = 'headRoll'

export function evalBinding(binding: FeatureBinding, params: PuppetParams): FeatureDelta {
	// Local rotation excludes the head-parent term; that's applied as the shared
	// group rotation about the head pivot, not per-feature about its own center.
	const localRot = term(binding.drot, params) - (params[HEAD_PARENT_PARAM] as number) * (binding.drot?.[HEAD_PARENT_PARAM] ?? 0)
	return {
		dx: term(binding.dx, params),
		dy: term(binding.dy, params),
		drot: localRot,
		scaleX: 1 + term(binding.dscaleX, params),
		scaleY: 1 + term(binding.dscaleY, params),
	}
}

/**
 * Default bindings per built-in role. These are just sensible starting points;
 * M6 lets the user edit them per feature in-canvas. Head yaw/pitch move the
 * head and drag hair/body along at reduced weight for a parallax feel.
 */
export const DEFAULT_BINDINGS: Record<PuppetRole, FeatureBinding> = {
	head: {
		dx: { headYaw: 70 },
		dy: { headPitch: -70, bodyBob: 6 },
		drot: { headRoll: 1 },
	},
	hairFront: {
		dx: { headYaw: 42 },
		dy: { headPitch: -42, bodyBob: 8 },
		drot: { headRoll: 1 },
	},
	hairBack: {
		dx: { headYaw: 28 },
		dy: { headPitch: -28, bodyBob: 4 },
		drot: { headRoll: 1 },
	},
	body: {
		dx: { bodyLean: 40, headYaw: 12 },
		dy: { bodyBob: 4 },
		drot: { bodyLean: 0.15 },
	},
	eyeL: { dx: { headYaw: 60 }, dy: { headPitch: -60 }, drot: { headRoll: 1 } },
	eyeR: { dx: { headYaw: 60 }, dy: { headPitch: -60 }, drot: { headRoll: 1 } },
	// Eyelids blink by collapsing vertical scale as the eye closes (eyeOpen -> 1 = open).
	eyelidL: { dx: { headYaw: 60 }, dy: { headPitch: -60 }, dscaleY: { eyeOpenL: -1 } },
	eyelidR: { dx: { headYaw: 60 }, dy: { headPitch: -60 }, dscaleY: { eyeOpenR: -1 } },
	browL: { dx: { headYaw: 60 }, dy: { headPitch: -60, eyeBrowL: -14 }, drot: { eyeBrowL: 0.12 } },
	browR: { dx: { headYaw: 60 }, dy: { headPitch: -60, eyeBrowR: -14 }, drot: { eyeBrowR: -0.12 } },
	pupilL: { dx: { headYaw: 60, gazeX: 8 }, dy: { headPitch: -60, gazeY: 8 } },
	pupilR: { dx: { headYaw: 60, gazeX: 8 }, dy: { headPitch: -60, gazeY: 8 } },
	mouth: {
		dx: { headYaw: 55 },
		dy: { headPitch: -55, mouthSmile: -6 },
		dscaleY: { mouthOpen: 1.4 },
		dscaleX: { mouthWide: 0.5, mouthSmile: 0.2 },
	},
	accessory: { dx: { headYaw: 50 }, dy: { headPitch: -50, bodyBob: 6 }, drot: { headRoll: 1 } },
}

/** Look up a binding by explicit override name, else by role, else identity (no motion). */
const IDENTITY: FeatureBinding = {}
export function resolveBinding(role: PuppetRole, overrideName?: string): FeatureBinding {
	if (overrideName && overrideName in DEFAULT_BINDINGS) return DEFAULT_BINDINGS[overrideName]
	return DEFAULT_BINDINGS[role] ?? IDENTITY
}
