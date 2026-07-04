# CLAUDE.md — Busytown / simTown

> **This is one prototype in the [tlArcade](../../../CLAUDE.md) platform**,
> mounted at `/demos/busytown`. It has no `package.json`/build/dev-server of
> its own anymore — everything under "Commands" runs from the **repo root**.

A tldraw (v5) canvas that behaves like a living little town. The player drops
characters, props, and vehicles onto the canvas and they come alive — always
active, with ~1–2 interactions happening at any moment. The "alive" feeling
comes from **legible activity and local interactions**, not from a balanced
ecology. It is a deliberately *faked* simulation: no energy economy, nothing
conserved. (An earlier predator–prey path was abandoned for this reason.)

This prototype's folder / architecture is referred to as **simTown**: a
scene-agnostic ECS **engine** with swappable **content modules** layered on
top. (`busytown` was its standalone package name before migrating in here.)

## Commands (from the repo root)

```bash
npm run dev        # http://localhost:5173/demos/busytown
npm run build      # tsc -b && vite build for the whole app (type-checks this demo too)
npm test           # vitest run — includes this demo's tests
npm run lint       # eslint, whole repo (this demo used oxlint standalone; see root eslint.config.js for the relaxed rules carried over)
```

The behavior spec lives in `sim.py` (a headless Python "feel-sim") and in the
prose docs (`HANDOFF.md`, the header comment in every `sim/` file).

**Tests** use **Vitest** under a jsdom environment:
- `sim/*.test.ts` — pure-sim unit tests. The `sim/` layer is tldraw-free and
  deterministic given `Math.random`, so systems are tested by building minimal
  worlds by hand and stubbing the RNG only where a system rolls one.
- `render/bridge.test.tsx` — the render seam, end to end: it mounts a REAL
  tldraw `<Editor>` (via `<Tldraw onMount>`) with the app's `SpriteShapeUtil` and
  drives `startBridge` against it (shape create / position sync / paused
  read-back / delete-prune).
- The jsdom shims tldraw needs (ResizeObserver, matchMedia, `CSS.supports`,
  `document.fonts`, canvas 2d context, `Image.decode`) now live in the shared
  root [src/test/setup.ts](../../test/setup.ts) — Face Mask needs the same
  shims, so they were consolidated rather than duplicated per demo.

Test files are still excluded from `tsconfig.app.json`'s build (so `tsc -b`/
`npm run build` ignores them); Vitest picks them up directly.

## The three-layer split (never violate)

```
sim/       Source of truth. Plain TS + Miniplex (ECS). Imports NOTHING from tldraw.
content/   Swappable data modules: character & scene registries the engine consumes.
render/    Reads entities, syncs tldraw shapes ~10×/sec. The only seam to the canvas.
tldraw     Canvas + interaction (custom SpriteShapeUtil, kept lightweight).
```

`sim/` must stay tldraw-free. `sprite.shape` is just a string the render layer
maps to a shape util — that indirection is what preserves the split.

## Runtime loop

`render/bridge.ts` → `startBridge()` runs a `setInterval` at `TICK_MS` (100 ms,
10 fps). Each tick, when not paused:
1. `runScene(world, tick, ctx, pipeline)` folds the scene's system pipeline, then
   returns an `InteractionTally` (the "N active" number in the HUD).
2. `sync()` diffs entity positions onto tldraw shapes.

**All canvas writes go through `editor.run(..., { history: 'ignore', ignoreShapeLock: true })`**
so the sim never pollutes the undo stack. Every shape is drag/resize/rotate/delete-able:
- While **running**, a shape the player is transforming has its live centre read
  back into the entity (behavior resumes from the new spot/size).
- While **paused**, the sim freezes and the bridge only reads shapes back, so the
  player can rearrange the whole town, then press play to continue from it.
- Deleting a shape prunes its entity (and releases any bench seat it held).

Entities created live by `dropEntity()` are picked up on the next tick by
`ensureShapes()` — the "comes alive" hook from the canvas side.

## ECS model (`sim/components.ts`)

One `Entity` type with optional fields; **systems query by which components are
present** (Miniplex archetype pattern), never by a `kind` string switch.
`EntityKind` and `AffordanceTag` are OPEN strings — a scene can introduce a new
prop kind or affordance just by registering a `CharacterDef`, with no union edit.

- `buildWorld(scene)` — instantiate props first (so actors have affordances to
  seek on their first whim), then roster, each via the kind's `CharacterDef.spawn()`.
  A scene may supply a custom `build()` override.
- `dropEntity(world, kind, at)` — thin delegate over the registry for live drops.

## Systems (`sim/systems.ts`)

Each system is a `SystemFn = (world, tick, ctx) => void`. Scene-scoped globals
(currently just `bounds`) are threaded via `SimContext` — systems never read
module-level layout. Timing is in **ticks**; `*.until` fields hold ABSOLUTE tick
values compared against the current `tick`.

Busytown's pipeline (order matters): `whim → move → arrive → dwell → greet →
bird → van`, with `tally` always run afterward by `runScene()`. Additional
scenes append behaviors: `dogSystem` (Pondside), `builderSystem` + `truckSystem`
(Builder).

The one core mechanic: props advertise **affordances** (`sit`, `shop`, `home`,
`perch`, `drink`…); a townsperson rolls a **whim** (`WHIM_WEIGHTS`), seeks the
nearest matching affordance, walks over with visible intent, and dwells.

## Content registries (the extension surface)

Three extension axes, **no engine edits required**:

- **Reskin / new character** → add a `CharacterDef` (`content/characters/`). One
  self-contained bundle per kind: art, size, color, `spawn()`, palette entry,
  `thought()`. `render/doodles.ts` and `render/bridge.ts` DERIVE from the
  `CHARACTERS` registry — adding a character is "one file + register", not editing 5+.
- **New behavior** → a new `Entity` component field + a new `SystemFn` a scene
  opts into via its `pipeline`. Invisible to every other system (they lack the
  component). See `dogSystem` / `chase`, `builderSystem` / `build`+`brick`.
- **New render type** → `CharacterDef.render`: `'sprite'` (default, hand-drawn
  doodle) or `'rect'` (a NATIVE editable tldraw geo rectangle, via `rect:{w,h}`).
  The builder's bricks are real tldraw rectangles.

Scenes (`content/scenes/`, a `SceneDef` = bounds + props + roster + pipeline +
palette):
- **Busytown** — the default and the **behavior-preservation anchor**. Carries
  the exact verified LAYOUT/START/CANVAS numbers. Don't drift these.
- **Pondside** — proof scene: new `pond` prop advertising a new `drink`
  affordance + a `dog` (new behavior via `dogSystem` in its pipeline).
- **Builder** — snail builders stack delivered bricks into a 4-wide tower
  (`builderSystem`); bricks are geo rects. Starts with NO bricks: a truck hauls
  small piles from a far-off `factory` (new `supply` affordance) to random drop
  points, just-in-time (`truckSystem` departs when pile + in-transit supply ≤
  `TRUCK.LOW_WATER`) — the crew is always nearly out but rarely idle; out of
  bricks, the snails chat snail sports in the break area.

App holds the active `sceneId`; the HUD `<select>` triggers a full teardown +
rebuild of the world and bridge.

## Verified "feel" numbers — do NOT re-derive

Measured over 6 seeds of the Python feel-sim (`sim.py`); ported into
`sim/config.ts`, which holds ENGINE tuning only (no scene layout/roster):
- Start roster: 7 townsfolk, 4 birds, 2 benches, 1 stall, 3 houses, 3 trees, 1 van.
- Lands at ~1.7 concurrent interactions; something happening ~87% of the time;
  pile-ups (4+) only ~7%.
- **Townsfolk count is the only dial that matters**; birds are garnish. Start low
  (7) on purpose so the player's additions push it toward bustling.
- Two knobs to retune density without changing counts: interaction **duration**
  and **GREET_RADIUS** (both in `config.ts → TIMING`).
- `TICK_MS = 100` — do not raise. `SCALE = 2` scales distances/radii/speeds (not
  tick-durations), so the cadence is preserved while sprites stay big enough to
  carry tldraw's absolute stroke weights.

## Dev-only inspection

Via `preview_eval` (or the browser console) on `/demos/busytown`:
`window.__editor`, `window.__world`, `window.__tick`.

## Conventions

- Keep `sim/` pure — no tldraw imports, no DOM, deterministic given the RNG.
- Prefer archetype queries (`world.with(...)`) over `kind` checks in systems.
- When adding content, extend a registry; don't special-case in the engine.
- Match the existing heavy header-comment style in `sim/` and `content/` files —
  they double as the design spec.
