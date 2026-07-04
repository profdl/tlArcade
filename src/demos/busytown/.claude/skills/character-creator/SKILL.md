---
name: character-creator
description: >-
  Add a new character to the simTown / busytown canvas — a townsperson, creature,
  vehicle, prop, or a worker with a whole new JOB (a bespoke behavior + the things
  it acts on). Use this whenever the user wants to add, create, reskin, or design a
  new character, creature, animal, vehicle, prop, plant, or job/behavior for the
  town, or asks "how do characters/behaviors work here" — even if they don't say
  the word "character". Covers the art (hand-drawn doodle, native tldraw rect, or
  imported SVG / recolored SVG), the ECS component + system that gives it behavior,
  registering it, wiring it into a scene, testing, and the render-layer gotchas.
---

# Adding a character to simTown

This is a tldraw v5 canvas that behaves like a living little town: the player drops
characters, props, and vehicles and they come alive. The whole point of the
architecture is that **adding content is "write one file + register it", never
editing the engine**. This skill walks you through it and — just as important —
steers you clear of the traps that aren't obvious from the code.

Read this demo's own `CLAUDE.md` (`src/demos/busytown/CLAUDE.md`) first if you
haven't; it's the ground truth for the layering rules and the "verified feel
numbers" you must not drift. (This demo lives inside the
[tlArcade](../../../../../../CLAUDE.md) prototyping platform now — it has no
`package.json` of its own; commands below run from the repo root.)

## The mental model

Three layers, and the split is sacred:

```
sim/       Source of truth. Plain TS + Miniplex (ECS). Imports NOTHING from tldraw.
content/   Swappable data: character & scene registries the engine consumes.
render/    Reads entities, syncs tldraw shapes ~10×/sec. The only seam to the canvas.
```

Everything a character needs is a `CharacterDef` (in `content/characters/`). The
render tables (`render/doodles.ts`) and the render bridge (`render/bridge.ts`)
**derive** from the `CHARACTERS` registry, so most of the time you add art +
behavior and the canvas picks it up with no render edits at all.

There are three extension axes. A new character uses one or more:

1. **Reskin / new look** → a new `CharacterDef` (or a new `skins` entry on one).
2. **New behavior ("job")** → a new optional field on `Entity` + a new `SystemFn`
   a scene opts into via its `pipeline`. Invisible to every other system, because
   they query by the components they need and yours lacks them.
3. **New render type** → `render: 'sprite'` (doodle, the default), `render: 'rect'`
   (a native editable tldraw rectangle), or an `svg` skin (imported artwork).

The best living example is the **gardener** (`content/characters/gardener.tsx` +
`gardenerSystem` in `sim/systems.ts`): a recolored imported worker with a brand-new
job (planting flowers/saplings/vines that grow). Read it alongside this guide — it
exercises every axis.

## Decide what you're building

- **Just a new look, reusing existing behavior?** (e.g. another townsperson skin, a
  van reskin.) You only need a `CharacterDef` whose `spawn()` attaches the SAME
  components an existing kind uses. No new system. Skip to "Author the CharacterDef".
- **A new JOB — a character that does something no existing system does?** You need
  a new component field + a new system. Do the whole flow below. This is the
  interesting case and what most requests mean.

If unsure which behavior to reuse, grep the existing spawns: `townsperson` (whim →
move → dwell → greet), `bird` (perch/flee/flock), `van`/`truck` (drive a route),
`dog` (`chase`), `builder` (`build`), `gardener` (`garden`/`plant`).

---

## Flow: a new character with a new job

Work sim-first (the source of truth), then content, then wiring, then render only
if needed. Concretely:

### 1. Add the component field(s) — `sim/components.ts`

Add optional field(s) to the single `Entity` type. Systems query by which fields
are present (the Miniplex archetype pattern), so a new field is invisible to every
existing system. Model the character's whole state here.

- Timing lives in **ticks**. Any deadline is an ABSOLUTE tick (name it `until`),
  compared against the `tick` passed into the system — never a countdown.
- Keep it a plain data bag: no methods, no tldraw types, no DOM.
- Write the heavy header-style comment explaining the state machine — these
  comments double as the design spec here.

```ts
// --- beekeeper (Meadow scene; see sim/systems.ts → beekeeperSystem) ---
// Walks between flowers collecting nectar, returns to the hive to deposit it.
// `until` is the absolute tick a dwell ends; `load` is nectar carried.
bee?: {
  state: 'seek' | 'sip' | 'return'
  target: Vec2 | null
  speed: number
  until: number
  load: number
}
```

### 2. Write the system — `sim/systems.ts`

A system is a `SystemFn = (world, tick, ctx) => void` that queries archetypes and
mutates fields in place. Rules that keep the layer honest:

- `sim/` imports **nothing** from tldraw. Deterministic given `Math.random` (use the
  helpers in `sim/rng.ts`: `randInt`, `randRange([min,max])`, `randFloat`, `choice`).
- Read scene extent from `ctx.bounds` (a `SimContext`), never a module constant, so
  your system works in any scene.
- Query with `world.with('bee', 'position')`. Move with `stepToward` /
  `moveAvoiding` (the latter routes around the builder's tower — reuse it if your
  character shares a scene with the tower).
- To create entities live (a beekeeper depositing honeycomb, a gardener sowing a
  plant), call `dropEntity(world, kind, at)` — the render bridge picks it up next
  tick.

Match the shape of the existing new-behavior systems (`dogSystem`, `builderSystem`,
`gardenerSystem`). If your character both ACTS and spawns growing/among things,
one system can run two queries (e.g. `gardenerSystem` grows all plants, then walks
each gardener) — that's idiomatic here.

Export the system so scenes can import it.

### 3. Author the CharacterDef — `content/characters/<name>.tsx`

Create a new file (mirror `fairy.tsx` / `gardener.tsx`) exporting a
`*_CHARACTERS: CharacterDef[]`. A `CharacterDef` gathers art, size, color, the
`spawn()` constructor, the palette button, and the thought bubble in one place.

```ts
const beekeeper: CharacterDef = {
  kind: 'beekeeper',
  size: 96,
  color: 'yellow',
  art: [ /* doodle strokes, see "Art" below */ ],
  walk: { limbs: [[6], [7]], swing: 20, faces: 'left' }, // if it walks
  spawn: (at) => ({
    kind: 'beekeeper',
    position: { x: at.x, y: at.y },
    sprite: { shape: 'beekeeper' },   // shape key === kind; drives both art & behavior
    bee: { state: 'seek', target: null, speed: MOVE.WALK, until: 0, load: 0 },
  }),
  palette: { label: 'Beekeeper', icon: <Icon name="person" /> },
  thought: (e) => (e.bee?.state === 'return' ? 'Back to the hive' : ''),
}
export const MEADOW_CHARACTERS: CharacterDef[] = [beekeeper /*, hive, flower… */]
```

Notes:
- `spawn(at)` is the SINGLE constructor used by both the initial roster and live
  drops. Stagger any initial timer (`until: stagger(40)`) so a fresh roster doesn't
  act in lock-step.
- `thought(e)` returns the bubble line for the current state (`''` = no bubble).
  For rotating/no-repeat lines in the town's philosophical register, use
  `pickUnique(poolKey, POOL, seed)` from `content/characters/speech.ts` with a
  STABLE seed (so the bubble doesn't flicker frame to frame).
- A **prop** is just a CharacterDef whose `spawn()` attaches an `affordance`
  (`{ tags, capacity, occupants }`) and no behavior — actors seek it by whim.
  Advertise a brand-new affordance tag (an open string) and any system can look for
  it via `nearestAffordance(world, from, tag)`.

### 4. Register it — `content/characters/index.ts`

Import your `*_CHARACTERS` array and spread it into `ALL`. That's the whole
registration; `CHARACTERS`, the render tables, and the palette all derive from it.

### 5. Wire it into a scene — `content/scenes/<scene>.ts`

A `SceneDef` is bounds + props + roster + pipeline + palette. To bring the character
to life in a scene:

- add your `SystemFn` to `pipeline` (order matters if it depends on another system's
  output; otherwise append),
- add the kind to `roster` (with a `placement`) and/or `palette` (droppable button),
- add any props it needs (a hive, a pond) to `props`.

A system in a scene's pipeline runs every tick even with zero matching entities
(the query is just empty), so adding it is cheap and safe — including in the
**Busytown** anchor scene, though prefer proving new behavior in its own scene.

> Do NOT touch Busytown's verified LAYOUT / START / roster numbers or `config.ts`
> engine tuning — those are measured, not guessed (see CLAUDE.md).

### 6. Render layer — usually nothing, sometimes a touch

The bridge derives sprites from the registry, so most characters need **no render
edit**. You only touch `render/` for these specific needs:

- **Sim-driven per-entity size** (the sprite grows/shrinks or is sized by the sim,
  like `brick` and `plant`): the bridge reads the shape's own w/h for normal
  sprites. To let the sim own the size, add a size accessor and branch it in
  `ensureShapes` + `sync` (copy the `plantSize` / `brickSize` pattern in
  `render/bridge.ts`). Non-square sprites already work — the sprite `<svg>` uses
  `preserveAspectRatio="none"` so `w`/`h` define the box.
- **A carry pose** (different art while hauling something): give the skin an
  `svgCarry` with the SAME part order as `svg` for any leg the walk rig references,
  and optionally a `carryOffset` for where the held object rides.
- **A bubble that floats too high** for art drawn low in its box (vehicles): add the
  kind to `ART_TOP_FRAC` in `render/SpriteShapeUtil.tsx`.
- **A new palette glyph**: add an entry to `PATHS` in `render/icons.tsx` (a 24px
  monochrome stroke icon) and reference it via `<Icon name="…" />`.

### 7. Test, then verify in the app

- **Unit-test the system** in `sim/systems.test.ts`: build a minimal world by hand
  (not `buildWorld`), stub `Math.random` only where the system rolls one, and assert
  the state machine. Follow the `truckSystem` / `gardenerSystem` blocks.
- If the character joins a balanced scene (e.g. Builder's supply chain), make sure
  the existing soak test still passes — it now runs your system too.
- From the **repo root**, run: `npm test` (vitest, whole repo), `npm run build`
  (tsc + vite, whole repo), `npm run lint` (eslint, whole repo).
- **Verify visually.** Start the preview from the repo root and visit
  `/demos/busytown`. DEV globals `window.__world`, `window.__editor`,
  `window.__tick` let you inspect state and drive the editor from
  `preview_eval`. Watch the character
  actually do its job, and screenshot it.

---

## Art: three ways to draw a character

Pick per skin via `render` (and the `skins` map for anything but a plain doodle).

- **Doodle sprite (`render: 'sprite'`, the default).** Hand-inked strokes in a
  **0–100 box**, built with the `freehand.ts` helpers: `seg`, `poly`, `ring`,
  `capsule`, wrapped in `s(pts, weight, closed?, bg?)`. Weights are `'s'|'m'|'l'|'xl'`
  (tldraw Draw widths). `closed` fills area; `bg: true` paints an opaque white
  backing so an earlier stroke doesn't show through (e.g. a head over wings). Color
  comes from the shape's tldraw `color` style, applied uniformly — doodles are
  single-color. Draw a walking figure facing left or right and declare `faces`.
- **Native rect (`render: 'rect'`, needs `rect: {w,h}`).** A real, editable tldraw
  geometry rectangle — use when the built result should be genuine tldraw content
  (the builder's bricks). The sim can override per-entity size via a component field.
- **Imported SVG (`skins: { x: { render: 'svg', svg: [...] } }`).** Finished filled
  artwork exported from tldraw's Draw tool: one `SvgArtPart` per `<g transform>`,
  paths kept literal (their own fills). Use `tx/ty/scale` for axis-aligned groups or
  a 6-value `matrix` for rotated/skewed ones. **To recolor an existing import** (the
  gardener = the builder's hard-hat worker, orange→green), map the fill/stroke on a
  clone — see `recolor()` in `gardener.tsx`; don't re-trace the art.

### The walk rig

If the character moves, add `walk: { limbs, swing, faces }`. `limbs` groups
stroke/svg-part indices into legs that swing in alternating phase about their hip;
the whole figure mirrors to face travel. `limbs: []` buys just the facing-flip (a
gliding snail, a truck that points where it drives). The rig is derived from the
art's indices — if you add a carry pose, keep the leg indices aligned across both
arrays.

---

## Gotchas learned the hard way

- **The sim owns sim-sized shapes.** If the sim drives a shape's position or size
  every tick (bricks, plants), a player drag/resize snaps back next tick unless you
  re-anchor from the shape's live centre (see the plant re-anchor in
  `render/bridge.ts`, both the running-transform and paused read-back paths).
  Ordinary characters keep their own position when grabbed — the sim resumes from
  wherever they land — so this only bites sim-owned sizing.
- **Targets on the tower's padded box never arrive.** `moveAvoiding` routes AROUND
  the tower with a clearance pad, so a target sitting ON that padded boundary
  deflects the mover forever (it never gets within `ARRIVE_EPS`). Place any target
  a character must reach *clear* of the pad — see `vineFoot` offsetting the vine's
  planting spot by `AVOID_PAD + ARRIVE_EPS`.
- **Non-square sprites** only fill their box because the sprite `<svg>` sets
  `preserveAspectRatio="none"`. If you add a rendering path, preserve that.
- **Keep `sim/` pure.** No tldraw imports, no DOM, deterministic given the RNG. If
  you reach for a tldraw type in a system, you've crossed a layer — the fix is
  almost always a component field the render layer reads instead.
- **Prefer archetype queries over `kind` switches.** `world.with('bee')`, not
  `if (e.kind === 'beekeeper')`. Kinds and affordance tags are OPEN strings by
  design — a scene can introduce a new one with no union edit.

## Checklist

1. `sim/components.ts` — component field(s), tick-based state, header comment.
2. `sim/systems.ts` — exported `SystemFn`, archetype queries, `ctx.bounds`, RNG helpers.
3. `content/characters/<name>.tsx` — `CharacterDef` (art, size, color, spawn, palette, thought).
4. `content/characters/index.ts` — register the `*_CHARACTERS` array.
5. `content/scenes/<scene>.ts` — pipeline + roster + palette (+ props).
6. `render/` — only if sim-driven size, carry pose, bubble offset, or a new icon.
7. `sim/systems.test.ts` — unit-test the state machine; keep existing soaks green.
8. From the repo root: `npm test && npm run build && npm run lint`, then verify + screenshot in the preview at `/demos/busytown`.
