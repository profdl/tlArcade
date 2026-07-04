/**
 * Render-seam integration test — the tldraw-native side of the suite.
 *
 * We mount a REAL tldraw <Editor> (via the <Tldraw> component's onMount, the
 * supported way to reach the editor) with the app's custom SpriteShapeUtil, then
 * drive the actual render/bridge against it. This exercises the only seam between
 * the sim and the canvas: shape creation (ensureShapes), position sync (sync),
 * paused read-back (readBackAll), and delete-pruning — end to end, on the same
 * Editor the app uses. Timers are real; we await ticks with waitFor.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, waitFor, cleanup } from '@testing-library/react'
import { createElement } from 'react'
import { Tldraw, type Editor } from 'tldraw'
import { World } from 'miniplex'
import type { Entity } from '../sim/components'
import { moveSystem } from '../sim/systems'
import { startBridge, type Bridge, type SceneSim } from './bridge'
import { SpriteShapeUtil } from './SpriteShapeUtil'

const sim: SceneSim = { ctx: { bounds: { w: 2000, h: 1400 } }, pipeline: [moveSystem] }

/** Mount a headless editor and hand it back once tldraw fires onMount. */
async function mountEditor(): Promise<Editor> {
  let editor: Editor | null = null
  render(
    createElement(Tldraw, {
      shapeUtils: [SpriteShapeUtil],
      onMount: (e: Editor) => {
        editor = e
      },
    }),
  )
  await waitFor(() => expect(editor).not.toBeNull(), { timeout: 10000 })
  return editor!
}

function walker(pos: { x: number; y: number }, target: { x: number; y: number } | null): Entity {
  return {
    kind: 'townsperson',
    position: { ...pos },
    sprite: { shape: 'townsperson' },
    mover: { speed: 16, target: target && { ...target }, arrived: false },
    whim: { kind: 'wander', target: null },
    dweller: { state: target ? 'walk' : 'idle', until: 0, bench: null },
    interactor: { state: 'none', partner: null, until: 0, cooldownUntil: 0 },
  }
}

let bridge: Bridge | null = null
beforeEach(() => {
  bridge = null
})
afterEach(() => {
  bridge?.stop()
  bridge = null
  cleanup()
})

describe('render bridge ↔ real tldraw editor', () => {
  it('creates one shape per renderable entity, centred on its position', async () => {
    const editor = await mountEditor()
    const world = new World<Entity>()
    world.add(walker({ x: 300, y: 400 }, null))
    world.add({ kind: 'bench', position: { x: 800, y: 500 } })

    bridge = startBridge(editor, world, sim) // ensureShapes runs synchronously here

    const shapes = editor.getCurrentPageShapes().filter((s) => s.type === 'sprite')
    expect(shapes).toHaveLength(2)
    const centre = editor.getShapePageBounds(shapes[0].id)!.center
    // Shapes are positioned top-left = centre − size/2, so the box centre lands
    // back on the entity position.
    const onAPosition =
      Math.hypot(centre.x - 300, centre.y - 400) < 1 ||
      Math.hypot(centre.x - 800, centre.y - 500) < 1
    expect(onAPosition).toBe(true)
  })

  it('syncs entity movement onto the shape over ticks', async () => {
    const editor = await mountEditor()
    const world = new World<Entity>()
    const p = world.add(walker({ x: 100, y: 400 }, { x: 1800, y: 400 }))
    bridge = startBridge(editor, world, sim)

    const id = editor.getCurrentPageShapes().find((s) => s.type === 'sprite')!.id
    const startX = editor.getShapePageBounds(id)!.center.x

    // moveSystem steps p toward the target each tick; wait for the shape to follow.
    await waitFor(
      () => {
        expect(p.position.x).toBeGreaterThan(150)
        expect(editor.getShapePageBounds(id)!.center.x).toBeGreaterThan(startX + 20)
      },
      { timeout: 5000 },
    )
  })

  it('prunes the entity when the player deletes its shape', async () => {
    const editor = await mountEditor()
    const world = new World<Entity>()
    world.add(walker({ x: 200, y: 300 }, null))
    bridge = startBridge(editor, world, sim)

    const id = editor.getCurrentPageShapes().find((s) => s.type === 'sprite')!.id
    expect([...world.entities]).toHaveLength(1)

    editor.run(() => editor.deleteShape(id), { history: 'ignore' })
    await waitFor(() => expect([...world.entities]).toHaveLength(0), { timeout: 5000 })
  })

  it('while paused, reads a moved shape back into its entity', async () => {
    const editor = await mountEditor()
    const world = new World<Entity>()
    const p = world.add(walker({ x: 100, y: 100 }, null))
    bridge = startBridge(editor, world, sim)
    bridge.setPaused(true)

    const id = editor.getCurrentPageShapes().find((s) => s.type === 'sprite')!.id
    // Player drags the shape: move its top-left; the paused bridge should read the
    // new centre back into the entity on the next tick.
    editor.run(() => editor.updateShape({ id, type: 'sprite', x: 900, y: 700 }), { history: 'ignore' })

    await waitFor(
      () => {
        const c = editor.getShapePageBounds(id)!.center
        expect(p.position.x).toBeCloseTo(c.x, 0)
        expect(p.position.y).toBeCloseTo(c.y, 0)
        expect(p.position.x).toBeGreaterThan(500)
      },
      { timeout: 5000 },
    )
  })

  it('stop() removes the bridge-owned shapes', async () => {
    const editor = await mountEditor()
    const world = new World<Entity>()
    world.add(walker({ x: 200, y: 300 }, null))
    const b = startBridge(editor, world, sim)
    expect(editor.getCurrentPageShapes().length).toBeGreaterThan(0)
    b.stop()
    expect(editor.getCurrentPageShapes()).toHaveLength(0)
  })
})

// Silence the expected jsdom "not implemented" measurement noise so the run
// output stays readable; real assertions above still drive the test.
vi.spyOn(console, 'warn').mockImplementation(() => {})
