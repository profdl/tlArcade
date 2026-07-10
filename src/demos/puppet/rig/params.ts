import type { FaceFrame } from '../tracking/faceTracker'

/**
 * The puppet's control surface: a flat bag of named parameters, each normalized
 * to a documented range. This is the single source of truth the art layer reads
 * from — every input (webcam tracking, pointer, keyboard, sliders, idle motion)
 * writes into a PuppetParams, and the renderer never talks to a tracker directly.
 *
 * Modeled on VTube Studio's parameter list. Values are smoothed before display.
 */
export type PuppetParams = {
	// Head pose (radians for angles).
	headPitch: number // look up (+) / down (-)
	headYaw: number // turn viewer-left (+) / right (-)
	headRoll: number // tilt
	// Body follows the head with lag; drives lean + bob.
	bodyLean: number // -1..1
	bodyBob: number // 0..1 breathing/idle offset
	// Eyes.
	eyeOpenL: number // 0 closed .. 1 open
	eyeOpenR: number
	eyeBrowL: number // -1 furrowed .. 1 raised
	eyeBrowR: number
	gazeX: number // -1..1 pupil offset
	gazeY: number // -1..1
	// Mouth.
	mouthOpen: number // 0..1 jaw open (lipsync amplitude)
	mouthSmile: number // -1 frown .. 1 smile
	mouthWide: number // 0..1 corner spread (vowel shape)
	// Cheeks / misc.
	cheekPuff: number // 0..1
	// Expression override: named preset blended on top (0..1 weight per preset).
	expression: string | null
}

export const NEUTRAL_PARAMS: PuppetParams = {
	headPitch: 0,
	headYaw: 0,
	headRoll: 0,
	bodyLean: 0,
	bodyBob: 0,
	eyeOpenL: 1,
	eyeOpenR: 1,
	eyeBrowL: 0,
	eyeBrowR: 0,
	gazeX: 0,
	gazeY: 0,
	mouthOpen: 0,
	mouthSmile: 0,
	mouthWide: 0,
	cheekPuff: 0,
	expression: null,
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Map a raw webcam FaceFrame into puppet params. Missing signals leave the field at neutral. */
export function paramsFromFace(frame: FaceFrame): Partial<PuppetParams> {
	if (!frame.found || !frame.pose) return {}
	const b = frame.blendshapes
	const bs = (k: string) => b[k] ?? 0
	return {
		headPitch: frame.pose.pitch,
		headYaw: frame.pose.yaw,
		headRoll: frame.pose.roll,
		// ARKit blink shapes are "how closed"; invert to "how open".
		eyeOpenL: clamp(1 - bs('eyeBlinkLeft'), 0, 1),
		eyeOpenR: clamp(1 - bs('eyeBlinkRight'), 0, 1),
		eyeBrowL: bs('browOuterUpLeft') - bs('browDownLeft'),
		eyeBrowR: bs('browOuterUpRight') - bs('browDownRight'),
		gazeX: bs('eyeLookOutLeft') - bs('eyeLookInLeft'),
		gazeY: bs('eyeLookUpLeft') - bs('eyeLookDownLeft'),
		mouthOpen: clamp(bs('jawOpen'), 0, 1),
		mouthSmile: (bs('mouthSmileLeft') + bs('mouthSmileRight')) / 2 - (bs('mouthFrownLeft') + bs('mouthFrownRight')) / 2,
		mouthWide: clamp((bs('mouthStretchLeft') + bs('mouthStretchRight')) / 2, 0, 1),
		cheekPuff: clamp(bs('cheekPuff'), 0, 1),
	}
}

/**
 * Exponential smoothing toward a target, per-field. `alpha` is the blend weight
 * for the new value (0 = frozen, 1 = instant). Keeps the puppet from jittering
 * on noisy per-frame tracking.
 */
export function smoothParams(current: PuppetParams, target: Partial<PuppetParams>, alpha: number): PuppetParams {
	const out = { ...current }
	for (const key of Object.keys(target) as (keyof PuppetParams)[]) {
		const t = target[key]
		if (typeof t === 'number' && typeof out[key] === 'number') {
			;(out[key] as number) = (out[key] as number) * (1 - alpha) + t * alpha
		} else if (t !== undefined) {
			;(out[key] as PuppetParams[typeof key]) = t as PuppetParams[typeof key]
		}
	}
	return out
}
