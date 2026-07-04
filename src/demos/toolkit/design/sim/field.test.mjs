// field.test.mjs — pure-math tests for the field engine. No editor/DOM.
// Run:  node design/sim/field.test.mjs
// These pin down the behaviours the whole design rests on, so a tuning change
// that breaks an invariant fails loudly.

import assert from 'node:assert'
import { resolveField, sampleField } from './field.mjs'

let pass = 0
const ok = (name, cond) => {
  assert.ok(cond, name)
  pass++
}

const cur = (owner, x, y, angle, strength = 1) => ({
  id: Math.round(x + y), owner, kind: 'current', x, y, angle, strength, active: true,
})
const vor = (owner, x, y, strength = 1) => ({
  id: Math.round(x + y) + 1, owner, kind: 'vortex', x, y, angle: 0, strength, active: true,
})
const heat = (owner, x, y, strength = 1) => ({
  id: Math.round(x + y) + 2, owner, kind: 'heat', x, y, angle: 0, strength, active: true,
})

// 1. a single rightward current pushes a nearby point in +x
{
  const f = resolveField([cur('A', 500, 400, 0)])
  const { fx, fy } = sampleField(f, 520, 400)
  ok('current pushes +x', fx > 0)
  ok('current barely pushes y', Math.abs(fy) < 1e-6)
}

// 2. inactive emitters contribute nothing
{
  const e = cur('A', 500, 400, 0)
  e.active = false
  const f = resolveField([e])
  const { fx } = sampleField(f, 520, 400)
  ok('inactive contributes nothing', fx === 0)
}

// 3. heat has NO push of its own
{
  const f = resolveField([heat('A', 500, 400)])
  const { fx, fy } = sampleField(f, 520, 400)
  ok('heat has no push', fx === 0 && fy === 0)
}

// 4. COMBO: a friendly vortex next to a current AMPLIFIES it (thesis!)
{
  const solo = resolveField([cur('A', 500, 400, 0)])
  const combo = resolveField([cur('A', 500, 400, 0), vor('A', 520, 420)])
  const soloCur = solo.effects.find((e) => e.kind === 'current')
  const comboCur = combo.effects.find((e) => e.kind === 'current')
  ok('friendly vortex amplifies current', comboCur.strength > soloCur.strength)
}

// 5. COUNTERPLAY: opposing head-on currents cancel (both weaker than solo)
{
  const solo = resolveField([cur('A', 600, 400, 0)])
  const clash = resolveField([cur('A', 600, 400, 0), cur('B', 620, 400, Math.PI)])
  const soloS = solo.effects[0].strength
  const aClash = clash.effects.find((e) => e.owner === 'A').strength
  ok('opposing currents cancel', aClash < soloS)
}

// 6. COUNTERPLAY: an enemy vortex scatters a current (weakens it)
{
  const solo = resolveField([cur('A', 600, 400, 0)])
  const scattered = resolveField([cur('A', 600, 400, 0), vor('B', 620, 410)])
  const soloS = solo.effects[0].strength
  const aS = scattered.effects.find((e) => e.kind === 'current').strength
  ok('enemy vortex scatters current', aS < soloS)
}

// 7. a vortex creates curl (tangential, not purely radial) flow
{
  const f = resolveField([vor('A', 500, 400, 1)])
  const { fx, fy } = sampleField(f, 560, 400) // point to the right of the vortex
  ok('vortex curls (has tangential y component)', Math.abs(fy) > 1e-6)
}

// 8. determinism: same input -> same output
{
  const a = resolveField([cur('A', 500, 400, 0), vor('A', 520, 420)])
  const b = resolveField([cur('A', 500, 400, 0), vor('A', 520, 420)])
  ok('resolveField is deterministic', JSON.stringify(a) === JSON.stringify(b))
}

console.log(`field.test.mjs — ${pass} assertions passed ✓`)
