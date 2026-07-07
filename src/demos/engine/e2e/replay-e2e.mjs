/**
 * Engine — replay rig-alignment end-to-end check (Playwright).
 *
 * Reproduces the reported glitch: after a play session where the player POSED (walked/
 * jumped/won mid-motion), hitting Play again broke the bones. Root cause: during play
 * writeRigPart overwrites each leaf's record ROTATION (restRotation + rig delta); stop()
 * restored x/y/opacity but NOT rotation, so the next start() read the last POSED rotation
 * as the new rest (`restRotation = pageTransform.rotation()`) and re-applied the rig delta
 * on top → the rig misaligned to the character (limbs double-rotated / flew off).
 *
 * This drives the player into a WALK (limbs rotate), stops mid-pose, and asserts every
 * leaf is back at its authored rotation after stop — the exact precondition the next
 * start() needs to bake a rig aligned to the character's rest art.
 *
 * Run (needs Chromium):
 *   npm run dev                                # terminal 1
 *   node src/demos/engine/e2e/replay-e2e.mjs   # terminal 2
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

// The authored rotation of every non-group leaf under the player group.
async function leafRotations() {
  return page.evaluate(() => {
    const ed = window.__editor
    const player = ed.getCurrentPageShapes().find((s) => s.meta && s.meta.role === 'player')
    if (!player) return null
    const ids = ed.getShapeAndDescendantIds([player.id])
    const out = {}
    for (const id of ids) {
      const s = ed.getShape(id)
      if (s && s.type !== 'group') out[id] = s.rotation
    }
    return out
  })
}
const maxDrift = (a, b) => {
  let m = 0
  for (const id of Object.keys(a)) {
    if (b?.[id] == null) continue
    const d = Math.abs(((b[id] - a[id] + Math.PI) % (2 * Math.PI)) - Math.PI)
    if (d > m) m = d
  }
  return m
}

const authored = await leafRotations()
check('found player leaves', !!authored && Object.keys(authored).length > 0, `${Object.keys(authored ?? {}).length} leaves`)

// PLAY and hold RIGHT so the player walks — the walk state rotates the limb leaves.
await page.evaluate(() => window.__runtime.start())
await page.evaluate(() => window.__editor.getContainer()?.focus?.())
await page.keyboard.down('ArrowRight')
await page.waitForTimeout(500) // walk for half a second → limbs mid-swing
// Confirm the leaves ARE posed now (rotated away from rest) — proves the precondition.
const posed = await leafRotations()
const posedDrift = maxDrift(authored, posed)
log(`   max leaf rotation while walking: ${posedDrift.toFixed(4)} rad`)
check('leaves are posed (rotated) during the walk', posedDrift > 0.02, `${posedDrift.toFixed(4)} rad`)
await page.keyboard.up('ArrowRight')

// STOP (like ending a play session). This must return leaves to authored rotation.
await page.evaluate(() => window.__runtime.stop())
await page.waitForTimeout(100)
const afterStop = await leafRotations()
const stopDrift = maxDrift(authored, afterStop)
log(`   max leaf rotation drift after stop: ${stopDrift.toFixed(4)} rad`)
check('leaves return to authored rotation after stop (rig can re-bake aligned)', stopDrift < 0.01, `${stopDrift.toFixed(4)} rad`)

// Now REPLAY (Play again) and stop again — after a full stop→start→stop the leaves
// must STILL land at authored rest, proving no cumulative drift across replays.
await page.evaluate(() => { window.__runtime.start() })
await page.waitForTimeout(80)
await page.evaluate(() => window.__runtime.stop())
await page.waitForTimeout(100)
const afterReplay = await leafRotations()
const replayDrift = maxDrift(authored, afterReplay)
log(`   max leaf rotation drift after replay: ${replayDrift.toFixed(4)} rad`)
check('no cumulative drift across a stop→start→stop replay (bones stay aligned)', replayDrift < 0.01, `${replayDrift.toFixed(4)} rad`)

await browser.close()
log(failed ? '\nSOME CHECKS FAILED' : '\nALL CHECKS PASSED')
process.exit(failed ? 1 : 0)
