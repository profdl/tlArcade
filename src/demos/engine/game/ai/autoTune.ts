/**
 * Engine — autoTune: prompt → physics feel (the G5 converter, PLAN §G5).
 *
 * The cheapest converter: no perception, no canvas mutation of shapes — just a
 * prompt ("floaty like Celeste with a big jump") → a partial set of PhysicsTunables
 * that gets MERGED onto the live `tunablesAtom`. The runtime reads that atom every
 * substep (see engine.ts / PhysicsPanel.tsx), so the new feel is felt on the very
 * next jump, and the user then fine-tunes it with the same live sliders — the
 * manual editor IS the safety net (see the engine-data-converter skill).
 *
 * It authors data, not behavior: the model returns a JSON patch validated against
 * TunablesPatchSchema (only known knobs, numbers only), and applyTunables merges it
 * over the current values. A partial patch is fine — the model changes only the
 * knobs the prompt implies.
 */
import { generate, type GenerateOptions } from './client'
import { TunablesPatchSchema, type TunablesPatch } from './schemas'
import { PHYSICS_DEFAULTS, TUNABLE_GROUPS, type PhysicsTunables } from '../physics'
import { tunablesAtom } from '../state'

/** A human-readable catalogue of every knob (name, current default, range) so the
 *  model authors values in the right units and magnitude. Built from the same
 *  TUNABLE_GROUPS the live panel uses, so it can never drift from the real knobs. */
function knobCatalogue(): string {
  const lines: string[] = []
  for (const group of TUNABLE_GROUPS) {
    lines.push(`${group.title}:`)
    for (const spec of group.specs) {
      const def = PHYSICS_DEFAULTS[spec.key]
      lines.push(
        `  - ${spec.key} (${spec.label}): default ${def}, range ${spec.min}..${spec.max}`,
      )
    }
  }
  return lines.join('\n')
}

const SYSTEM =
  'You tune the "game feel" of a 2D platformer. You output ONLY a JSON object whose ' +
  'keys are a SUBSET of the tunable names below and whose values are numbers within ' +
  "the stated ranges. Change only the knobs the request implies; omit the rest. No " +
  'prose, no markdown fences.'

/**
 * Ask Claude for a feel patch from a natural-language description. Returns a
 * partial PhysicsTunables (only the knobs it chose to change). Does NOT touch the
 * atom — call applyTunables to make it live (so callers can preview/inspect first).
 */
export async function generateTunables(
  prompt: string,
  opts?: Partial<Pick<GenerateOptions<TunablesPatch>, 'signal' | 'model'>>,
): Promise<TunablesPatch> {
  const instruction =
    `Tune the platformer feel for this request:\n"${prompt}"\n\n` +
    `Available tunables (name, default, range):\n${knobCatalogue()}\n\n` +
    `Reply with ONLY a JSON object of the knobs to change, e.g. {"gravity": 1800, "jumpSpeed": 950}.`

  return generate({
    schema: TunablesPatchSchema,
    prompt: instruction,
    system: SYSTEM,
    signal: opts?.signal,
    model: opts?.model,
  })
}

/**
 * Merge a feel patch onto the live tunables atom (clamped to each knob's panel
 * range so a stray value can't break the sim). The runtime picks it up next
 * substep; the live panel reflects it immediately.
 */
export function applyTunables(patch: TunablesPatch): PhysicsTunables {
  const next = { ...tunablesAtom.get() }
  for (const [key, value] of Object.entries(patch)) {
    if (value == null) continue
    next[key as keyof PhysicsTunables] = clampKnob(key as keyof PhysicsTunables, value)
  }
  tunablesAtom.set(next)
  return next
}

/** Clamp a knob to its panel [min,max] if it has one; else pass through. */
function clampKnob(key: keyof PhysicsTunables, value: number): number {
  for (const group of TUNABLE_GROUPS) {
    for (const spec of group.specs) {
      if (spec.key === key) return Math.min(Math.max(value, spec.min), spec.max)
    }
  }
  return value
}

/** Convenience: generate + apply in one call. Returns the merged tunables. */
export async function autoTune(
  prompt: string,
  opts?: Partial<Pick<GenerateOptions<TunablesPatch>, 'signal' | 'model'>>,
): Promise<PhysicsTunables> {
  const patch = await generateTunables(prompt, opts)
  return applyTunables(patch)
}
