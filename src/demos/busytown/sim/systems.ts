/**
 * Busytown — simulation systems (Miniplex archetypes)
 * ----------------------------------------------------
 * Ported from the headless feel-sim in sim.py. Each system is a query over the
 * world's entities and mutates component fields in place. Timing is in TICKS
 * (config.ts → TIMING); `dweller.until` / `interactor.until` hold ABSOLUTE tick
 * values, compared against the current `tick` passed into each step.
 *
 * This file imports NOTHING from tldraw — it is pure sim. The render layer
 * (render/bridge.ts) reads entity positions and syncs shapes.
 *
 * A scene's `pipeline` chooses WHICH systems run and in what order; Busytown's
 * pipeline is the seven below (whim → move → arrive → dwell → greet → bird →
 * van), with `tally` always run afterwards by runScene(). Systems that used to
 * read the CANVAS / LAYOUT globals now take a SimContext {bounds} instead, so
 * the same functions work for any scene.
 */
import type { World } from 'miniplex'
import type { Entity, Vec2, WhimKind, AffordanceTag, PlantVariety } from './components'
import { dropEntity } from './components'
import { BIRD, MOVE, SCALE, TIMING, WHIM_WEIGHTS } from './config'
import { randRange, randFloat, choice } from './rng'

/** Scene-scoped globals threaded into the systems (replaces the CANVAS/LAYOUT
 *  module constants). `bounds` is the active scene's page-space extent. */
export type SimContext = { bounds: { w: number; h: number } }

/** A behavior. Every system is assignable to this even if it ignores the later
 *  args (TS allows a shorter parameter list). A scene's pipeline is SystemFn[]. */
export type SystemFn = (world: World<Entity>, tick: number, ctx: SimContext) => void

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y)

/** Whim → the affordance tag a townsperson seeks (wander has none). */
const WHIM_TO_TAG: Record<Exclude<WhimKind, 'wander'>, AffordanceTag> = {
  shop: 'shop',
  rest: 'sit',
  home: 'home',
}

/** A random wander destination in the lower, walkable band (matches sim.py).
 *  Extent comes from the scene's bounds, not a module constant. */
function wanderTarget(ctx: SimContext): Vec2 {
  const { w, h } = ctx.bounds
  return { x: randFloat(100 * SCALE, w - 100 * SCALE), y: randFloat(380 * SCALE, h - 60 * SCALE) }
}

/** Nearest prop advertising `tag`. Capacity-limited props (benches) are skipped
 *  when full; unlimited props (capacity 99) are always eligible. */
function nearestAffordance(world: World<Entity>, from: Vec2, tag: AffordanceTag): Entity | null {
  let best: Entity | null = null
  let bestD = Infinity
  for (const e of world.with('affordance', 'position')) {
    if (!e.affordance.tags.includes(tag)) continue
    if (e.affordance.capacity < 99 && e.affordance.occupants >= e.affordance.capacity) continue
    const d = dist(from, e.position)
    if (d < bestD) {
      bestD = d
      best = e
    }
  }
  return best
}

/** Nearest stall (advertises 'shop' and carries stock). */
function nearestStall(world: World<Entity>, from: Vec2): Entity | null {
  let best: Entity | null = null
  let bestD = Infinity
  for (const e of world.with('stock', 'position')) {
    const d = dist(from, e.position)
    if (d < bestD) {
      bestD = d
      best = e
    }
  }
  return best
}

/** All perch spots (dropped trees count too). Falls back to the scene centre if
 *  a scene has no perches at all (Busytown always has trees, so this is inert
 *  there — behaviour is preserved). */
function perchSpots(world: World<Entity>, ctx: SimContext): readonly Vec2[] {
  const spots: Vec2[] = []
  for (const e of world.with('affordance', 'position')) {
    if (e.affordance.tags.includes('perch')) spots.push(e.position)
  }
  return spots.length ? spots : [{ x: ctx.bounds.w / 2, y: ctx.bounds.h / 2 }]
}

// ── 1. whim ────────────────────────────────────────────────────────────────
/** Idle townsfolk past their cooldown re-roll a whim and head for a match. */
export function whimSystem(world: World<Entity>, tick: number, ctx: SimContext): void {
  for (const p of world.with('whim', 'dweller', 'mover', 'position')) {
    if (p.dweller.state !== 'idle' || tick < p.dweller.until) continue
    rollWhim(world, p, ctx)
  }
}

function rollWhim(world: World<Entity>, p: Entity, ctx: SimContext): void {
  const r = Math.random()
  let kind: WhimKind
  if (r < WHIM_WEIGHTS.shop) kind = 'shop'
  else if (r < WHIM_WEIGHTS.shop + WHIM_WEIGHTS.rest) kind = 'rest'
  else if (r < WHIM_WEIGHTS.shop + WHIM_WEIGHTS.rest + WHIM_WEIGHTS.wander) kind = 'wander'
  else kind = 'home'

  let target: Vec2 | null = null
  if (kind === 'wander') {
    target = wanderTarget(ctx)
  } else if (kind === 'home') {
    const houses = [...world.with('affordance', 'position')].filter((e) =>
      e.affordance!.tags.includes('home'),
    )
    target = houses.length ? { ...choice(houses).position } : null
  } else {
    const aff = nearestAffordance(world, p.position, WHIM_TO_TAG[kind])
    if (aff) {
      target = { ...aff.position }
      // Reserve a bench seat so two people can't claim the same last spot.
      if (kind === 'rest' && aff.affordance) {
        aff.affordance.occupants++
        p.dweller!.bench = aff
      }
    }
  }

  // No free bench / no matching prop → wander instead (sim.py fallback).
  if (!target) {
    kind = 'wander'
    target = wanderTarget(ctx)
  }

  p.whim!.kind = kind
  p.whim!.target = target
  p.mover!.target = target
  p.mover!.arrived = false
  p.dweller!.state = 'walk'
}

// ── 2. move ──────────────────────────────────────────────────────────────────
/** Step walking townsfolk toward their target; flag arrival within ARRIVE_EPS. */
export function moveSystem(world: World<Entity>): void {
  for (const p of world.with('mover', 'dweller', 'position')) {
    if (p.dweller.state !== 'walk' || !p.mover.target) continue
    const t = p.mover.target
    const d = dist(p.position, t)
    if (d <= MOVE.ARRIVE_EPS) {
      p.position.x = t.x
      p.position.y = t.y
      p.mover.arrived = true
    } else {
      p.position.x += p.mover.speed * (t.x - p.position.x) / d
      p.position.y += p.mover.speed * (t.y - p.position.y) / d
    }
  }
}

// ── 3. arrive ────────────────────────────────────────────────────────────────
/** On arrival, begin the dwell the whim implies: sit, buy, or just go idle. */
export function arriveSystem(world: World<Entity>, tick: number): void {
  for (const p of world.with('mover', 'dweller', 'whim', 'position')) {
    if (!p.mover.arrived) continue
    p.mover.arrived = false
    p.mover.target = null

    if (p.whim.kind === 'rest') {
      p.dweller.state = 'sit'
      p.dweller.until = tick + randRange(TIMING.DWELL_BENCH)
    } else if (p.whim.kind === 'shop') {
      const stall = nearestStall(world, p.position)
      if (stall && stall.stock && stall.stock.amount > 0) {
        stall.stock.amount--
        p.dweller.state = 'shop'
        p.dweller.until = tick + randRange(TIMING.DWELL_STALL)
      } else {
        goIdle(p, tick)
      }
    } else {
      goIdle(p, tick)
    }
  }
}

function goIdle(p: Entity, tick: number): void {
  p.dweller!.state = 'idle'
  p.dweller!.until = tick + randRange(TIMING.WHIM_COOLDOWN)
}

// ── 4. dwell ─────────────────────────────────────────────────────────────────
/** End seated/shopping dwells: release the bench seat and return to idle. */
export function dwellSystem(world: World<Entity>, tick: number): void {
  for (const p of world.with('dweller', 'position')) {
    const s = p.dweller.state
    if ((s === 'sit' || s === 'shop') && tick >= p.dweller.until) {
      if (s === 'sit' && p.dweller.bench?.affordance) {
        p.dweller.bench.affordance.occupants = Math.max(0, p.dweller.bench.affordance.occupants - 1)
        p.dweller.bench = null
      }
      goIdle(p, tick)
    }
  }
}

// ── 5. greet ─────────────────────────────────────────────────────────────────
/** Two walkers passing within GREET_RADIUS exchange a brief greeting, then a
 *  per-person cooldown keeps it from re-firing immediately. */
export function greetSystem(world: World<Entity>, tick: number): void {
  const walkers = [...world.with('interactor', 'dweller', 'position')].filter(
    (p) => p.dweller.state === 'walk',
  )
  for (let i = 0; i < walkers.length; i++) {
    for (let j = i + 1; j < walkers.length; j++) {
      const a = walkers[i]
      const b = walkers[j]
      if (a.interactor.state === 'greet' || b.interactor.state === 'greet') continue
      if (tick < a.interactor.cooldownUntil || tick < b.interactor.cooldownUntil) continue
      if (dist(a.position, b.position) >= TIMING.GREET_RADIUS) continue
      startGreet(a, b, tick)
      startGreet(b, a, tick)
    }
  }
  // Expire finished greetings.
  for (const p of world.with('interactor')) {
    if (p.interactor.state === 'greet' && tick >= p.interactor.until) {
      p.interactor.state = 'none'
      p.interactor.partner = null
    }
  }
}

function startGreet(self: Entity, other: Entity, tick: number): void {
  self.interactor!.state = 'greet'
  self.interactor!.partner = other
  self.interactor!.until = tick + TIMING.GREET_DUR
  self.interactor!.cooldownUntil = tick + TIMING.GREET_COOLDOWN
}

function nearestPoint(points: readonly Vec2[], from: Vec2): Vec2 {
  let best = points[0]
  let bestD = Infinity
  for (const p of points) {
    const d = dist(from, p)
    if (d < bestD) {
      bestD = d
      best = p
    }
  }
  return best
}

function stepToward(pos: Vec2, target: Vec2, speed: number): void {
  const dx = target.x - pos.x
  const dy = target.y - pos.y
  const d = Math.hypot(dx, dy)
  if (d <= speed) {
    pos.x = target.x
    pos.y = target.y
  } else {
    pos.x += (speed * dx) / d
    pos.y += (speed * dy) / d
  }
}

function settleOnTree(bird: Entity, spots: readonly Vec2[], tick: number): void {
  const tree = choice(spots)
  bird.position.x = tree.x
  bird.position.y = tree.y
  bird.perch!.state = 'perch'
  bird.perch!.until = tick + randRange(TIMING.BIRD_PERCH)
}

// ── 6. birds ─────────────────────────────────────────────────────────────────
/** Birds bolt when a WALKING person or the van comes within FLEE_RADIUS. When
 *  all is calm and someone is SEATED, they flock over and ring around that
 *  person's feet (feeding). Otherwise they perch in a tree and make a voluntary
 *  hop to a new one when their perch timer ends. */
export function birdSystem(world: World<Entity>, tick: number, ctx: SimContext): void {
  const feeders: Vec2[] = [] // seated townsfolk — birds are drawn to these
  const threats: Vec2[] = [] // walkers + van — birds flee these
  for (const p of world.with('dweller', 'position')) {
    if (p.dweller.state === 'sit') feeders.push(p.position)
    else if (p.dweller.state === 'walk') threats.push(p.position)
  }
  for (const v of world.with('vehicle', 'position')) threats.push(v.position)
  const spots = perchSpots(world, ctx)

  let i = -1
  for (const bird of world.with('perch', 'position')) {
    i++

    // Someone's sitting → the flock commits: fly over, ring around their feet,
    // and stay calm (feeding overrides the usual skittishness, so passers-by
    // don't scatter them). They disperse only when no one is seated.
    if (feeders.length) {
      bird.perch.state = 'perch'
      const feet = nearestPoint(feeders, bird.position)
      const a = i * 2.39996 // golden angle → birds fan out, not stack
      stepToward(bird.position, {
        x: feet.x + Math.cos(a) * BIRD.FEED_RING,
        y: feet.y + BIRD.FEET_OFFSET + Math.sin(a) * BIRD.FEED_RING * 0.5,
      }, BIRD.FLY_SPEED)
      continue
    }

    // No one seated → skittish life: finish any flee, bolt from close threats,
    // otherwise perch with the odd voluntary hop.
    if (bird.perch.state === 'flee') {
      bird.position.y -= 6 * SCALE
      bird.position.x += 4 * SCALE
      if (tick >= bird.perch.until) settleOnTree(bird, spots, tick)
      continue
    }
    let near = Infinity
    for (const t of threats) near = Math.min(near, dist(bird.position, t))
    if (near < TIMING.FLEE_RADIUS) {
      bird.perch.state = 'flee'
      bird.perch.until = tick + TIMING.FLEE_DUR
      continue
    }
    if (tick >= bird.perch.until) settleOnTree(bird, spots, tick)
  }
}

// ── 7. van ───────────────────────────────────────────────────────────────────
/** Drive the path lane; pause at a stall to restock it, then carry on and loop. */
export function vanSystem(world: World<Entity>, tick: number, ctx: SimContext): void {
  for (const v of world.with('vehicle', 'position')) {
    const vh = v.vehicle
    if (vh.state === 'drive') {
      v.position.x += vh.speed
      const stall = nearestStall(world, v.position)
      if (stall && Math.abs(v.position.x - stall.position.x) < MOVE.ARRIVE_EPS && tick >= vh.until) {
        vh.state = 'restock'
        vh.until = tick + TIMING.VAN_RESTOCK_DUR
      }
      if (v.position.x > ctx.bounds.w + 60 * SCALE) {
        v.position.x = -50 * SCALE
        vh.until = 0
      }
    } else if (tick >= vh.until) {
      const stall = nearestStall(world, v.position)
      if (stall && stall.stock) stall.stock.amount = stall.stock.max
      vh.state = 'drive'
      vh.until = tick + 20 // brief cooldown so it doesn't re-trigger the same stall
    }
  }
}

// ── dog (new-behavior character; opt-in via a scene's pipeline) ───────────────
/** A dog follows the nearest townsperson, and now and then (when a 'drink' prop
 *  such as a pond exists) detours to it for a drink. Demonstrates the behavior
 *  axis end to end: a new component field (`chase`) + this new system, added to
 *  a scene's pipeline. Invisible to every other system — the dog has none of
 *  their components. */
export function dogSystem(world: World<Entity>, tick: number, ctx: SimContext): void {
  const people = [...world.with('dweller', 'position')]
  for (const dog of world.with('chase', 'position')) {
    const c = dog.chase
    if (tick >= c.until) {
      const drink = nearestAffordance(world, dog.position, 'drink')
      c.mode = drink && Math.random() < 0.3 ? 'drink' : 'follow'
      c.until = tick + randRange([40, 90])
    }
    let target: Vec2 | null = null
    if (c.mode === 'drink') {
      const drink = nearestAffordance(world, dog.position, 'drink')
      if (drink) target = drink.position
    }
    if (!target) {
      let bestD = Infinity
      for (const p of people) {
        const d = dist(dog.position, p.position)
        if (d < bestD) {
          bestD = d
          target = p.position
        }
      }
    }
    if (!target) target = { x: ctx.bounds.w / 2, y: ctx.bounds.h / 2 }
    stepToward(dog.position, target, c.speed)
  }
}

// ── builder (new-behavior character: fetch → carry → stack a brick wall) ──────
/** Brick geometry (page px). Must match the brick CharacterDef's `rect` so the
 *  placed rectangles tile flush into courses. */
const BRICK_W = 96
const BRICK_H = 44
const BRICK_GAP = 8
const WALL_COLS = 4 // bricks per course (the tower's width)
const CARRY_LIFT = 40 // how high the brick rides above the builder while carried

/** Nearest brick still lying in the pile (state 'pile') that a builder can
 *  actually reach — one enclosed by the growing tower (the courses climbed over a
 *  pile dropped above the site) is walled in, so since builders route AROUND the
 *  stack rather than through it, such a brick is unreachable and must be skipped or
 *  the whole crew deadlocks fetching a brick it can never touch. */
function nearestPileBrick(world: World<Entity>, from: Vec2, box: Box | null): Entity | null {
  let best: Entity | null = null
  let bestD = Infinity
  for (const e of world.with('brick', 'position')) {
    if (e.brick.state !== 'pile') continue
    if (enclosedByTower(e.position, box)) continue
    const d = dist(from, e.position)
    if (d < bestD) {
      bestD = d
      best = e
    }
  }
  return best
}

/** Lowest wall slot not already filled by a placed brick or claimed by another
 *  builder currently carrying toward it. This is the SHARED coordination point:
 *  every builder derives its target from the same live occupancy, so two
 *  builders never stack onto the same spot, and a gap left by a deleted brick is
 *  the next thing refilled. `self` is excluded so a builder doesn't block itself. */
function nextFreeSlot(world: World<Entity>, self: Entity): number {
  const taken = new Set<number>()
  for (const e of world.with('brick')) {
    if (e.brick.state === 'placed' && e.brick.slot != null) taken.add(e.brick.slot)
  }
  for (const b of world.with('build')) {
    if (b === self) continue
    if (b.build.carrying && b.build.slot != null && b.build.slot >= 0) taken.add(b.build.slot)
  }
  let i = 0
  while (taken.has(i)) i++
  return i
}

/** One brick's slot in the wall: its centre plus the size to render it at. Each
 *  course is 3 full bricks + 1 SQUARE brick (width shrunk to the brick height);
 *  the square sits at the START of even courses and the END of odd ones. That
 *  alternation staggers the vertical joints half a brick — a proper running bond
 *  — while keeping both wall edges flush. */
type BrickSlot = { x: number; y: number; w: number; h: number }

/** Where the n-th placed brick belongs in the ONE tower: courses fill
 *  left→right, and the tower simply climbs — `row` grows without bound, so every
 *  brick makes it taller rather than starting a new structure. Build site is
 *  bounds-relative, so it fits any scene. */
function builderSlot(n: number, ctx: SimContext): BrickSlot {
  const row = Math.floor(n / WALL_COLS)
  const col = n % WALL_COLS
  // The square brick alternates ends: first (col 0) on even courses, last on odd
  // ones. This is what offsets the courses, so no whole-row shift is needed.
  const squareCol = row % 2 === 0 ? 0 : WALL_COLS - 1
  const widthAt = (c: number) => (c === squareCol ? BRICK_H : BRICK_W)
  const baseLeftX = ctx.bounds.w * 0.42 - BRICK_W / 2
  const baseY = ctx.bounds.h * 0.7 // bottom course
  // Walk the course left→right, summing the (mixed) widths ahead of this column.
  let leftX = baseLeftX
  for (let c = 0; c < col; c++) leftX += widthAt(c) + BRICK_GAP
  const w = widthAt(col)
  return { x: leftX + w / 2, y: baseY - row * (BRICK_H + BRICK_GAP), w, h: BRICK_H }
}

/** Axis-aligned box (page px). The placed tower is treated as one for avoidance. */
type Box = { minX: number; minY: number; maxX: number; maxY: number }
const AVOID_PAD = BRICK_H * 0.7 // clearance builders keep around placed bricks

/** Is point `p` walled inside the solid tower (its unpadded bounding box)? A pile
 *  brick the climbing courses have grown over ends up here — unreachable without
 *  crossing the stack, so fetch/supply queries must treat it as not there. */
function enclosedByTower(p: Vec2, box: Box | null): boolean {
  return !!box && p.x > box.minX && p.x < box.maxX && p.y > box.minY && p.y < box.maxY
}

/** Bounding box of every PLACED brick — the tower the builders must walk around.
 *  Null until the first brick lands (nothing to avoid yet). */
function towerBounds(world: World<Entity>): Box | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  let any = false
  for (const e of world.with('brick', 'position')) {
    if (e.brick.state !== 'placed') continue
    any = true
    const w = e.brick.w ?? BRICK_W
    const h = e.brick.h ?? BRICK_H
    minX = Math.min(minX, e.position.x - w / 2)
    maxX = Math.max(maxX, e.position.x + w / 2)
    minY = Math.min(minY, e.position.y - h / 2)
    maxY = Math.max(maxY, e.position.y + h / 2)
  }
  return any ? { minX, minY, maxX, maxY } : null
}

/** Does segment a→b cross `box` (grown by `pad`)? Liang–Barsky clip test.
 *  A single-point GRAZE (t0 == t1 — e.g. a mover standing exactly on the padded
 *  boundary aiming past the corner) does NOT count as a hit: treating it as one
 *  denied edge-standers their straight shot every tick and cycled them between
 *  corners forever. Only a segment with a real interval inside the box blocks. */
function segHitsBox(a: Vec2, b: Vec2, box: Box, pad: number): boolean {
  const x0 = box.minX - pad, y0 = box.minY - pad, x1 = box.maxX + pad, y1 = box.maxY + pad
  const dx = b.x - a.x, dy = b.y - a.y
  let t0 = 0, t1 = 1
  const clip = (p: number, q: number): boolean => {
    if (p === 0) return q >= 0 // parallel: inside the slab iff q >= 0
    const r = q / p
    if (p < 0) {
      if (r > t1) return false
      if (r > t0) t0 = r
    } else {
      if (r < t0) return false
      if (r < t1) t1 = r
    }
    return true
  }
  if (!(clip(-dx, a.x - x0) && clip(dx, x1 - a.x) && clip(-dy, a.y - y0) && clip(dy, y1 - a.y))) {
    return false
  }
  return t1 - t0 > 1e-9
}

/** Is `pos` inside `box` grown by `pad`? (Strictly inside the padded margin.) */
function insideBox(pos: Vec2, box: Box, pad: number): boolean {
  return (
    pos.x > box.minX - pad && pos.x < box.maxX + pad &&
    pos.y > box.minY - pad && pos.y < box.maxY + pad
  )
}

/** The padded corner to hop to when rounding the tower from INSIDE the clearance:
 *  the one nearest the TARGET among those reachable without crossing the solid
 *  bricks. Using "nearest the target" (not nearest the mover) is what keeps this in
 *  step with the outside corner-router below — both always push toward the goal, so
 *  a mover straddling the margin boundary can't flip-flop between "go to the corner
 *  behind me" (inside) and "go to the corner ahead" (outside) and freeze there.
 *  Returns null only if no corner is reachable (a mover truly boxed in — never
 *  happens from within the clearance, where at least the two corners on the
 *  adjacent face are always reachable). */
function cornerToward(pos: Vec2, target: Vec2, box: Box, pad: number): Vec2 | null {
  const corners: Vec2[] = [
    { x: box.minX - pad, y: box.minY - pad },
    { x: box.maxX + pad, y: box.minY - pad },
    { x: box.minX - pad, y: box.maxY + pad },
    { x: box.maxX + pad, y: box.maxY + pad },
  ]
  let best: Vec2 | null = null
  let bestGoal = Infinity
  for (const c of corners) {
    if (dist(pos, c) < 1) continue // already on it
    if (segHitsBox(pos, c, box, 0)) continue // would cut through the solid bricks
    const goal = dist(c, target)
    if (goal < bestGoal) {
      bestGoal = goal
      best = c
    }
  }
  return best
}

/** Step toward `target` from INSIDE the tower's clearance margin — where builders
 *  must live to place bricks — without ever crossing the solid stack. The step is
 *  the ordinary straight one UNLESS its landing would fall inside the real (unpadded)
 *  bricks; then the component driving IN through the face the mover is already
 *  outside of is cancelled, so it SLIDES along the brick face (at full tangential
 *  speed — no oscillation, no pinning) and rounds the tower rather than burrowing
 *  through. The common case (a builder beside the tower heading for a stand spot
 *  OUTSIDE the stack) never triggers the slide, so it's exactly the old straight
 *  step — no slowdown, no top-corner sticking. At a CORNER (both components drive
 *  inward) only the smaller is cancelled: keeping the dominant one slides along the
 *  more-aligned face and rounds the corner, where cancelling both would freeze in
 *  place. Whichever single component survives keeps its coordinate outside the box,
 *  so the mover can never end up inside the bricks. */
function slideStep(pos: Vec2, target: Vec2, speed: number, box: Box): void {
  const dx = target.x - pos.x, dy = target.y - pos.y
  const d = Math.hypot(dx, dy) || 1
  let vx = (speed * dx) / d, vy = (speed * dy) / d
  const nx = pos.x + vx, ny = pos.y + vy
  if (nx > box.minX && nx < box.maxX && ny > box.minY && ny < box.maxY) {
    const blockX = pos.x <= box.minX || pos.x >= box.maxX // outside on X → vx drives inward
    const blockY = pos.y <= box.minY || pos.y >= box.maxY // outside on Y → vy drives inward
    if (blockX && blockY) {
      // Corner: keep the dominant axis (slide along that face), drop the other.
      if (Math.abs(vx) >= Math.abs(vy)) vy = 0
      else vx = 0
    } else {
      if (blockX) vx = 0
      if (blockY) vy = 0
    }
  }
  pos.x += vx
  pos.y += vy
}

/** Step toward `target`, but route around the tower `box` instead of walking
 *  through placed bricks. When the straight path is blocked we head for the
 *  padded box corner that best makes progress (and is itself reachable) — a
 *  couple of hops carry the builder around the stack.
 *
 *  Deadlock guard. Two ways a builder used to get stuck on the tower:
 *   1. Standing ON a padded corner, it picked that same corner as "best" (its
 *      distance is ~0) and stepping toward where you already are moves nowhere.
 *   2. Scoring corners by dist(pos,c)+dist(c,target) sends a builder to its
 *      NEAREST corner — for one sitting below the tower with a target up the side
 *      that's the bottom corner, i.e. backward — so it ping-ponged in place.
 *  So we head for the reachable corner NEAREST THE TARGET (always progress toward
 *  the goal, never backward), skip any corner within one step (rule 1), and if no
 *  corner qualifies step straight at the target. Every tick makes forward
 *  progress, so a builder can never park on the tower. */
function moveAvoiding(pos: Vec2, target: Vec2, speed: number, box: Box | null): void {
  if (!box || !segHitsBox(pos, target, box, AVOID_PAD)) {
    stepToward(pos, target, speed)
    return
  }
  const p = AVOID_PAD
  // Inside the tower's clearance margin — where a builder must live to place a
  // brick. Two very different intents get us here, told apart by whether the
  // target sits across the SOLID bricks:
  //   • NOT across (a stand spot beside the stack, or a pile on this side) → slide
  //     toward it along the brick face; the common placement approach, kept fast.
  //   • ACROSS the stack (a pile or stand on the far side) → sliding along a face
  //     stalls whenever the target is perpendicular to it (zero tangential push),
  //     so instead head for the nearest padded corner — always reachable from the
  //     margin without crossing — and let the corner-router below carry it AROUND.
  // Either way it never walks under the wall, and never pins against a face.
  if (insideBox(pos, box, p)) {
    if (segHitsBox(pos, target, box, 0)) stepToward(pos, cornerToward(pos, target, box, p) ?? target, speed)
    else slideStep(pos, target, speed, box)
    return
  }
  const corners: Vec2[] = [
    { x: box.minX - p, y: box.minY - p },
    { x: box.maxX + p, y: box.minY - p },
    { x: box.minX - p, y: box.maxY + p },
    { x: box.maxX + p, y: box.maxY + p },
  ]
  let best: Vec2 | null = null
  let bestGoal = Infinity
  for (const c of corners) {
    // Skip only a corner we're standing ON (stepping to it moves nowhere). A
    // merely NEARBY corner must stay eligible: stepToward snaps onto it, and
    // from exactly on a corner the adjacent corners are always visible (the
    // edge path runs a full pad out, the visibility test only demands half),
    // so the walk continues corner-to-corner. Skipping any corner within one
    // step — the old rule — made a mover one step short of the goal-side
    // corner fall back to a BACKWARD corner and ping-pong there forever.
    if (dist(pos, c) < 1) continue
    if (segHitsBox(pos, c, box, p * 0.5)) continue // corner not visible from here
    const goal = dist(c, target) // greedily head for the corner closest to the goal
    if (goal < bestGoal) {
      bestGoal = goal
      best = c
    }
  }
  stepToward(pos, best ?? target, speed)
}

/** The huddle spot beside the tower base where finished builders hang out. Each
 *  builder keeps its own jittered offset so the group reads as a loose cluster,
 *  not a stack. */
function gatherSpot(ctx: SimContext, box: Box | null): Vec2 {
  const baseY = ctx.bounds.h * 0.7
  const baseX = ctx.bounds.w * 0.42 - BRICK_W / 2
  // Just to the left of the tower's base, on the ground (a touch further out so
  // the spread-out cluster still clears the stack).
  return { x: (box ? box.minX : baseX) - 90 * SCALE, y: (box ? box.maxY : baseY) - 10 }
}

/** Sideways wobble applied to a builder's steering target while it's actively
 *  walking (fetching/carrying), so a crew converging on the same brick or slot
 *  doesn't trace identical lines — and, more, so nobody walks a dead-straight
 *  path. Each builder's `wander` phase keeps its meander stable and out of sync
 *  with the rest. Two sines at different rates sum into a loose, non-repeating
 *  drift (not a regular oscillation), and the amplitude TAPERS to zero as the
 *  builder nears the goal, so a large swing curves the long approach but never
 *  orbits the target — the last steps straighten and land clean (the ARRIVE
 *  check compares against the real, un-wobbled point regardless). */
const WANDER_AMPLITUDE = 24 * SCALE // peak sideways swing far from the goal
const WANDER_FREQ = 0.05 // radians/tick — the primary meander
const WANDER_FREQ2 = 0.021 // a slower second wave so the path wanders, not oscillates
function wobbleTarget(pos: Vec2, target: Vec2, tick: number, phase: number): Vec2 {
  const dx = target.x - pos.x, dy = target.y - pos.y
  const d = Math.hypot(dx, dy) || 1
  // Shrink the swing toward nothing within ~arrival range of the goal.
  const amp = Math.min(WANDER_AMPLITUDE, Math.max(0, d - MOVE.ARRIVE_EPS) * 0.6)
  const off =
    (Math.sin(tick * WANDER_FREQ + phase) + 0.5 * Math.sin(tick * WANDER_FREQ2 + phase * 1.7)) * amp
  return { x: target.x + (-dy / d) * off, y: target.y + (dx / d) * off }
}

/** Cosmetic wobble that never aims INTO the tower. A mostly-vertical approach
 *  alongside a tall stack has a horizontal perpendicular, so a raw wobble swings
 *  the steering target back and forth across the brick face; the avoidance step
 *  then deflects on every out-swing and the builder crawls up the wall pinned in
 *  place. So if the wobbled point lands within the tower's clearance, drop the
 *  wobble and steer at the real target — straight past the stack, no oscillation.
 *  (Away from the tower there's nothing to hit, so the wobble is kept in full.) */
function wobbleClear(pos: Vec2, target: Vec2, tick: number, phase: number, box: Box | null): Vec2 {
  const w = wobbleTarget(pos, target, tick, phase)
  return box && insideBox(w, box, AVOID_PAD) ? target : w
}

/** How long (ticks) each builder holds the floor before the turn passes to the
 *  next — one bubble up at a time, the crew talking in rotation. Long enough
 *  (~5.5 s) to comfortably read a line; the speaker also PAUSES for its turn
 *  (see below), so the bubble sits still and its text stays fixed the whole
 *  time. The per-builder downtime is 1/crew regardless of this value, so a
 *  longer, more readable turn doesn't cost extra throughput. */
const BUILD_TALK_TURN = 55

export function builderSystem(world: World<Entity>, tick: number, ctx: SimContext): void {
  const box = towerBounds(world) // the placed tower — an obstacle to route around
  const huddle = gatherSpot(ctx, box)
  // One-at-a-time speech: pick a single speaker by a tick window over the crew
  // (stable insertion order), so exactly one bubble is up and the turn rotates
  // through everyone rather than the whole crew talking at once.
  const crew = [...world.with('build', 'position')]
  const speaker = crew.length ? Math.floor(tick / BUILD_TALK_TURN) % crew.length : -1
  for (let i = 0; i < crew.length; i++) crew[i].build.speaking = i === speaker
  for (const b of crew) {
    const st = b.build

    // Pause the builder while it holds the floor: a stationary sprite with a
    // fixed line is far easier to read than a bubble sliding along with a
    // walking figure. It stands still (brick and all) until its speaking turn
    // passes, then picks fetching/stacking straight back up.
    if (st.speaking) continue

    // Drop a carry that vanished from under us: the user deleted the brick we
    // were holding (or it otherwise stopped being carried). Release the slot
    // claim so we re-fetch instead of hauling a ghost to an empty spot.
    if (st.carrying && (!world.has(st.carrying) || st.carrying.brick?.state !== 'carried')) {
      st.carrying = null
      st.slot = -1
    }

    if (!st.carrying) {
      // Fetch: walk (around the tower) to the nearest pile brick and pick it up.
      const brick = nearestPileBrick(world, b.position, box)
      if (!brick) {
        // Nothing left to build → the crew knocks off and gathers by the tower
        // base to hang out. Keep checking the pile, so bricks the user drops (or
        // returns) later put everyone back to work.
        st.state = 'rest'
        st.slot = -1
        if (!st.rest) {
          st.rest = { x: huddle.x + randFloat(-50, 50) * SCALE, y: huddle.y + randFloat(-30, 30) * SCALE }
        }
        // Once parked, hold perfectly still — stepping toward a spot we've already
        // reached could nudge us a hair each tick and make the sprite flip facing
        // back and forth. A settled builder just stands there.
        if (dist(b.position, st.rest) > MOVE.ARRIVE_EPS) {
          moveAvoiding(b.position, st.rest, st.speed, box)
        }
        continue
      }
      st.state = 'build'
      st.rest = undefined // back to work — forget the hangout spot
      moveAvoiding(b.position, wobbleClear(b.position, brick.position, tick, st.wander ?? 0, box), st.speed, box)
      if (dist(b.position, brick.position) <= MOVE.ARRIVE_EPS) {
        brick.brick!.state = 'carried'
        st.carrying = brick
        // Claim a slot the moment we pick up, so a second builder picking up in
        // the same tick sees it taken and heads for a different one.
        st.slot = nextFreeSlot(world, b)
      }
    } else {
      // Carry: the brick rides above the builder as he walks to the slot. He
      // stands BESIDE the tower (never inside the stack) at the course's height,
      // approaching around the placed bricks, then sets the brick into its spot.
      // The side is chosen from the SLOT's column, not the builder's live x — if
      // it tracked the builder, crossing the tower's centre line would flip the
      // target from one side to the other and the builder would reverse (and flip
      // its facing) back and forth instead of committing to one side.
      const slot = builderSlot(st.slot ?? 0, ctx)
      const standX = box
        ? slot.x < (box.minX + box.maxX) / 2
          ? box.minX - CARRY_LIFT
          : box.maxX + CARRY_LIFT
        : slot.x
      const stand = { x: standX, y: slot.y }
      st.carrying.position.x = b.position.x
      st.carrying.position.y = b.position.y - CARRY_LIFT
      moveAvoiding(b.position, wobbleClear(b.position, stand, tick, st.wander ?? 0, box), st.speed, box)
      if (dist(b.position, stand) <= MOVE.ARRIVE_EPS) {
        st.carrying.position.x = slot.x
        st.carrying.position.y = slot.y
        // Lock the brick in: record its slot (so others treat it as filled) and
        // stamp its final size — squaring the course's end brick. The render
        // bridge resizes the rectangle to match.
        st.carrying.brick!.state = 'placed'
        st.carrying.brick!.slot = st.slot
        st.carrying.brick!.w = slot.w
        st.carrying.brick!.h = slot.h
        st.carrying = null
        st.slot = -1
        st.placed++
      }
    }
  }
}

// ── truck (Builder scene: just-in-time brick deliveries) ─────────────────────
/** Delivery tuning, sized against the crew's burn rate so the snails are ALWAYS
 *  almost out of bricks but rarely stand around: five snails clear a full load
 *  in roughly one truck round-trip, so the truck departs the moment the pile
 *  (plus anything already on a truck bed) can't outlast its drive over, and the
 *  new pile lands just as the last bricks are being carried off. */
export const TRUCK = {
  LOAD: 8, // bricks per delivery — a "small pile"
  LOW_WATER: 4, // depart when pile + in-transit supply sinks to this
  // Parked spells are also the truck's two speaking moments (see the truck's
  // thought()), so they're held long enough to read a line before it drives on.
  LOAD_DUR: 40, // ticks parked at the factory, loading + talking (~4 s)
  DUMP_DUR: 38, // ticks parked at the drop, tipping + talking (~3.8 s)
} as const

/** The loading dock: a point BELOW the factory's centre (its sprite is ~220 px
 *  tall) so the truck parks at the building's base rather than on top of it. In
 *  raw sprite px (matching the factory footprint), not scaled distance. */
export const FACTORY_DOCK_Y = 160
const dockOf = (factory: Vec2): Vec2 => ({ x: factory.x, y: factory.y + FACTORY_DOCK_Y })

/** Drive the truck one step toward `target` in straight, axis-aligned legs. It
 *  commits to ONE axis (`d.leg`) and holds that heading until that axis closes,
 *  then turns once and closes the other — so the truck only ever moves
 *  horizontally or vertically, in long lines, never diagonally and never in
 *  quick zig-zags. When (re)choosing a leg it takes the axis with more distance
 *  to cover, so the first, longest leg leads. If a leg would drive straight
 *  through the tower, it takes the perpendicular leg first to route around it. */
function driveStraight(
  d: NonNullable<Entity['deliver']>,
  pos: Vec2,
  target: Vec2,
  speed: number,
  box: Box | null,
): void {
  // Per-axis "closed" threshold. Must stay well under ARRIVE_EPS / √2 so that
  // BOTH axes being closed guarantees the truck is within ARRIVE_EPS of the
  // target (truckSystem's arrival test) — otherwise a spot where each axis is
  // individually tiny but the diagonal isn't would refuse to move yet never
  // count as arrived, and the truck would stall short of its goal.
  const ALIGN = 1
  const ax = Math.abs(target.x - pos.x)
  const ay = Math.abs(target.y - pos.y)
  // Retire a leg whose axis is closed, then pick the longer remaining axis.
  let leg = d.leg
  if ((leg === 'x' && ax <= ALIGN) || (leg === 'y' && ay <= ALIGN)) leg = undefined
  if (!leg) leg = ax >= ay ? 'x' : 'y'
  // Avoid the tower: if this leg would cut through it, turn the other way first.
  if (box) {
    if (leg === 'x' && ax > ALIGN && segHitsBox(pos, { x: target.x, y: pos.y }, box, AVOID_PAD)) leg = 'y'
    else if (leg === 'y' && ay > ALIGN && segHitsBox(pos, { x: pos.x, y: target.y }, box, AVOID_PAD)) leg = 'x'
  }
  d.leg = leg
  if (leg === 'x' && ax > ALIGN) pos.x += Math.sign(target.x - pos.x) * Math.min(speed, ax)
  else if (ay > ALIGN) pos.y += Math.sign(target.y - pos.y) * Math.min(speed, ay)
  else if (ax > ALIGN) pos.x += Math.sign(target.x - pos.x) * Math.min(speed, ax)
}

/** A random spot to dump a pile: anywhere across the scene's walkable middle,
 *  but never on the tower (padded) and never right back at the factory — the
 *  deliveries should pull the snails OUT across the canvas. */
function pickDropPoint(ctx: SimContext, box: Box | null, factory: Vec2): Vec2 {
  const { w, h } = ctx.bounds
  for (let i = 0; i < 12; i++) {
    const p = { x: randFloat(w * 0.1, w * 0.9), y: randFloat(h * 0.25, h * 0.9) }
    const pad = 80 * SCALE
    if (box && p.x > box.minX - pad && p.x < box.maxX + pad && p.y > box.minY - pad && p.y < box.maxY + pad) continue
    if (dist(p, factory) < 150 * SCALE) continue
    return p
  }
  return { x: w * 0.5, y: h * 0.85 } // every roll landed badly → front of stage
}

/** The delivery loop: wait at the factory (the nearest 'supply' prop) until the
 *  crew is nearly dry, then haul a small load to a random drop point, tip it
 *  off as fresh PILE bricks (dropEntity — the render bridge picks them up next
 *  tick), and drive home to reload. A player-dropped truck starts in 'return',
 *  so it first drives to the factory and loads properly. */
export function truckSystem(world: World<Entity>, tick: number, ctx: SimContext): void {
  const box = towerBounds(world) // trucks drive around the tower too
  // Demand signal: bricks still on the ground plus loads already on the road. A
  // pile brick the tower has grown over is walled in and unreachable, so it isn't
  // real supply — exclude it, or the truck reads the crew as stocked and stops
  // delivering while the snails starve beside bricks they can't get to.
  let pile = 0
  for (const e of world.with('brick', 'position'))
    if (e.brick.state === 'pile' && !enclosedByTower(e.position, box)) pile++
  let enRoute = 0
  for (const t of world.with('deliver')) if (t.deliver.state !== 'load') enRoute += t.deliver.load

  for (const t of world.with('deliver', 'position')) {
    const d = t.deliver
    const factory = nearestAffordance(world, t.position, 'supply')
    if (d.state === 'load') {
      if (!factory) continue // no factory in the scene → nothing to deliver
      // Home base: pull up to the loading dock BELOW the factory (a dropped truck
      // lands anywhere), then load.
      const dock = dockOf(factory.position)
      if (dist(t.position, dock) > MOVE.ARRIVE_EPS) {
        driveStraight(d, t.position, dock, d.speed, box)
        continue
      }
      if (tick < d.until) continue // still loading the bed
      if (pile + enRoute > TRUCK.LOW_WATER) continue // crew's still stocked — hold
      d.load = TRUCK.LOAD
      d.drop = pickDropPoint(ctx, box, factory.position)
      d.state = 'haul'
      d.leg = undefined // fresh heading for the drive out
      enRoute += d.load // a second truck this tick sees this load and holds
    } else if (d.state === 'haul') {
      if (!d.drop) {
        d.state = 'return' // drop vanished (shouldn't happen) → head home
        d.leg = undefined
        continue
      }
      driveStraight(d, t.position, d.drop, d.speed, box)
      if (dist(t.position, d.drop) <= MOVE.ARRIVE_EPS) {
        d.state = 'dump'
        d.until = tick + TRUCK.DUMP_DUR
      }
    } else if (d.state === 'dump') {
      if (tick < d.until) continue
      // Tip the load off where we stand — each brick spawns with its own little
      // scatter (the brick's spawn jitter), so the delivery reads as a heap.
      for (let i = 0; i < d.load; i++) dropEntity(world, 'brick', t.position)
      d.load = 0
      d.drop = null
      d.state = 'return'
      d.leg = undefined // fresh heading for the drive home
    } else {
      if (!factory) continue
      const dock = dockOf(factory.position)
      driveStraight(d, t.position, dock, d.speed, box)
      if (dist(t.position, dock) <= MOVE.ARRIVE_EPS) {
        d.state = 'load'
        d.until = tick + TRUCK.LOAD_DUR
        d.leg = undefined
      }
    }
  }
}

// ── gardener (new-behavior character: lay out a plot of vegetable & flower rows)
/** The garden plot, bounds-relative like the builder's tower site so it fits any
 *  scene. `rows` is one crop per row (top→bottom); each row is `cols` plants
 *  filled left→right, with a labelled sign staked at its head. The band sits in
 *  the lower-LEFT of the yard, clear of the tower (which starts ~0.42 w) and the
 *  factory (top-right corner). */
const PLOT = {
  rows: ['carrot', 'tomato', 'cabbage', 'flower'] as PlantVariety[],
  cols: 4,
  x0: 0.06, // left edge (the sign column), as a fraction of bounds width
  x1: 0.36, // right edge (the last plant column)
  y0: 0.5, // top row baseline, as a fraction of bounds height
  y1: 0.9, // bottom row baseline
} as const

/** The crop name shown on a row's sign. */
const VARIETY_LABEL: Record<PlantVariety, string> = {
  carrot: 'CARROTS',
  tomato: 'TOMATOES',
  cabbage: 'CABBAGE',
  flower: 'DAISIES',
  sapling: 'SAPLINGS',
  vine: 'VINES',
}

/** Gardener idle tuning — the paused stretch (ticks) between plantings, so the
 *  rows fill in at a visible, unhurried pace rather than all at once. */
const GARDEN = { IDLE: [15, 45] as [number, number] } as const

/** Ground baseline (page y) of plot row `i` — rows evenly spread across the band. */
function plotRowY(i: number, ctx: SimContext): number {
  const rows = PLOT.rows.length
  const t = rows > 1 ? i / (rows - 1) : 0
  return (PLOT.y0 + (PLOT.y1 - PLOT.y0) * t) * ctx.bounds.h
}

/** Ground point of column `col` in row `i` — columns sit to the RIGHT of the
 *  sign, evenly spaced with a margin at each end. */
function plotCell(i: number, col: number, ctx: SimContext): Vec2 {
  const left = PLOT.x0 * ctx.bounds.w
  const right = PLOT.x1 * ctx.bounds.w
  const t = (col + 1) / (PLOT.cols + 1)
  return { x: left + (right - left) * t, y: plotRowY(i, ctx) }
}

/** Where row `i`'s label sign is staked: the far-left of the band, on the row's
 *  baseline (just ahead of its first plant). */
function plotSign(i: number, ctx: SimContext): Vec2 {
  return { x: PLOT.x0 * ctx.bounds.w, y: plotRowY(i, ctx) }
}

/** Smoothstep — eases a seedling's growth in and out instead of a linear ramp. */
const smooth = (t: number) => t * t * (3 - 2 * t)

/** Advance one plant's growth and re-anchor it so its fixed base stays put (the
 *  sprite's centre rides up as it gets taller). A vine's ceiling is re-stretched
 *  to the current tower top every tick, so it keeps climbing as the courses rise
 *  above it. */
function growPlant(p: Entity, box: Box | null): void {
  const pl = p.plant!
  if (pl.variety === 'vine') {
    // Reach to just past the tower's top (a modest default before any bricks land).
    const climb = box ? pl.base.y - box.minY + 40 * SCALE : 220 * SCALE
    pl.maxH = Math.max(pl.minH, climb)
  }
  if (pl.grow < 1) pl.grow = Math.min(1, pl.grow + pl.rate)
  const e = smooth(pl.grow)
  pl.w = pl.minW + (pl.maxW - pl.minW) * e
  pl.h = pl.minH + (pl.maxH - pl.minH) * e
  p.position.x = pl.base.x
  p.position.y = pl.base.y - pl.h / 2
}

/** The gardener behavior (Builder scene). Two passes each tick: first every
 *  plant creeps toward full size (vines chasing the tower top); then each
 *  gardener works the PLOT — walking to the next empty cell (rows fill in order,
 *  columns left→right), sowing that row's crop there, and staking the row's
 *  label sign the first time it plants into a row. A new component field
 *  (`garden`/`plant`/`sign`) + this system, opted into by the scene's pipeline
 *  — invisible to the builders and truck (they lack it). */
export function gardenerSystem(world: World<Entity>, tick: number, ctx: SimContext): void {
  const box = towerBounds(world) // gardeners route around the tower; vines climb it

  // 1) Growth — every plant, whether or not a gardener is still on site.
  for (const p of world.with('plant', 'position')) growPlant(p, box)

  // 2) Gardeners — fill the plot cell by cell, row by row.
  const gardeners = [...world.with('garden', 'position')]
  if (!gardeners.length) return

  // Live per-row fill: how many plants of each row's crop already exist. Derived
  // from the world (not a running counter) so a deleted plant simply drops the
  // count and the next pass refills the gap — the same self-healing the builder's
  // slots use. Reserving within a tick (bumping this on pick) keeps two gardeners
  // off the same cell.
  const filled: Record<string, number> = {}
  for (const v of PLOT.rows) filled[v] = 0
  for (const pl of world.with('plant')) {
    if (pl.plant.variety in filled) filled[pl.plant.variety]++
  }
  // Rows whose label sign is already staked (so exactly one goes in per row).
  const signed = new Set<string>()
  for (const sg of world.with('sign')) if (sg.sign.variety) signed.add(sg.sign.variety)

  for (const g of gardeners) {
    const st = g.garden
    st.speaking = st.state === 'seek'
    if (st.state === 'idle') {
      if (tick < st.until) continue
      // Next incomplete row → its next empty column.
      let picked: { variety: PlantVariety; row: number; col: number } | null = null
      for (let i = 0; i < PLOT.rows.length; i++) {
        const variety = PLOT.rows[i]
        if (filled[variety] < PLOT.cols) {
          picked = { variety, row: i, col: filled[variety] }
          break
        }
      }
      if (!picked) {
        st.until = tick + randRange(GARDEN.IDLE) // plot's planted out — just tend
        continue
      }
      st.variety = picked.variety
      st.row = picked.row
      st.target = plotCell(picked.row, picked.col, ctx)
      filled[picked.variety]++ // reserve so a second gardener takes a different cell
      st.state = 'seek'
    }

    const target = st.target!
    moveAvoiding(g.position, wobbleClear(g.position, target, tick, st.wander ?? 0, box), st.speed, box)
    if (dist(g.position, target) <= MOVE.ARRIVE_EPS) {
      const variety = st.variety!
      dropEntity(world, variety, target) // sow it — the render bridge grows it
      // Stake the row's label the first time we plant into it.
      if (!signed.has(variety)) {
        const sign = dropEntity(world, 'plantsign', plotSign(st.row ?? 0, ctx))
        if (sign?.sign) {
          sign.sign.label = VARIETY_LABEL[variety]
          sign.sign.variety = variety
        }
        signed.add(variety)
      }
      st.state = 'idle'
      st.until = tick + randRange(GARDEN.IDLE)
      st.target = null
      st.variety = null
    }
  }
}

// ── tally ────────────────────────────────────────────────────────────────────
/** The number the player reads as "busy": concurrent interactions this tick. */
export type InteractionTally = {
  total: number
  buy: number
  bench: number
  greet: number
  restock: number
  flee: number
}

export function tally(world: World<Entity>): InteractionTally {
  let buy = 0
  let restock = 0
  let flee = 0

  const seatedByBench = new Map<Entity, number>()
  for (const p of world.with('dweller')) {
    if (p.dweller.state === 'shop') buy++
    if (p.dweller.state === 'sit' && p.dweller.bench) {
      seatedByBench.set(p.dweller.bench, (seatedByBench.get(p.dweller.bench) ?? 0) + 1)
    }
  }
  let bench = 0
  for (const count of seatedByBench.values()) if (count >= 2) bench++

  let greeters = 0
  for (const p of world.with('interactor')) if (p.interactor.state === 'greet') greeters++
  const greet = Math.floor(greeters / 2)

  for (const v of world.with('vehicle')) if (v.vehicle.state === 'restock') restock++
  for (const b of world.with('perch')) if (b.perch.state === 'flee') flee++

  return { total: buy + bench + greet + restock + flee, buy, bench, greet, restock, flee }
}

// ── orchestrator ─────────────────────────────────────────────────────────────
/** Advance the sim one tick by folding the active scene's `pipeline`, then
 *  report concurrent interactions. The pipeline (not this function) decides
 *  which behaviors run — Busytown's is the seven systems above; other scenes add
 *  or drop systems (e.g. dogSystem) without touching the engine. */
export function runScene(
  world: World<Entity>,
  tick: number,
  ctx: SimContext,
  pipeline: SystemFn[],
): InteractionTally {
  for (const sys of pipeline) sys(world, tick, ctx)
  return tally(world)
}
