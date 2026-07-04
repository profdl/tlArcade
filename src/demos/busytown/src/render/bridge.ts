/**
 * Busytown — render bridge (sim → tldraw)
 * ----------------------------------------
 * The only seam between the sim and the canvas. Every TICK_MS it advances the
 * sim one tick, then diffs entity positions onto tldraw shapes. All canvas
 * writes go through `editor.run(..., { history: 'ignore' })` so the simulation
 * never pollutes the undo stack.
 *
 * Every element is fully transformable (drag / resize / rotate) and deletable.
 * While the sim is RUNNING, transforming a shape lets its live bounds win for
 * that frame (centre read back into the entity) so behaviour resumes from the
 * new spot/size. While PAUSED, the sim is frozen and the bridge only reads
 * shapes back — so the player can rearrange the whole town and press play to
 * continue from the new layout. Deleting a shape removes its entity from the
 * sim (releasing any bench seat it held).
 *
 * Entities created live by dropEntity() are picked up on the next tick by
 * ensureShapes() — that's the "comes alive" hook from the canvas side.
 */
import type {
  Editor,
  TLShapeId,
  TLShapePartial,
  TLCreateShapePartial,
  TLGeoShape,
} from 'tldraw'
import { createShapeId } from 'tldraw'
import type { World } from 'miniplex'
import type { Entity } from '../sim/components'
import { TICK_MS } from '../sim/config'
import { runScene, type InteractionTally, type SimContext, type SystemFn } from '../sim/systems'
import { CHARACTERS } from '../content/characters'
import type { SpriteShape } from './SpriteShapeUtil'
import { KIND_SIZE, SKIN_SIZE, DEFAULT_SKIN, SKIN_CARRY_OFFSET } from './doodles'

/** Default sprite size per kind × skin (sim positions are treated as sprite
 *  centers). Single source of truth lives in the character registry (via
 *  doodles.ts). */
const sizeOf = (kind: string, skin: string) => SKIN_SIZE[kind]?.[skin] ?? KIND_SIZE[kind] ?? 40

/** Starting tldraw colour per sprite kind, from the character registry (the
 *  player can restyle afterwards). */
const colorOf = (kind: string) => CHARACTERS[kind]?.color ?? 'black'

/** The thought-bubble line for an entity's current state, delegated to its
 *  CharacterDef.thought(). '' ⇒ no bubble (props, idle, birds, van). */
function thoughtFor(e: Entity): string {
  return CHARACTERS[e.kind]?.thought?.(e) ?? ''
}

/** Whether a vehicle is currently hauling cargo — true only for the truck while
 *  it drives a load OUT to a drop ('haul'); false at the factory, dumping, and
 *  on the empty drive home. Drives the truck sprite's bricks-in-the-bed prop. */
function loadedFor(e: Entity): boolean {
  return e.deliver?.state === 'haul'
}

/** The active scene's sim wiring: bounds (SimContext) + the ordered pipeline. */
export type SceneSim = { ctx: SimContext; pipeline: SystemFn[] }

export type Bridge = {
  stop: () => void
  /** Freeze/resume the sim. While frozen the player can rearrange every shape. */
  setPaused: (paused: boolean) => void
  /** Switch which skin a kind renders as (see content/characters/types.ts →
   *  Skin) — applies to every entity of that kind already on the canvas AND
   *  every one dropped/spawned afterward. */
  setSkin: (kind: string, skin: string) => void
}

export function startBridge(
  editor: Editor,
  world: World<Entity>,
  sim: SceneSim,
  onTally?: (tally: InteractionTally) => void,
): Bridge {
  const ids = new Map<Entity, TLShapeId>()
  const lastThought = new Map<Entity, string>() // diff so we only write on change
  const lastCarry = new Map<Entity, boolean>() // ditto for the carrying-pose prop
  const lastLoaded = new Map<Entity, boolean>() // ditto for the truck's bed-load prop
  // The active skin per kind (see setSkin) — new shapes pick it up on create;
  // switching it also live-reskins every shape of that kind already placed.
  const activeSkins = new Map<string, string>()
  const skinOf = (kind: string) => activeSkins.get(kind) ?? DEFAULT_SKIN[kind] ?? ''

  /** Create a shape for any renderable entity that doesn't have one yet. Most
   *  kinds are doodle sprites; a kind whose CharacterDef sets render:'rect'
   *  (e.g. brick) becomes a NATIVE tldraw rectangle instead. */
  function ensureShapes(): void {
    const sprites: TLCreateShapePartial<SpriteShape>[] = []
    const rects: TLCreateShapePartial<TLGeoShape>[] = []
    for (const e of world.with('position')) {
      if (ids.has(e)) continue
      const def = CHARACTERS[e.kind]
      if (!def) continue // unknown kind → nothing to render
      const id = createShapeId()
      ids.set(e, id)
      if (def.render === 'rect' && def.rect) {
        const { w, h } = brickSize(e)
        rects.push({
          id,
          type: 'geo',
          x: e.position.x - w / 2,
          y: e.position.y - h / 2,
          props: {
            geo: 'rectangle',
            w,
            h,
            color: def.color,
            fill: 'solid',
            dash: 'draw',
            size: 's',
          },
        })
      } else {
        const skin = skinOf(e.kind)
        // A growing plant renders at its own sim-driven size (which need not be
        // square — a vine is tall and narrow); every other sprite is a square of
        // its kind × skin default size.
        const { w, h } = e.plant ? plantSize(e) : { w: sizeOf(e.kind, skin), h: sizeOf(e.kind, skin) }
        const thought = thoughtFor(e)
        const carrying = !!e.build?.carrying
        const loaded = loadedFor(e)
        lastThought.set(e, thought)
        lastCarry.set(e, carrying)
        lastLoaded.set(e, loaded)
        sprites.push({
          id,
          type: 'sprite',
          x: e.position.x - w / 2,
          y: e.position.y - h / 2,
          // Everything is grabbable; the sim just resumes from wherever it lands.
          // Style props seed a sensible per-kind colour; the player can recolour
          // and restyle via the tldraw style panel afterwards.
          props: { w, h, kind: e.kind, skin, thought, carrying, loaded, label: e.sign?.label ?? '', color: colorOf(e.kind) },
        })
      }
    }
    if (sprites.length) editor.createShapes(sprites)
    if (rects.length) {
      editor.createShapes(rects)
      // Bricks are geo rects created lazily (as the truck dumps piles / the crew
      // stacks the tower), so tldraw would stack each new one ON TOP of the
      // worker/truck sprites made earlier — a builder then reads as walking UNDER
      // the wall. Send every new brick to the back so bricks always render below
      // the characters and the truck, whatever order they were created in.
      editor.sendToBack(rects.map((r) => r.id!))
    }
  }

  /** Remove an entity whose shape the player deleted, releasing any bench seat
   *  it was holding so the seat doesn't leak. */
  function pruneEntity(e: Entity): void {
    const bench = e.dweller?.bench
    if (bench?.affordance) bench.affordance.occupants = Math.max(0, bench.affordance.occupants - 1)
    ids.delete(e)
    lastThought.delete(e)
    lastCarry.delete(e)
    lastLoaded.delete(e)
    world.remove(e)
  }

  /** Top-left that places a (possibly rotated) w×h box's centre on `e.position`.
   *  Works for sprites and native rects alike — it only needs the box's w/h and
   *  rotation. */
  function topLeftAt(
    centre: { x: number; y: number },
    w: number,
    h: number,
    rotation: number,
  ): { x: number; y: number } {
    const hw = w / 2
    const hh = h / 2
    const cos = Math.cos(rotation)
    const sin = Math.sin(rotation)
    return {
      x: centre.x - (hw * cos - hh * sin),
      y: centre.y - (hw * sin + hh * cos),
    }
  }
  const topLeftFor = (e: Entity, w: number, h: number, rotation: number) =>
    topLeftAt(e.position, w, h, rotation)

  /** A brick rect's desired render size: the sim can override the kind default
   *  (CharacterDef.rect) per entity — e.g. the builder squares a course's end
   *  brick on placement. Falls back to the kind's default rect. */
  function brickSize(e: Entity): { w: number; h: number } {
    const def = CHARACTERS[e.kind]
    return {
      w: e.brick?.w ?? def?.rect?.w ?? 0,
      h: e.brick?.h ?? def?.rect?.h ?? 0,
    }
  }

  /** A growing plant's current render size (px), driven each tick by
   *  gardenerSystem as it grows — the sim owns a plant's size the way it owns a
   *  brick's, so it overrides the shape's own w/h. */
  function plantSize(e: Entity): { w: number; h: number } {
    return { w: e.plant?.w ?? 0, h: e.plant?.h ?? 0 }
  }

  /** True centre of a shape in page space (correct under resize and rotation). */
  function shapeCentre(id: TLShapeId): { x: number; y: number } | undefined {
    return editor.getShapePageBounds(id)?.center
  }

  /** Where a carried brick should RENDER: a skin can hug the brick at a custom
   *  offset from its carrier (0–100 box units, scaled by the carrier's size) —
   *  e.g. the hard-hat worker holds it low against the body instead of floating
   *  it overhead. Returns null when the brick isn't being carried or the
   *  carrier's active skin declares no offset (keep the sim's own carry spot). */
  function carriedRenderCentre(e: Entity): { x: number; y: number } | null {
    if (e.brick?.state !== 'carried') return null
    for (const b of world.with('build', 'position')) {
      if (b.build.carrying !== e) continue
      const off = SKIN_CARRY_OFFSET[b.kind]?.[skinOf(b.kind)]
      if (!off) return null
      const s = sizeOf(b.kind, skinOf(b.kind)) / 100
      return { x: b.position.x + off.x * s, y: b.position.y + off.y * s }
    }
    return null
  }

  /** Push entity positions onto their shapes — except a shape the player is
   *  currently transforming (drag/resize/rotate), whose live centre we read back
   *  into the entity instead. Shapes the player deleted are pruned from the sim. */
  function sync(): void {
    ensureShapes() // catch entities dropped since last tick

    const transforming =
      editor.isIn('select.translating') ||
      editor.isIn('select.resizing') ||
      editor.isIn('select.rotating')
    const userBusy =
      transforming ||
      editor.isIn('select.pointing_shape') ||
      editor.isIn('select.pointing_resize_handle') ||
      editor.isIn('select.pointing_rotate_handle')
    const held = userBusy ? new Set(editor.getSelectedShapeIds()) : null

    const updates: TLShapePartial[] = []
    let dead: Entity[] | null = null
    for (const [e, id] of ids) {
      const shape = editor.getShape(id)
      if (!shape) {
        ;(dead ||= []).push(e) // user deleted this shape
        continue
      }
      if (held?.has(id)) {
        if (transforming) {
          const c = shapeCentre(id)
          if (c) {
            e.position.x = c.x
            e.position.y = c.y
            // Re-anchor a dragged plant to where it was dropped (base = its
            // foot), so gardenerSystem grows it from the new spot instead of
            // snapping it back to where it was sown.
            if (e.plant) {
              e.plant.base.x = c.x
              e.plant.base.y = c.y + e.plant.h / 2
            }
          }
          // The user grabbed a brick out of the wall (or off a builder) → return
          // it to the available pile so it can be re-stacked, freeing its slot and
          // detaching it from any builder that was carrying it. Its squared size
          // reverts to the default (restored by the resize path once released).
          if (e.brick && e.brick.state !== 'pile') {
            if (e.brick.state === 'carried') {
              for (const bd of world.with('build')) {
                if (bd.build.carrying === e) {
                  bd.build.carrying = null
                  bd.build.slot = -1
                }
              }
            }
            e.brick.state = 'pile'
            e.brick.slot = undefined
            e.brick.w = undefined
            e.brick.h = undefined
          }
        }
        continue
      }
      const box = shape as SpriteShape // only w/h + rotation are read; safe for rects
      // A brick renders at the sim's (possibly overridden) size, so a place-time
      // resize takes effect; a growing plant likewise renders at its sim-driven
      // size; every other kind keeps the shape's own w/h.
      const size = e.brick ? brickSize(e) : e.plant ? plantSize(e) : { w: box.props.w, h: box.props.h }
      // A carried brick can be hugged at a skin-specific offset; every other
      // shape sits on its entity's own position.
      const centre = carriedRenderCentre(e) ?? e.position
      const update: TLShapePartial = {
        id,
        type: shape.type,
        ...topLeftAt(centre, size.w, size.h, shape.rotation),
      }
      if (e.brick && (box.props.w !== size.w || box.props.h !== size.h)) {
        ;(update as TLShapePartial<TLGeoShape>).props = { w: size.w, h: size.h }
      }
      // Thought + carrying-pose + bed-load are sprite-only props; batch changes.
      // A plant also folds its grown w/h in here (a sprite, so its size lives in
      // the same props write rather than the brick's geo-props path above).
      if (e.sprite) {
        const thought = thoughtFor(e)
        const carrying = !!e.build?.carrying
        const loaded = loadedFor(e)
        const props: Partial<SpriteShape['props']> = {}
        if (e.plant) {
          if (box.props.w !== size.w) props.w = size.w
          if (box.props.h !== size.h) props.h = size.h
        }
        if (lastThought.get(e) !== thought) {
          props.thought = thought
          lastThought.set(e, thought)
        }
        if (lastCarry.get(e) !== carrying) {
          props.carrying = carrying
          lastCarry.set(e, carrying)
        }
        if (lastLoaded.get(e) !== loaded) {
          props.loaded = loaded
          lastLoaded.set(e, loaded)
        }
        if (Object.keys(props).length) (update as TLShapePartial<SpriteShape>).props = props
      }
      updates.push(update)
    }
    if (updates.length) editor.updateShapes(updates)
    if (dead) for (const e of dead) pruneEntity(e)
  }

  /** Paused mode: the player owns every position/size. Pull each shape's centre
   *  back into its entity (and prune deletions) so resuming continues from the
   *  rearranged layout. */
  function readBackAll(): void {
    ensureShapes() // drops still appear while paused
    let dead: Entity[] | null = null
    for (const [e, id] of ids) {
      if (!editor.getShape(id)) {
        ;(dead ||= []).push(e)
        continue
      }
      const c = shapeCentre(id)
      if (c) {
        e.position.x = c.x
        e.position.y = c.y
        // A plant rearranged while paused keeps its new spot on resume (re-anchor
        // its foot), rather than growing back toward where it was first sown.
        if (e.plant) {
          e.plant.base.x = c.x
          e.plant.base.y = c.y + e.plant.h / 2
        }
      }
    }
    if (dead) for (const e of dead) pruneEntity(e)
  }

  const RUN_OPTS = { history: 'ignore', ignoreShapeLock: true } as const
  let stopped = false

  // Seed the canvas and frame the scene. At mount (and on a live scene switch)
  // tldraw's viewport may not be measured yet, so zoomToFit here can land at min
  // zoom; re-fit on the next frame once layout has settled.
  editor.run(() => {
    ensureShapes()
    editor.zoomToFit()
  }, RUN_OPTS)
  requestAnimationFrame(() => {
    if (!stopped) editor.run(() => editor.zoomToFit(), RUN_OPTS)
  })

  let tick = 0
  let paused = false
  const interval = setInterval(() => {
    if (paused) {
      editor.run(() => readBackAll(), RUN_OPTS)
      return
    }
    tick++
    if (import.meta.env.DEV) (window as unknown as { __tick?: number }).__tick = tick
    const t = runScene(world, tick, sim.ctx, sim.pipeline)
    editor.run(() => sync(), RUN_OPTS)
    onTally?.(t)
  }, TICK_MS)

  return {
    stop: () => {
      stopped = true
      clearInterval(interval)
      // Remove our shapes so a remount (e.g. React StrictMode) doesn't orphan them.
      editor.run(() => editor.deleteShapes([...ids.values()]), RUN_OPTS)
      ids.clear()
    },
    setPaused: (next: boolean) => {
      // On resume, capture the final arrangement before the sim takes over again.
      if (!next && paused) editor.run(() => readBackAll(), RUN_OPTS)
      paused = next
    },
    setSkin: (kind: string, skin: string) => {
      activeSkins.set(kind, skin)
      const size = sizeOf(kind, skin)
      const updates: TLShapePartial<SpriteShape>[] = []
      for (const [e, id] of ids) {
        if (e.kind !== kind) continue
        const shape = editor.getShape(id)
        if (!shape) continue
        updates.push({
          id,
          type: 'sprite',
          ...topLeftFor(e, size, size, shape.rotation),
          props: { w: size, h: size, skin },
        })
      }
      if (updates.length) editor.run(() => editor.updateShapes(updates), RUN_OPTS)
    },
  }
}
