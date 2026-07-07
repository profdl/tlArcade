/**
 * Engine — WALL collision end-to-end check (Playwright).
 *
 * Proves the "auto-slide up walls" glitch is gone in the REAL running app: we drop a
 * tall wall just to the player's right, start the runtime, hold "right" so the player
 * shoves into the wall, and assert the player's page-bounds TOP never rises above where
 * it started (no upward creep) while it's stopped flat against the wall face. Then we
 * confirm a wall is still recorded on the player's kinematics (so wall-jump/climb works).
 *
 * Run (needs Chromium: `npx playwright install chromium` once):
 *   npm run dev                              # terminal 1
 *   node src/demos/engine/e2e/wall-e2e.mjs   # terminal 2
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

// Drop a tall BLACK (solid terrain) wall flush to the right of the player, its top
// well above the player's head so a mid-body sample sits on the wall's vertical face
// (the exact geometry that used to slide the player up). Positioned from the player's
// live page bounds so it works regardless of the default spawn.
const placed = await page.evaluate(() => {
  const ed = window.__editor
  const player = ed.getCurrentPageShapes().find((s) => s.meta && s.meta.role === 'player')
  if (!player) return null
  const pb = ed.getShapePageBounds(player.id)
  if (!pb) return null
  const id = ('shape:wall-e2e')
  ed.createShape({
    id,
    type: 'geo',
    x: pb.maxX + 2, // a hair to the player's right
    y: pb.minY - 120, // top 120px above the player's head → a tall wall
    props: { geo: 'rectangle', w: 60, h: pb.height + 240, color: 'black', fill: 'solid' },
  })
  return { playerTop: pb.minY, wallLeft: pb.maxX + 2 }
})
check('placed a tall wall to the player’s right', !!placed, JSON.stringify(placed))

// Start the runtime and read the player's page-bounds TOP over time.
const started = await page.evaluate(() => window.__runtime.start())
check('runtime.start() succeeded', started === true)
await page.waitForTimeout(200)

async function playerState() {
  return page.evaluate(() => {
    const rt = window.__runtime
    const ed = window.__editor
    const ent = rt.entities?.[0]
    if (!ent) return null
    const pb = ed.getShapePageBounds(ent.id)
    return {
      top: pb ? pb.y : null,
      touchingWall: !!ent.kin.touchingWall,
    }
  })
}

const start = await playerState()
log(`   player top at start: ${start?.top?.toFixed(1)}`)

// Hold RIGHT — shove into the wall for ~1.5s worth of frames.
await page.evaluate(() => window.__editor.getContainer()?.focus?.())
await page.keyboard.down('ArrowRight')

let minTop = start?.top ?? Infinity
let sawWall = false
for (let i = 0; i < 16; i++) {
  await page.waitForTimeout(90)
  const s = await playerState()
  if (s?.top != null && s.top < minTop) minTop = s.top
  if (s?.touchingWall) sawWall = true
}
await page.keyboard.up('ArrowRight')

const rose = (start?.top ?? 0) - minTop // positive = climbed upward (smaller y)
log(`   min player top while shoving: ${minTop.toFixed(1)}  (rose ${rose.toFixed(1)}px)`)
// Allow a few px of settle jitter, but nothing like the old ~90px climb.
check('player does NOT slide up the wall (no upward creep)', rose < 8, `rose ${rose.toFixed(1)}px`)
check('player records a wall contact (wall-jump/climb still works)', sawWall)

await page.evaluate(() => {
  window.__runtime.stop()
  const ed = window.__editor
  const w = ed.getShape('shape:wall-e2e')
  if (w) ed.deleteShape(w.id)
})
await browser.close()

log(failed ? '\nSOME CHECKS FAILED' : '\nALL CHECKS PASSED')
process.exit(failed ? 1 : 0)
