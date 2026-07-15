/**
 * rig-play — WASD-drive end-to-end check (Playwright).
 *
 * Proves the whole demo works in the real app: the auto-loaded builder figure carries a
 * baked meta.rig; starting the runtime + holding D makes it (1) TRANSLATE right and (2)
 * SWING its legs (the walk cycle); standing still SETTLES the pose; pressing E fires a
 * one-shot WAVE (the right arm's pose rotation moves); pressing W JUMPS (leaves the
 * ground). Guards the runtime.ts ↔ walk.ts ↔ evaluate.ts wiring end-to-end.
 *
 * Run (needs Chromium: `npx playwright install chromium` once):
 *   npm run dev                                       # terminal 1
 *   node src/demos/rig-play/e2e/rig-play-e2e.mjs      # terminal 2
 * Relies on DEV-only window.__editor / window.__rigplay exposed in App.tsx.
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

await page.goto(`${BASE}/demos/rig-play`)
await page.waitForFunction(() => !!window.__editor && !!window.__rigplay, null, { timeout: 15000 })
await page.waitForTimeout(1200)

// 0) The default figure carries a baked rig with the arm + two-bone leg chains.
const rigInfo = await page.evaluate(() => {
  const ed = window.__editor
  const p = ed.getCurrentPageShapes().find((s) => s.meta && s.meta.rig)
  if (!p) return null
  return { bones: p.meta.rig.bones.map((b) => b.id) }
})
check(
  'default figure has a baked rig (arm + two-bone leg chains)',
  !!rigInfo && ['armL', 'armR', 'thighL', 'shinL', 'thighR', 'shinR'].every((b) => rigInfo.bones.includes(b)),
  JSON.stringify(rigInfo),
)

// 1) Start the runtime (IK legs so the knee-bend check works).
await page.evaluate(() => window.__rigplay.playingAtom)
const started = await page.evaluate(() => window.__rigplay.runtime()?.start() === true)
check('runtime.start() succeeded (figure present)', started)
await page.waitForTimeout(150)

const dbg = () => page.evaluate(() => window.__rigplay.runtime()?.debugState() ?? null)

// 2) Hold D: the body should TRANSLATE right and the thigh pose should SWING.
await page.evaluate(() => window.__editor.getContainer()?.focus?.())
const before = await dbg()
await page.keyboard.down('d')
const thighDeltas = []
const shinDeltas = []
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(50)
  const d = await dbg()
  if (d?.pose?.thighL?.rotation != null) thighDeltas.push(d.pose.thighL.rotation)
  if (d?.pose?.shinL?.rotation != null) shinDeltas.push(d.pose.shinL.rotation)
}
const after = await dbg()
await page.keyboard.up('d')

const moved = (after?.x ?? 0) - (before?.x ?? 0)
check('body translates right while holding D', moved > 40, `${moved.toFixed(0)}px`)
const thighSwing = thighDeltas.length ? Math.max(...thighDeltas) - Math.min(...thighDeltas) : 0
check('legs swing while walking (thigh rotation varies)', thighSwing > 0.2, `${thighSwing.toFixed(2)} rad`)
const kneeRange = shinDeltas.length ? Math.max(...shinDeltas) - Math.min(...shinDeltas) : 0
check('IK knee bends while walking (shin delta varies)', kneeRange > 0.15, `${kneeRange.toFixed(2)} rad`)

// 3) Stand still → the walk pose stops varying (settles toward idle).
await page.waitForTimeout(500)
const restDeltas = []
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(60)
  const d = await dbg()
  if (d?.pose?.thighL?.rotation != null) restDeltas.push(d.pose.thighL.rotation)
}
const restSwing = restDeltas.length ? Math.max(...restDeltas) - Math.min(...restDeltas) : 0
check('limbs settle when standing still', restSwing < 0.1, `${restSwing.toFixed(3)} rad`)

// 4) Wave (E): the right-arm pose rotation should move over the one-shot.
const armRs = []
await page.keyboard.press('e')
for (let i = 0; i < 16; i++) {
  await page.waitForTimeout(45)
  const d = await dbg()
  if (d?.pose?.armR?.rotation != null) armRs.push(d.pose.armR.rotation)
}
const waveRange = armRs.length ? Math.max(...armRs) - Math.min(...armRs) : 0
check('E fires a wave (right arm sweeps)', waveRange > 0.5, `${waveRange.toFixed(2)} rad`)

// 5) Jump (W): the body should leave the ground (grounded → false at the apex).
let leftGround = false
await page.keyboard.down('w')
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(40)
  const d = await dbg()
  if (d && d.grounded === false) leftGround = true
}
await page.keyboard.up('w')
check('W jumps (body leaves the ground)', leftGround)

await page.evaluate(() => window.__rigplay.runtime()?.stop())
await browser.close()

log(failed ? '\nSOME CHECKS FAILED' : '\nALL CHECKS PASSED')
process.exit(failed ? 1 : 0)
