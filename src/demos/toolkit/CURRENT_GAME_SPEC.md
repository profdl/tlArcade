# Build Spec: "Current" — a tidal field game on the tldraw v5 canvas

> **You are a coding agent.** You have been given an **empty directory**. Your job is to
> assemble two official tldraw starter kits, upgrade everything to the latest tldraw **v5**,
> and build the game described below. Read this whole document before writing any code.
> When a step says "verify," actually run the command and fix errors before moving on.

---

## 0. TL;DR of what you're building

**Current** is a 2-player, multiplayer canvas game where:

- A full-canvas **WebGL shader** renders a living **fluid field** (currents, heat, light).
- Small **autonomous creatures** drift *in* that field — the field pushes them.
- An invisible **dependency graph** turns the player's on-canvas pieces ("emitter" shapes)
  into the **field's parameters** (flow direction, turbulence, heat sources). Moving/placing
  an emitter rewires the graph; the graph resolves to a small set of **shader uniforms**.
- Emitters cost **energy** from a regenerating pool, so the core decision is *spend now or bank
  for a bigger play*, and placing emitters near each other **combos** them into a more
  efficient field "machine" — that proximity-wiring IS the invisible dependency graph.
- The same field math is sampled in JS so creatures steer by it.
- **Win condition (territory):** two players place opposing emitters to shape the current;
  whoever's field captures more drifting creatures into their goal edge wins.

> **⚠ The game mechanics in this spec are already BUILT, TUNED, and PROVEN FUN** in a headless
> simulator under `design/`. Do **not** re-derive the field rules, economy, or constants from the
> prose here — **port the simulator's pure modules verbatim** (see §1d and §3). The prose exists
> to explain *why*; `design/sim/*.mjs` is the source of truth for *what*. Re-inventing the
> mechanics will reproduce the un-fun early versions the simulator already discarded.

The three layers and their contract:

```
  player moves an emitter shape   (canvas interaction)
            │
            ▼
  dependency graph re-resolves    (discrete logic — invisible, no node UI)
            │  outputs a FieldState object: { flowAngle, turbulence, sources[], ... }
            ├──────────────────────────────┐
            ▼                               ▼
  shader uniforms (WebGL)          field sampler (JS)
  → the sea redraws everywhere     → creatures read local flow vector and get pushed
```

**The one rule to never violate:** the FieldState produced by the graph is the *single source
of truth*. The shader and the creature-steering sampler are two **consumers** of it. They must
use the **same field math** so what you see (shader) matches what creatures feel (steering).

---

## 1. Source material — what to download and combine

You are merging **two official tldraw starter kits** plus borrowing **patterns** (not files)
from a reference game repo. All tldraw code is MIT-licensed.

### 1a. Base / multiplayer foundation — **REQUIRED**
Scaffold the **sync-cloudflare** template as your skeleton (it gives you the client + Cloudflare
Worker + `@tldraw/sync` multiplayer wiring you need for a 2-player game):

```bash
npm create tldraw@latest -- --template sync-cloudflare
```

- Source: <https://github.com/tldraw/tldraw/tree/main/templates/sync-cloudflare>
- This becomes your project root. It runs client (Vite) + worker (wrangler) together via `yarn dev`.

### 1b. Shader background layer — **REQUIRED**
Scaffold the **shader** template separately and copy its WebGL engine in:

```bash
npm create tldraw@latest -- --template shader   # into a temp dir, then copy files across
```

- Source: <https://github.com/tldraw/tldraw/tree/main/templates/shader>
- **Copy in:** `src/WebGLManager.ts` (the base class) and the **Fluid** example
  (`src/fluid/`) as your starting point — its Navier-Stokes simulation IS the field.
  You will heavily modify the Fluid manager so its forces come from FieldState, not just pointer input.
- The `WebGLManager` base class gives lifecycle hooks: `onInitialize()`, `onUpdate()`,
  `onRender()`, `onDispose()`, and receives the live `editor`. The shader mounts as a
  **background component** behind the tldraw canvas (use the `components={{ Background: ... }}`
  slot — see §5).

### 1c. Reference patterns only — **DO NOT depend on, just learn from**
The `tldraw-game-toolkit` repo (the repo this spec came from) demonstrates the exact
patterns you need: custom shapes with native styles, editor behaviours in `register*.ts`
that ride `editor.on('tick')`, autonomous creature steering, and a server-authoritative
"referee." If you have access to it, read `client/creature/registerSwimming.ts`,
`client/physics/registerPhysics.ts`, and `SPEC.md` for the steering + native-first patterns.
Everything you strictly need is also restated in this doc.

### 1d. The proven game core — **PORT THIS VERBATIM, do not reinvent**
The `design/` directory (shipped alongside this spec) is a **headless simulator** where the game's
mechanics were built and **balance-tuned across 600 simulated matches** before any rendering
existed. Its pure modules ARE the balanced core — copy them in and wrap rendering around them:

- `design/sim/field.mjs` → port to `src/field/field.ts` — `resolveField` (the graph execution)
  and `sampleField` (local flow vector). **This is the single most important file.**
- `design/sim/economy.mjs` → port to `src/field/economy.ts` — the regenerating-energy rules.
- `design/sim/tuning.mjs` → port to `src/field/tuning.ts` — **every tuned constant.** Do not
  change these numbers without re-running the balance harness (see below).
- `design/sim/field.test.mjs` → keep as a test of your ported `field.ts` (it's pure, no editor).

Porting = converting `.mjs` → `.ts` (add types; the logic is unchanged) and swapping the sim's
plain `{x,y,...}` emitter objects for ones derived from your tldraw `EmitterShape`. **Read
`design/DESIGN.md` first** — it explains the mechanics, the proven balance, and the known
open tuning notes. The simulator still runs (`node design/sim/balance.mjs 120`); use it as a
regression check if you ever touch the constants.

---

## 2. Upgrade everything to the latest tldraw v5

The latest published version is **tldraw v5.1.x** (v5.1.1 at time of writing). Do this
before building:

1. In the merged project, set every tldraw dependency to the latest v5:
   ```bash
   yarn add tldraw@latest @tldraw/sync@latest @tldraw/sync-core@latest @tldraw/tlschema@latest
   ```
   (Match the **same** version across all `@tldraw/*` packages — mismatched minor versions
   cause schema/runtime errors.)
2. The shader template may have been authored against a slightly different version — after
   copying its files in, reconcile any API drift against the **installed types** in
   `node_modules/tldraw` and `node_modules/@tldraw/editor` rather than guessing.
3. **Verify the upgrade compiles before writing game code:**
   ```bash
   npx tsc --noEmit
   ```
   Zero errors is the bar. Fix all drift now, not later.

### v5 API gotchas you MUST get right (these break silently otherwise)

These are non-obvious and your training data likely has the older (v2/v3/v4) forms. Get them
wrong and you get confusing type errors or shapes that fail to sync.

1. **Register a custom shape's type via module augmentation.** `TLShape` is a closed union in v5.
   Every custom shape file needs:
   ```ts
   declare module 'tldraw' {
     interface TLGlobalShapePropsMap { emitter: EmitterShapeProps }
   }
   ```
   Without it: *"Type 'X' does not satisfy the constraint 'TLShape'"*.
2. **Extend `ShapeUtil<MyShape>`, NOT `BaseBoxShapeUtil`.** `BaseBoxShapeUtil` is reserved for
   built-ins in v5. Implement `getGeometry()` returning a `Rectangle2d` (or other `Geometry2d`).
3. **Selection outline is `getIndicatorPath(shape)` returning a `Path2D`** — not a JSX `indicator()` method.
4. **Bindings augment a different map:**
   ```ts
   declare module 'tldraw' { interface TLGlobalBindingPropsMap { mybinding: Props } }
   ```
5. **Register custom shapes in TWO places with IDENTICAL validators, and keep the default set in
   lockstep on both sides.** `useSync({ shapeUtils })` builds the synced schema from *exactly*
   the utils array you pass — it does **not** auto-add built-ins. So:
   - Client: your `shapeUtils` array must spread `...defaultShapeUtils` **and** your custom utils,
     and it's passed to BOTH `useSync({ shapeUtils })` and `<Tldraw shapeUtils={...}>`.
   - Worker: the schema fed to `createTLSchema` must spread `...defaultShapeSchemas` **and** your
     custom shape validators (put validators in a **shared** module imported by both sides).
   - Include the defaults on **both** sides or **neither**. A mismatch makes the sync handshake
     reject every client at connect with **`CLIENT_TOO_OLD`** (misleading name: it means
     "schemas differ", not "stale client"). Same applies to bindings (`defaultBindingUtils` /
     `defaultBindingSchemas`).
6. **Per-frame motion is "native-first."** Ride `editor.on('tick', elapsedMs => …)` —
   do NOT spin your own `requestAnimationFrame`. Move a shape by writing `shape.x/y` directly,
   wrapped in `editor.run(fn, { history: 'ignore' })`; sync replicates positions for free.
   Never sync per-frame velocity yourself. Read pointer velocity via `editor.getPointerVelocity()`.
7. **Use NATIVE style props** (`DefaultColorStyle`, `DefaultSizeStyle`, `DefaultFillStyle` from
   `@tldraw/tlschema`) for color/size/fill so shapes share the global palette and style panel.
   Resolve a color to hex like the built-ins do:
   `getColorValue(editor.getCurrentTheme().colors[editor.getColorMode()], color, 'solid')`.
   Note: `STROKE_SIZES` and `getDefaultColorTheme` are **not** exported in this version — mirror
   stroke sizes as a local const and use `editor.getCurrentTheme()`.
8. **Anything secret or random goes through the worker (referee), never `shape.props`.** The sync
   document is visible to every client. For this game that means the **creature spawn seed and the
   win-count tally** should be server-owned if you want them tamper-proof (see §6, optional).

---

## 3. The dependency-graph engine (the "execution" layer — invisible)

This is the **execution graph** from the workflow starter kit's idea, but with **no node UI**.
The player never sees nodes or wires. The graph is rebuilt from canvas state and resolved to a
`FieldState`.

### 3a. The nodes are real game shapes
- **Emitter shapes** (custom shape, §4) are the source nodes. Each has props: `kind`
  (`'current' | 'heat' | 'vortex'`), `strength`, `angle`, and an `owner` (`'A' | 'B'`).
- **Edges are spatial**, not drawn: build the graph each change from **proximity / overlap**
  using `editor.getShapeAtPoint(center, { filter, hitInside })` or distance between emitter
  centers. Two emitters within range influence the same field region. (This reuses the
  hit-testing pattern, not a visible wire.)

### 3b. The engine: resolve graph → `FieldState` — **already built; port `field.mjs`**
This is `design/sim/field.mjs`. **Port it; do not rewrite it from this prose.** It exports two
pure functions (no editor/DOM, unit-testable):

```ts
// emitter:  { id, owner:'A'|'B', kind:'current'|'heat'|'vortex', x, y, angle, strength, active }
export function resolveField(emitters): FieldState   // the "graph execution" / combo pass
export function sampleField(state, x, y): { fx, fy }  // local flow vector at a page point
```

`resolveField` runs a **combo pass** over every nearby emitter pair (proximity within
`tuning.comboRange` = the invisible "wiring") and applies the **proven, balanced rules**:

**Same-owner synergies — build a "machine":**
- **vortex + friendly current → WIDENS the current's coverage** (radius up to +~70%) and
  amplifies it a little. *This is THE key mechanic:* it gives a concentrated build *reach*, so
  it can compete with currents spread thin across lanes. Coverage-vs-concentration is the
  central strategic axis. (Do not regress this to "amplifies turbulence" — that earlier guess
  was wrong and made combos useless.)
- **heat + friendly current → BENDS** the current's angle toward the heat (cheap steering;
  heat has **no push of its own**).
- **agreeing friendly currents → MERGE** into a stronger stream.

**Cross-owner counterplay (soft rock-paper-scissors):**
- opposing currents **CANCEL** where they meet head-on,
- an enemy **vortex SCATTERS** a current (beats brute force without out-pushing it),
- heat-bent currents **dodge** a scatter (so heat counters the vortex-disruptor).

`sampleField` sums each emitter's contribution with a smooth radial falloff: a `current` pushes
along its angle, a `vortex` adds tangential curl, `heat` contributes nothing (it only bent
currents during resolve). **This is the shared math** — the shader visualizes it and creatures
steer by it (the "one FieldState, two consumers" rule, §9).

`FieldState` carries the resolved `effects[]` (what `sampleField` reads) plus scalar summaries
(`globalFlowAngle`, `turbulence` 0..1) that the shader uses as global uniforms.

### 3c. Re-resolve on change, not per frame
- Listen to store changes (`editor.store.listen` / `registerAfterChangeHandler`) to know when an
  emitter moved/was added/removed. **Recompute `FieldState` only then**, not every frame.
- Beware the deferred-flush recursion trap: collect changed ids cheaply in the change handler,
  do the real recompute once in an operation-complete handler, keep a re-entry guard, and skip
  while `editor.isIn('select.translating')` if it thrashes.
- Store the current `FieldState` in a module-level atom/ref both consumers read.

---

## 3.5 The economy — the scarcity that makes it a game (port `economy.mjs`)

Without scarcity the optimal play is "spam emitters at your goal" — solved and unfun. The
**regenerating-energy pool** (`design/sim/economy.mjs`, port to `src/field/economy.ts`) is the
proven fix. Every constant is in `tuning.mjs` — **port them, don't re-pick them.**

- Each player has an energy pool that **regenerates over time** (`regenPerSec`), capped at
  `maxEnergy`, starting at `startEnergy`.
- Placing an emitter costs a **one-time `placeCost`** and adds a **per-second `drainPerSec`**
  while it's active. Kinds differ (vortex is priciest, heat cheapest).
- Regen is tuned so a **focused ~3-emitter build is sustainable but a 5–6 carpet browns out.**
  That tension is the whole point. There's a hard `maxEmittersPerPlayer` cap too.
- **Brown-out:** if drain exceeds the pool, the **cheapest active emitters auto-deactivate** until
  it balances. So over-extending is a real, punishing decision — not a soft cap.

This is why the simulator's `idle` (do-nothing) bot wins **0.6%** while no strategy exceeds ~67%:
energy forces commitment, and the field (player skill) decides outcomes. In the real game, surface
each player's energy in a small HUD (`components` slot) and gate the emitter tools on
`canPlace(...)` so you can't place what you can't afford.

---

## 4. The Emitter custom shape

Follow the v5 custom-shape recipe (§2 gotchas 1–5,7).

- `src/shapes/EmitterShape.tsx`: `EmitterShapeUtil extends ShapeUtil<EmitterShape>`.
- Props: `kind`, `strength`, `angle`, `owner`, plus native color (use `DefaultColorStyle`;
  owner A vs B can map to two palette colors so it reads at a glance).
- `getGeometry()` → small `Rectangle2d`. `getIndicatorPath()` → `Path2D`.
- `component()` renders a simple SVG glyph indicating kind + direction (an arrow for `current`,
  a glow for `heat`, a spiral for `vortex`). Keep it cheap; it does NOT animate per-frame —
  the *field* animates, the emitter is static.
- Validators live in a **shared** module (`src/shared/shape-schemas.ts`) imported by the client
  registry AND the worker schema (gotcha #5).
- Register in the client `shapeUtils` array (spread with `...defaultShapeUtils`) and add the
  validators to the worker's `createTLSchema` (spread with `...defaultShapeSchemas`).
- Add a **tool** (a `StateNode` in the tools array) + toolbar buttons so a player can drop each
  emitter kind. Two players, two owners — derive `owner` from the player's seat/session.

---

## 5. The shader background — fluid field driven by FieldState

- Mount the shader as the **`Background` component** of `<Tldraw>`:
  ```tsx
  const components: TLComponents = { Background: FluidBackground }
  ```
  `FluidBackground` instantiates your `FluidFieldManager` (subclass of the copied `WebGLManager`),
  passing the live `editor`.
- In the manager's `onUpdate()`: read the current `FieldState` (from the atom in §3) and the
  camera (`editor.getCamera()`), convert source page-coords → viewport (`editor.pageToViewport`),
  and **push them as uniforms**: `uFlowAngle`, `uTurbulence`, `uSources` (array of vec3:
  x, y, strength), `uTime`, `uResolution`, `uCameraZoom`.
- The fluid sim's injected forces come from the **sources**, not (only) the pointer. A `current`
  source injects directional velocity; a `vortex` injects curl; a `heat` source injects
  buoyancy/color. The Navier-Stokes step then propagates it across the whole canvas — that
  propagation is the "consequence rippling everywhere" you want.
- Keep it aligned to the canvas as the camera pans/zooms (the base `WebGLManager` already
  syncs viewport/resolution — use its hooks, don't fight them).
- **Color by owner** so the contested front between A's and B's currents is visible — that front
  IS the readable game state.

---

## 6. The creatures — drift in the field

- `src/creature/CreatureShape.tsx`: a tiny custom shape (or reuse a simple one). Props include a
  synced `seed` and `speed`; motion is a pure function of seed + field + clock so nothing
  per-frame goes in the store (sync-free).
- `src/creature/registerSwimming.ts`: an editor behaviour (returns a disposer) registered from
  `<Tldraw onMount>`. The **per-creature motion is already written and tuned** — it's the `step()`
  creature loop in `design/sim/match.mjs`. Port that integration; wrap it in the native-first
  shell. Each `editor.on('tick', elapsedMs => …)`:
  - For each creature, sample the field: `const { fx, fy } = sampleField(fieldState, c.x, c.y)`.
  - Steer using the **proven constants in `tuning.mjs > creatures`**: blend a low free-swim
    `speed` + small `wander` jitter with the field force scaled by `fieldGain`, apply `drag`,
    clamp to `maxSpeed`. **`fieldGain` must dominate `wander`** — that ratio is the difference
    between "the field steers the creatures" (fun) and "creatures drift randomly" (the early
    un-fun version where doing nothing won 48% of games). Don't eyeball these; port them.
  - Make it frame-rate-independent via `elapsedMs` (the sim uses a fixed `dt`; scale by real
    elapsed time in the live game).
  - Write new `x/y/rotation` inside `editor.run(fn, { history: 'ignore' })`.
  - Early-return cheaply when nothing's moving / when culled (`editor.getCulledShapes()`).
- Keep the steering math in a **pure module** with a `*.test.mjs` case (runs with no editor/DOM).
  Test: a creature in a uniform rightward field drifts right. (The sim already proves this.)

### Win condition / scoring (constants in `tuning.mjs > match` and `> goal`)
- Two **goal edges** (bands at each end of the board, `goal.width` deep): a creature reaching the
  **opponent's far edge** is captured by *you* — i.e. you pull creatures toward your goal.
- Tally captures; **first owner to `match.captureGoal` wins**, or most captures when the
  `match.maxSeconds` clock expires (draw if tied). Captured creatures **respawn at center** so the
  swarm keeps flowing. Show each player's score + energy in a small HUD (`components` slot).
- These numbers (`captureGoal: 18`, `maxSeconds: 90`, etc.) are tuned for decisive ~70s matches —
  port them. **Known open note:** symmetric matchups can stalemate into draws (~30% in the sim);
  see `design/DESIGN.md` "open tuning notes" if pacing needs work.
- **Optional hardening (referee):** if you want the spawn seed and tally tamper-proof for real
  competitive play, compute them in the Cloudflare Worker (a `POST /api/referee/:roomId` route)
  and write only results back through sync — never trust client-reported counts. See the
  sync-cloudflare worker's Durable Object as the place to add this route. This is optional for a
  first playable build; do the client-side version first.

---

## 7. Build order (do it in this sequence, verify each step)

0. **Read `design/DESIGN.md` and run the simulator.** `node design/sim/balance.mjs 120` and
   `node design/sim/watch.mjs combo disruptor 7` so you understand the proven mechanics before
   you build. This is the game you are reproducing — the rendering is a skin over it.
1. **Scaffold + merge + upgrade.** sync-cloudflare as root; copy shader's `WebGLManager.ts` +
   `fluid/` in; `yarn add tldraw@latest …`; `npx tsc --noEmit` clean; `yarn dev` runs and you
   see a blank multiplayer canvas. **Verify before continuing.**
2. **Port the proven core (§1d).** `field.mjs`/`economy.mjs`/`tuning.mjs` → typed `src/field/*.ts`,
   logic unchanged. Port `field.test.mjs` and make it pass against your `.ts`. **The numbers and
   rules are frozen — porting is mechanical, not a redesign.** `npx tsc --noEmit` clean.
3. **Shader background, static.** Mount Fluid as `Background`. Confirm the fluid renders behind
   the canvas and tracks camera pan/zoom. Drive it with dummy uniforms first.
4. **Emitter shape + tool.** Drop emitters; they sync between two browser tabs. `tsc` clean.
5. **The graph, live.** Recompute `FieldState` (via ported `resolveField`) on emitter change.
   Log it to confirm it reacts. (No need to re-derive — you ported it in step 2.)
6. **Wire graph → shader.** FieldState uniforms drive the fluid. Moving an emitter visibly
   changes the whole sea. **This is the core "execution graph + shader" moment — make it feel good.**
7. **Creatures + economy.** Spawn creatures; steer them by `sampleField` using the ported creature
   constants; wire the energy pool + emitter costs into placement.
8. **Two owners + goal edges + score.** Opposing emitters, capture creatures, tally, win.
9. **Polish + (optional) referee hardening.**

After every step: `npx tsc --noEmit` (zero errors), and `npx vite build` before you call it done.

**Port fidelity check:** after step 2, your `src/field/*.ts` must be behaviourally identical to
the sim. If you ever change a constant in `tuning.ts`, mirror it back into `design/sim/tuning.mjs`
and re-run `node design/sim/balance.mjs 120` — the win-rate band must stay in the proven
54–67% range with `idle` near 0%. The simulator is your balance regression test, forever.

---

## 8. Definition of done

- `yarn dev` runs client + worker; two browser tabs share one room (multiplayer).
- A WebGL fluid field renders full-canvas behind the shapes and tracks the camera.
- Dropping/moving **emitter** shapes visibly reshapes the field **everywhere** (graph → uniforms).
- **Combos work:** a vortex next to a friendly current visibly *widens* its reach; opposing
  currents cancel; an enemy vortex scatters; heat bends. (These are the ported `field.ts` rules.)
- **The economy bites:** energy regenerates, emitters cost to place/run, over-extending browns
  out; each player's energy + score show in a HUD.
- Creatures **drift with the field** (shader and steering agree because they share `sampleField`).
- Two players' opposing emitters contest the field; creatures get captured into goal edges; a
  winner is declared at `captureGoal` or on the clock.
- `npx tsc --noEmit` is clean; `npx vite build` succeeds; the ported field/economy modules have
  passing `*.test.mjs` tests; `node design/sim/balance.mjs 120` still shows the proven balance.

## 9. Design guardrails (don't drift from these)

- **One FieldState, two consumers.** Never let the shader and the creature steering compute the
  field differently — share `sampleField`. If they disagree, the game lies to the player.
- **Native-first.** Ride `editor.on('tick')`; write `x/y` in `editor.run(..., {history:'ignore'})`;
  use `getShapeAtPoint` / `getCamera` / `pageToViewport`. Don't hand-roll loops or geometry.
- **The graph is invisible.** No node boxes, no wires. The player programs the field by placing
  and moving emitter *game pieces*. The "execution" is the recompute of FieldState.
- **Keep pure math pure and tested.** `resolveField`, `sampleField`, and the steering function
  take plain data, return plain data, and run under `node --experimental-strip-types`.
- **When unsure about a v5 API, read `node_modules/tldraw` types** — do not guess from memory.
