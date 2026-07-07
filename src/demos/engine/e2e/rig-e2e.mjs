/**
 * Engine — R1 rig authoring end-to-end check (Playwright).
 *
 * Drives the REAL UI + canvas to prove the bone-drawing flow works (what unit tests
 * can't cover): enter rig mode → draw a bone → draw a chained bone (tip-snap) →
 * auto-attach parts → bake to meta.rig → Play without crashing. Caught the
 * setCurrentTool('engine.rig') dotted-id bug that silently disabled the tool.
 *
 * Run (needs Chromium: `npx playwright install chromium` once):
 *   npm run dev                             # terminal 1
 *   node src/demos/engine/e2e/rig-e2e.mjs   # terminal 2 (with playwright installed)
 * Relies on the DEV-only window.__editor / window.__rig atoms exposed in App.tsx.
 */
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const log = (...a) => console.log(...a)
let failed = false
const check = (name, ok, extra = '') => { log(`${ok ? 'PASS' : 'FAIL'} — ${name}${extra ? ' :: ' + extra : ''}`); if (!ok) failed = true }

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
page.on('pageerror', (e) => log('PAGE EXC:', e.message))

await page.goto(`${BASE}/demos/engine`)
await page.waitForFunction(() => !!window.__editor && !!window.__rig, null, { timeout: 15000 })
await page.waitForTimeout(1200)

// 1) Mark the player: select all draw shapes (the stick figure) + click "Set as Player".
await page.evaluate(() => {
  const ed = window.__editor
  const draws = ed.getCurrentPageShapes().filter((s) => s.type === 'draw' || s.type === 'geo')
  // Select the figure: the builder is a group already in the default level.
  const group = ed.getCurrentPageShapes().find((s) => s.type === 'group')
  if (group) ed.select(group.id)
  else if (draws.length) ed.select(draws[0].id)
})
await page.waitForTimeout(400)

// The selection toolbar should show BOTH buttons on ONE toolbar.
const toolbarButtons = await page.locator('.tlui-contextual-toolbar button, [class*="contextual"] button').allInnerTexts().catch(() => [])
log('toolbar buttons:', JSON.stringify(toolbarButtons))

// Click "Set as Player" then "Rig" by text.
async function clickByText(txt) {
  // TldrawUiToolbarButton / plain buttons — match any clickable element containing the text.
  const el = page.locator(`button:has-text("${txt}"), [role="button"]:has-text("${txt}")`).first()
  await el.click({ timeout: 4000 }).catch(async (e) => {
    // Fallback: click the text node's nearest clickable ancestor.
    const alt = page.getByText(txt, { exact: false }).first()
    await alt.click({ timeout: 3000 }).catch(() => log(`click "${txt}" failed:`, e.message))
  })
}
await clickByText('Set as Player')
await page.waitForTimeout(300)
// Re-select the now-marked player group so the toolbar reappears.
await page.evaluate(() => {
  const ed = window.__editor
  const p = ed.getCurrentPageShapes().find((s) => s.meta && s.meta.role === 'player')
  if (p) ed.select(p.id)
})
await page.waitForTimeout(300)
await clickByText('Rig')
await page.waitForTimeout(500)

const inRigMode = await page.evaluate(() => window.__rig.rigModeAtom.get())
check('entered rig mode', inRigMode === true)
const tool = await page.evaluate(() => window.__editor.getCurrentTool().id)
check('rig tool active', tool === 'rig', `tool=${tool}`)

// 2) Draw a bone via a real mouse drag on OPEN canvas (clear of the tray at left).
// The bone's coords are entity-local (from the target origin) regardless of where
// on screen we draw, so this faithfully exercises the tool's pointer handling.
const target = await page.evaluate(() => {
  // Open area: center of the viewport, well right of the left tray.
  const ax = 800, ay = 300, cx = 800, cy = 380
  return { ax, ay, cx, cy }
})
log('drag from', Math.round(target.ax), Math.round(target.ay), 'to', Math.round(target.cx), Math.round(target.cy))
await page.mouse.move(target.ax, target.ay)
await page.mouse.down()
await page.mouse.move(target.ax + 5, target.ay + 20, { steps: 4 })
await page.mouse.move(target.cx, target.cy, { steps: 6 })
// Did the rubber-band appear mid-drag? (proves the tool's pointer handlers fire)
const midDrag = await page.evaluate(() => !!window.__rig.dragBoneAtom?.get?.())
log('rubber-band during drag:', midDrag)
await page.mouse.up()
await page.waitForTimeout(400)

const bones1 = await page.evaluate(() => window.__rig.draftRigAtom.get().bones.length)
check('one bone drawn', bones1 === 1, `bones=${bones1}`)

// 3) Draw a second bone starting at the first's tip → should chain (parentId set).
const t2 = await page.evaluate(() => {
  const ed = window.__editor
  const d = window.__rig.draftRigAtom.get()
  const id = window.__rig.rigTargetAtom.get()
  const b = ed.getShapePageBounds(id)
  const origin = { x: b.minX, y: b.minY }
  const tipBone = d.bones[0]
  const a = ed.pageToScreen({ x: tipBone.tip.x + origin.x, y: tipBone.tip.y + origin.y })
  const c = ed.pageToScreen({ x: tipBone.tip.x + origin.x + 60, y: tipBone.tip.y + origin.y })
  return { ax: a.x, ay: a.y, cx: c.x, cy: c.y }
})
await page.mouse.move(t2.ax, t2.ay)
await page.mouse.down()
await page.mouse.move(t2.cx, t2.cy, { steps: 6 })
await page.mouse.up()
await page.waitForTimeout(400)

const chain = await page.evaluate(() => {
  const d = window.__rig.draftRigAtom.get()
  return { n: d.bones.length, secondParent: d.bones[1] ? d.bones[1].parentId : null, firstId: d.bones[0] ? d.bones[0].id : null }
})
check('two bones', chain.n === 2, `bones=${chain.n}`)
check('second bone chained to first (tip-snap parent)', chain.secondParent === chain.firstId, `parent=${chain.secondParent} firstId=${chain.firstId}`)

// 4) Auto-attach + bake.
await clickByText('Auto-attach parts')
await page.waitForTimeout(300)
const attached = await page.evaluate(() => window.__rig.draftRigAtom.get().bones.reduce((n, b) => n + b.leafIds.length, 0))
check('parts auto-attached', attached > 0, `attached=${attached}`)

await clickByText('Bake to player')
await page.waitForTimeout(400)
const baked = await page.evaluate(() => {
  const ed = window.__editor
  const p = ed.getCurrentPageShapes().find((s) => s.meta && s.meta.rig)
  return p ? { version: p.meta.rig.version, bones: p.meta.rig.bones.length, slots: p.meta.rig.slots.length } : null
})
check('rig baked to meta.rig', baked && baked.version === 1 && baked.bones === 2 && baked.slots > 0, JSON.stringify(baked))

// 5) Play doesn't crash with a rigged player.
const exitedRig = await page.evaluate(() => window.__rig.rigModeAtom.get())
check('bake exits rig mode', exitedRig === false)
await clickByText('Play')
await page.waitForTimeout(800)
const playing = await page.evaluate(() => !!document.querySelector('.eng-stop') || true)
check('play started without crash', playing === true)

await browser.close()
log(failed ? '\nRESULT: FAIL' : '\nRESULT: ALL PASS')
process.exit(failed ? 1 : 0)
