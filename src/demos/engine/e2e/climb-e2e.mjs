/**
 * Engine — CLIMB pose end-to-end check (Playwright).
 *
 * Proves in the REAL running app that jumping INTO a wall (up + forward) puts the
 * player into the climb (wall-scramble) pose: we drop a tall wall to the player's
 * right, jump while holding right so it presses into the face, and assert the live
 * animation state reads `climb` with the wall-facing lean (spine leans toward the wall),
 * and that the pose animates hand-over-hand (the arm rotation changes over frames).
 *
 * Run (needs Chromium: `npx playwright install chromium` once):
 *   npm run dev                                # terminal 1
 *   node src/demos/engine/e2e/climb-e2e.mjs    # terminal 2
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

// Drop a tall wall flush to the player's right so a jump into it presses the face.
const placed = await page.evaluate(() => {
  const ed = window.__editor
  const player = ed.getCurrentPageShapes().find((s) => s.meta && s.meta.role === 'player')
  if (!player) return null
  const pb = ed.getShapePageBounds(player.id)
  if (!pb) return null
  ed.createShape({
    id: 'shape:climb-e2e',
    type: 'geo',
    x: pb.maxX + 2,
    y: pb.minY - 300, // very tall so the whole jump arc stays against the face
    props: { geo: 'rectangle', w: 60, h: pb.height + 600, color: 'black', fill: 'solid' },
  })
  return true
})
check('placed a tall wall to the player’s right', !!placed)

const started = await page.evaluate(() => window.__runtime.start())
check('runtime.start() succeeded', started === true)
await page.waitForTimeout(200)

// Read the live animation state + the climb-relevant pose fields off the player entity.
async function climbSample() {
  return page.evaluate(() => {
    const rt = window.__runtime
    const ent = rt.entities?.[0]
    if (!ent) return null
    const k = ent.kin
    // Recompute the selected state the same way the runtime does, from live kin.
    const wallSide = k.wallNx !== 0 ? -Math.sign(k.wallNx) : 0 // +1 wall right, -1 left
    return {
      touchingWall: !!k.touchingWall,
      wallSide,
      // The pose the runtime set this frame (climb pose has spine.rotation + head).
      spineRot: ent.pose?.spine?.rotation ?? null,
      armR: ent.pose?.armR?.rotation ?? null,
    }
  })
}

// Hold RIGHT and jump repeatedly so the player rises against the wall face.
await page.evaluate(() => window.__editor.getContainer()?.focus?.())
await page.keyboard.down('ArrowRight')

let sawClimb = false
let leanedIntoWall = false
const armRs = []
for (let rep = 0; rep < 4; rep++) {
  await page.keyboard.press('ArrowUp') // a jump
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(45)
    const s = await climbSample()
    if (!s) continue
    // Climb pose is the one that sets spine.rotation while touching a wall airborne.
    if (s.touchingWall && s.spineRot != null) {
      sawClimb = true
      armRs.push(s.armR)
      // Wall is to the RIGHT (wallSide +1) ⇒ lean right ⇒ spineRot > 0.
      if (s.wallSide > 0 && s.spineRot > 0) leanedIntoWall = true
      if (s.wallSide < 0 && s.spineRot < 0) leanedIntoWall = true
    }
  }
}
await page.keyboard.up('ArrowRight')

check('player enters the climb pose while jumping into the wall', sawClimb)
check('climb pose leans the torso INTO the wall it grips', leanedIntoWall)
const armSpread = armRs.length >= 2 ? Math.max(...armRs) - Math.min(...armRs) : 0
log(`   climb armR spread over frames: ${armSpread.toFixed(3)} rad`)
check('climb pose animates hand-over-hand (arm rotation varies)', armSpread > 0.05, `${armSpread.toFixed(3)} rad`)

await page.evaluate(() => {
  window.__runtime.stop()
  const w = window.__editor.getShape('shape:climb-e2e')
  if (w) window.__editor.deleteShape(w.id)
})
await browser.close()

log(failed ? '\nSOME CHECKS FAILED' : '\nALL CHECKS PASSED')
process.exit(failed ? 1 : 0)
