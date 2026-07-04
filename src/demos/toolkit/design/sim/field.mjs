// field.mjs — THE CORE. Pure field math, no editor / no DOM / no WebGL.
// This is the exact code that will later drive BOTH the shader uniforms and the
// creature steering in the real game. If it's balanced/fun here, it transfers.
//
// Two pure functions:
//   resolveField(emitters)        -> FieldState   (the "dependency graph" resolve)
//   sampleField(state, x, y)      -> { fx, fy }   (local flow vector at a point)
//
// The design thesis (see design/DESIGN.md):
//  - Emitters are SOURCE NODES. Proximity between them = the invisible "wiring".
//  - resolveField is the graph execution: it COMBINES emitters, applying combo
//    rules so that placing emitters near each other builds a "machine" that is
//    more energy-efficient than stacking raw currents. THAT is the skill ceiling.
//  - Opposing-owner currents CANCEL where they meet  -> counterplay.
//  - A vortex SCATTERS nearby enemy current           -> beats brute force.
//  - Heat BENDS a passing current (cheap support, no push of its own).

import { TUNING as T } from './tuning.mjs'

// ----- emitter kinds -----------------------------------------------------------
// kind: 'current' | 'heat' | 'vortex'
// An emitter:  { id, owner:'A'|'B', kind, x, y, angle, strength, active }

// ----- resolveField: the graph execution -------------------------------------
// Returns a FieldState: a resolved list of "effects" the sampler reads, plus a
// couple of scalar summaries the shader would use as global uniforms.
export function resolveField(emitters) {
  const live = emitters.filter((e) => e.active)

  // 1. Start each emitter as a base effect.
  const effects = live.map((e) => ({
    owner: e.owner,
    kind: e.kind,
    x: e.x,
    y: e.y,
    angle: e.angle,
    // effective strength after combos (mutated below)
    strength: e.strength * baseStrengthForKind(e.kind),
    radius: T.radius[e.kind],
    curl: e.kind === 'vortex' ? e.strength * T.vortexCurl : 0,
  }))

  // 2. COMBO PASS — the dependency-graph "wiring". For each pair of nearby
  //    emitters, apply interaction rules. This is what makes combos beat stacks.
  for (let i = 0; i < effects.length; i++) {
    for (let j = 0; j < effects.length; j++) {
      if (i === j) continue
      const a = effects[i]
      const b = effects[j]
      const d = dist(a.x, a.y, b.x, b.y)
      if (d > T.comboRange) continue
      const prox = 1 - d / T.comboRange // 1 at touching, 0 at edge of range

      if (a.owner === b.owner) {
        // --- same-owner synergies (build a machine) ---
        // vortex WIDENS an adjacent friendly current (coverage, not just power):
        // a whirlpool spreads the current's influence over a larger area. This is
        // what lets a concentrated "machine" compete with currents spread across
        // lanes — it gets REACH instead of merely pushing harder in one spot.
        if (a.kind === 'vortex' && b.kind === 'current') {
          b.radius += b.radius * T.combo.vortexWidenCurrent * prox
          b.strength += b.strength * T.combo.vortexAmpCurrent * prox
        }
        // heat BENDS a friendly current toward the heat (cheap steering)
        if (a.kind === 'heat' && b.kind === 'current') {
          b.angle = bendAngle(b.angle, Math.atan2(a.y - b.y, a.x - b.x), T.combo.heatBend * prox)
        }
        // two friendly currents that roughly agree MERGE into a stronger stream
        if (a.kind === 'current' && b.kind === 'current') {
          const agree = Math.cos(a.angle - b.angle) // 1 = same dir, -1 = opposed
          if (agree > T.combo.mergeAgreeThreshold) {
            b.strength += b.strength * T.combo.currentMerge * prox * agree
          }
        }
      } else {
        // --- cross-owner counterplay ---
        // opposing currents CANCEL where they overlap
        if (a.kind === 'current' && b.kind === 'current') {
          const oppose = -Math.cos(a.angle - b.angle) // 1 = head-on
          if (oppose > 0) {
            b.strength -= b.strength * T.combo.currentCancel * prox * oppose
          }
        }
        // a vortex SCATTERS an enemy current (beats brute force, not by out-pushing)
        if (a.kind === 'vortex' && b.kind === 'current') {
          b.strength -= b.strength * T.combo.vortexScatter * prox
        }
      }
    }
  }

  // clamp strengths to >= 0
  for (const e of effects) e.strength = Math.max(0, e.strength)

  // 3. Scalar summaries (the shader would use these as global uniforms).
  let sumX = 0
  let sumY = 0
  let turbulence = 0
  for (const e of effects) {
    if (e.kind === 'current') {
      sumX += Math.cos(e.angle) * e.strength
      sumY += Math.sin(e.angle) * e.strength
    }
    if (e.kind === 'vortex') turbulence += e.strength
  }
  const globalFlowAngle = Math.atan2(sumY, sumX)
  turbulence = Math.min(1, turbulence / T.turbulenceNorm)

  return { effects, globalFlowAngle, turbulence }
}

// ----- sampleField: local flow vector at a page point -------------------------
// Pure. The shader visualizes this; creatures steer by it. SAME math both sides.
export function sampleField(state, x, y) {
  let fx = 0
  let fy = 0
  for (const e of state.effects) {
    const dx = x - e.x
    const dy = y - e.y
    const d2 = dx * dx + dy * dy
    const r2 = e.radius * e.radius
    if (d2 > r2) continue
    // falloff: 1 at center -> 0 at radius (smooth)
    const falloff = 1 - Math.sqrt(d2) / e.radius
    const w = e.strength * falloff * falloff

    if (e.kind === 'current') {
      fx += Math.cos(e.angle) * w
      fy += Math.sin(e.angle) * w
    } else if (e.kind === 'vortex') {
      // tangential (curl) component: rotate the radial vector 90 degrees
      const len = Math.sqrt(d2) || 1
      const tx = -dy / len
      const ty = dx / len
      fx += tx * e.curl * falloff
      fy += ty * e.curl * falloff
    } else if (e.kind === 'heat') {
      // heat has NO push of its own (it only bent currents during resolve).
      // (left intentionally empty — heat is support, not a win-con)
    }
  }
  return { fx, fy }
}

// ----- helpers ----------------------------------------------------------------
function baseStrengthForKind(kind) {
  return T.baseStrength[kind]
}
function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by)
}
function bendAngle(angle, toward, amount) {
  // rotate `angle` toward `toward` by fraction `amount` (shortest way)
  let diff = toward - angle
  while (diff > Math.PI) diff -= 2 * Math.PI
  while (diff < -Math.PI) diff += 2 * Math.PI
  return angle + diff * amount
}
