/**
 * Engine — default-builder WALK end-to-end check (Playwright, R2).
 *
 * Proves the thing unit tests can't: the DEFAULT builder player (auto-loaded with a
 * baked meta.rig via builderRig) actually ANIMATES its limbs when it moves. We start
 * the real runtime, hold "right" so the player walks, and assert the arm/leg leaf
 * shapes visibly change their entity-local offset over time (the walk swing) — then
 * that standing still returns them to rest. Guards the walk.ts → engine.ts pose wiring
 * end-to-end, not just poseForState in isolation.
 *
 * Run (needs Chromium: `npx playwright install chromium` once):
 *   npm run dev                              # terminal 1
 *   node src/demos/engine/e2e/walk-e2e.mjs   # terminal 2
 * Relies on DEV-only window.__editor / window.__runtime exposed in App.tsx.
 */
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const log = (...a) => console.log(...a)
let failed = false
const check = (name, ok, extra = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} — ${name}${extra ? ' :: ' + extra : ''}`)
  if (!ok) failed = true
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
page.on('pageerror', (e) => log('PAGE EXC:', e.message))

await page.goto(`${BASE}/demos/engine`)
await page.waitForFunction(() => !!window.__editor && !!window.__runtime, null, { timeout: 15000 })
await page.waitForTimeout(1200)

// 0) Sanity: the default player group carries a baked rig with the 4 limb bones.
const rigInfo = await page.evaluate(() => {
  const ed = window.__editor
  const p = ed.getCurrentPageShapes().find((s) => s.meta && s.meta.rig)
  if (!p) return null
  const r = p.meta.rig
  return { bones: r.bones.map((b) => b.id), slots: r.slots.length }
})
check(
  'default builder has a baked rig with arm + two-bone leg chains',
  !!rigInfo && ['armL', 'armR', 'thighL', 'shinL', 'thighR', 'shinR'].every((b) => rigInfo.bones.includes(b)),
  JSON.stringify(rigInfo),
)

// Helper: the entity-local offsets of the four limb leaf shapes, relative to the
// player group's current page origin. Reads live shape records → page bounds.
async function limbOffsets() {
  return page.evaluate(() => {
    const ed = window.__editor
    const rt = window.__runtime
    // entities[0] is the player; its parts carry the leaf ids the rig drives.
    const ent = rt.entities?.[0]
    if (!ent) return null
    const rig = ent.rig
    if (!rig) return null
    // Map bone → leaf id via the rig's slots/skins (rigid attachments).
    const skin = rig.skins.default
    const boneOfLeaf = {}
    for (const slot of rig.slots) {
      const att = skin[slot.attachment]
      if (att && att.kind === 'rigid') boneOfLeaf[slot.boneId] = att.leafId
    }
    const out = {}
    // legL/legR now map to the THIGH leaf of each leg chain (the swinging segment).
    const boneFor = { armL: 'armL', armR: 'armR', legL: 'thighL', legR: 'thighR' }
    for (const [key, bone] of Object.entries(boneFor)) {
      const leafId = boneOfLeaf[bone]
      const b = leafId ? ed.getShapePageBounds(leafId) : null
      out[key] = b ? { x: b.x, y: b.y } : null
    }
    return out
  })
}

// 1) Start the runtime (headless can't rely on the audio-gated Play click). Use
// STRAIGHT-leg mode for the thigh-swing baseline below (IK keeps the thigh more
// upright as it plants the foot, so its thigh y-spread is smaller — the knee-bend
// check in step 4 covers IK instead).
await page.evaluate(() => window.__legMode?.set('straight'))
const started = await page.evaluate(() => window.__runtime.start())
check('runtime.start() succeeded (player present)', started === true)
await page.waitForTimeout(200)

// 2) Hold RIGHT so the player walks; sample the limb offsets across several frames.
await page.evaluate(() => window.__editor.getContainer()?.focus?.())
await page.keyboard.down('ArrowRight')

const samples = []
const thighDeltas = []
for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(90)
  const o = await limbOffsets()
  if (o) samples.push(o)
  // The thigh's live pose ROTATION delta — the unambiguous swing signal, robust to
  // leaf shape type (a thin draw line's bounding box is a poor swing proxy).
  const d = await page.evaluate(() => window.__runtime.entities?.[0]?.pose?.thighL?.rotation ?? null)
  if (d != null) thighDeltas.push(d)
}
await page.keyboard.up('ArrowRight')

// The player's page origin moves as it walks, so compare each limb offset RELATIVE
// to the legR leaf (a shared reference) to cancel the whole-body translation and
// isolate the rig swing. If the rig animates, the arm-vs-leg relative offset varies.
function relSpread(samples, a, b) {
  const dys = samples
    .filter((s) => s[a] && s[b])
    .map((s) => s[a].y - s[b].y)
  if (dys.length < 2) return 0
  return Math.max(...dys) - Math.min(...dys)
}

const thighSwing = thighDeltas.length ? Math.max(...thighDeltas) - Math.min(...thighDeltas) : 0
const armSpread = relSpread(samples, 'armL', 'armR')
log(`   thighL swing over walk: ${thighSwing.toFixed(2)} rad  |  armL-armR y-spread: ${armSpread.toFixed(2)}px`)
check('legs swing while walking (thigh rotation varies)', thighSwing > 0.2, `${thighSwing.toFixed(2)} rad`)
// Arms hang at the sides now and swing SUBTLY (by design — armSwing < leg swing), so
// a smaller threshold than the legs. Still must visibly move.
check('arms swing subtly while walking (relative offset varies)', armSpread > 1.5, `${armSpread.toFixed(2)}px`)

// 3) Stand still → the pose returns to rest → limbs stop varying (steady).
await page.waitForTimeout(400)
const rest = []
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(90)
  const o = await limbOffsets()
  if (o) rest.push(o)
}
const legRest = relSpread(rest, 'legL', 'legR')
log(`   legL-legR y-spread at rest: ${legRest.toFixed(2)}px`)
check('limbs settle to rest when standing still (little/no variation)', legRest < 2, `${legRest.toFixed(2)}px`)

// 4) Phase B: in IK mode the KNEE bends while walking — the shin's pose rotation delta
// varies over the stride (a straight leg would keep it ~0). Read the live pose the
// runtime applies, so this proves the IK path end-to-end (planner → solver → pose).
await page.evaluate(() => window.__legMode?.set('ik'))
await page.evaluate(() => window.__runtime.start())
await page.waitForTimeout(200)
await page.evaluate(() => window.__editor.getContainer()?.focus?.())
await page.keyboard.down('ArrowRight')
const shinDeltas = []
for (let i = 0; i < 14; i++) {
  await page.waitForTimeout(45)
  const d = await page.evaluate(() => window.__runtime.entities?.[0]?.pose?.shinL?.rotation ?? null)
  if (d != null) shinDeltas.push(d)
}
await page.keyboard.up('ArrowRight')
const kneeRange = shinDeltas.length ? Math.max(...shinDeltas) - Math.min(...shinDeltas) : 0
log(`   IK shinL knee-bend delta range over walk: ${kneeRange.toFixed(2)} rad`)
check('IK legs BEND the knee while walking (shin delta varies)', kneeRange > 0.2, `${kneeRange.toFixed(2)} rad`)

await page.evaluate(() => window.__runtime.stop())
await browser.close()

log(failed ? '\nSOME CHECKS FAILED' : '\nALL CHECKS PASSED')
process.exit(failed ? 1 : 0)
