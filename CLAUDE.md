# CLAUDE.md — Working in the tldraw Game Experiments repo

This file is read automatically by Claude Code. It teaches you (Claude) how to
extend this repo correctly. The humans here are **vibe-coding interns**: they
will prompt you with things like *"make the creatures school together,"* *"add a
shape that reacts when you draw near it,"* or *"let me flick a token across the
board."* Your job is to make those changes land on the first try, following the
patterns already in the repo.

**Read this whole file before adding a shape, behaviour, or UI element.** The
tldraw v5 API has a few non-obvious requirements; getting them wrong produces
confusing type errors or shapes that silently fail to sync.

---

## What this project is

A **playground for games and game-like interactions on the tldraw v5 canvas.**
The point is to build things that *could not — or would not — be built on
another stack*, by leaning into what makes a tldraw canvas special:

- **The collaborative canvas** — every experiment is multiplayer from the first
  frame (`@tldraw/sync`). Motion, state, and presence replicate to everyone.
- **The DOM** — shapes are real React/HTML/SVG, so an experiment can use CSS,
  animation, video, iframes, and the full browser, not a sprite sheet.
- **Drawing** — hand-drawn strokes (perfect-freehand) and the draw tool are
  first-class inputs an experiment can read and react to.
- **Shapes & geometry** — native geo shapes, hit-testing, snapping, and bindings
  are reusable primitives (e.g. a rectangle becomes a "fishtank" a creature
  swims inside).
- **Embedded media** — images, video, bookmarks/link-previews live on the canvas
  via R2-backed assets.

Each experiment is its own small subsystem; they share one foundation. That
foundation is **server-authoritative**: a "referee" inside a Cloudflare Durable
Object owns anything that must be fair, hidden, or identity-bound (dice,
face-down cards, seats). See `SPEC.md` for the original toolkit design — it is
still the source of truth for the authority/secrecy model.

> This repo grew out of a tabletop-game toolkit (Token/Card/Die/Tracker/
> Container/Grid shapes, the referee, containment, the grid). That machinery is
> still here and still the best worked reference for "how a synced shape is put
> together." New work is more open-ended: autonomous creatures, throw physics,
> draw-reactive shapes — anything that explores game-feel on a shared canvas.

### Repo map

```
client/                 React + Vite front-end
  pages/Room.tsx        ← mounts <Tldraw>; registers shapes/bindings/tools/components,
                          the referee receive channel, and ALL editor behaviours
                          (containment, snapping, physics, swimming) in onMount
  shapes/               ← ONE FILE PER CUSTOM SHAPE
    registry.ts         ← the only file you edit to register a shape/binding/tool
    CreatureShape.tsx   ← reference example: NATIVE styles (color/size/dash/fill) +
                          per-frame animation; the model to copy for new shapes
    TokenShape.tsx      ← simplest shape (bespoke color enum — predates the native-
                          style policy; don't copy its color approach)
    TrackerShape.tsx    ← shape with value/clamp math
    DieShape.tsx        ← a referee-backed (server-random) shape
    CardShape.tsx       ← a SECRET-bearing shape (redaction)
    ContainerShape.tsx  ← deck/bag/hand (containment + hidden contents)
    GridShape.tsx       ← a snapping surface + backdrop (no state, no referee)
    _TEMPLATE.shape.tsx.txt  ← copy this to start a new shape
  creature/             ← AUTONOMOUS CREATURES experiment. Steering/roaming AI that
                          rides tldraw's tick; creatures swim inside native geo
                          shapes ("fishtanks"), avoid walls, school, and hunt food.
    registerSwimming.ts ← the per-frame behaviour (wander + wall avoidance + nav)
    variants/           ← creature kinds (fish/crab/ant/snake/jellyfish) + geometry
    clock.ts            ← shared animation clock riding editor.on('tick')
    stressTest.ts       ← spawn-many helper for perf work
  physics/              ← THROW / INERTIA experiment. Flick a shape and it glides &
    registerPhysics.ts    bounces off viewport walls. Native-first: reads
                          editor.getPointerVelocity(), rides editor.on('tick').
  containment/          ← "drop a piece into a container" subsystem (a binding +
                          a drop-time side-effect). See SPEC §4.2.
  grid/                 ← pure grid geometry (square/hex) + the snap behaviour
  referee/              ← client side of the referee: useReferee (HTTP send) +
                          privateReveals (owner-only receive channel)
  ui/                   ← custom menu items, toolbar, context menu (UI overrides)
worker/                 Cloudflare Worker (the back-end)
  TldrawDurableObject.ts  ← the sync room + the POST /api/referee route
  Referee.ts            ← server-authoritative logic (dice, seats, secrets, decks)
  __tests__/referee.test.mjs  ← framework-free referee tests (run via `yarn test`)
shared/                 Code imported by BOTH client and worker
  shape-schemas.ts      ← prop validators (ONE source of truth for client+server),
                          plus gameBindingSchemas
  referee-protocol.ts   ← the client↔referee wire contract
SPEC.md                 The original architecture spec. Read it for the authority/
                        secrecy "why".
```

### Run / verify

- `yarn dev` — runs client + worker locally (Vite + wrangler).
- `npx tsc --noEmit -p tsconfig.json` — typecheck everything. **Always run this
  after a change, BEFORE committing.** Zero errors is the bar.
- `yarn test` — runs the framework-free referee + grid-geometry tests. Add a case
  here whenever you add a referee action or a pure-geometry/steering function
  (they need no editor or DOM, so they run under plain
  `node --experimental-strip-types`). Keep new logic testable this way by
  splitting pure math out of the per-frame behaviour, the way `creature/` and
  `grid/` do. NOTE: this runner can't handle TS *parameter properties*
  (`constructor(private x)`) — use a plain field + assignment.
- `npx vite build` — verify the client bundles.
- **Changing a shape's props after it has persisted records throws
  `ValidationError: ... got undefined` at load.** Adding a required prop to an
  existing shape needs a tldraw props migration. For local dev (throwaway rooms),
  instead stop `yarn dev` (it locks the files) and wipe the Durable Object store:
  `rm -rf .wrangler/state/v3/do/multiplayer-template-TldrawDurableObject`.

---

## tldraw v5 GOTCHAS — read before writing a shape

These are the things your training data probably gets wrong. The repo is on
**v5.1**; older tldraw (v2/v3) did these differently.

1. **Register the shape's type via module augmentation.** `TLShape` is a *closed
   union* in v5. A custom shape only type-checks once you augment
   `TLGlobalShapePropsMap`. Every shape file needs:
   ```ts
   declare module 'tldraw' {
     interface TLGlobalShapePropsMap { myshape: MyShapeProps }
   }
   ```
   Without this you get *"Type 'MyShape' does not satisfy the constraint 'TLShape'"*.

2. **Extend `ShapeUtil`, not `BaseBoxShapeUtil`.** In v5 `BaseBoxShapeUtil` is
   reserved for tldraw's built-in box shapes and won't accept a custom type.
   Custom shapes extend `ShapeUtil<MyShape>` and implement `getGeometry()`
   returning a `Rectangle2d` (or other `Geometry2d`).

3. **The selection outline is `getIndicatorPath()`, returning a `Path2D`** — not
   a JSX `indicator()` method (that was the old API). Example:
   ```ts
   getIndicatorPath(shape) {
     const path = new Path2D()
     path.roundRect(0, 0, shape.props.w, shape.props.h, 6)
     return path
   }
   ```

4. **Register shapes in TWO places, and keep their validators identical.**
   - The **client**: add the util to `client/shapes/registry.ts`. `Room.tsx`
     passes that array to BOTH `useSync({ shapeUtils })` (the synced schema) and
     `<Tldraw shapeUtils>` (rendering). Both are required.
   - The **server**: add the shape's validators to `shared/shape-schemas.ts`
     (`gameShapeSchemas`), which `worker/TldrawDurableObject.ts` feeds to
     `createTLSchema`.
   If the client and server prop validators disagree, synced shapes fail
   validation on other clients. That's why validators live in `shared/`.

   **The schema on each side must be the SAME SET — defaults included.** This is
   the subtle one. `useSync({ shapeUtils })` builds the client's *synced* schema
   from EXACTLY the utils array you pass — it does NOT auto-add tldraw's built-in
   shapes. So if you want the built-ins (geo/draw/arrow/text/note/…), the client
   array (`gameShapeUtils` in `registry.ts`) must spread `...defaultShapeUtils`
   (and `...defaultBindingUtils`), AND the worker must spread `...defaultShapeSchemas`
   (`...defaultBindingSchemas`). Include the defaults on BOTH sides or NEITHER —
   a mismatch makes the server's schema carry migrations the client lacks, and
   the sync handshake rejects every client at connect time with **`CLIENT_TOO_OLD`**
   (a misleading name: it means "schemas differ", not "stale client/cache"). If
   you keep the built-ins, leaving them out of `gameShapeUtils` ALSO makes adding
   a built-in shape (e.g. the rectangle tool → a `geo` shape) throw a
   `ValidationError: ... got "geo"`. Keep the two lists in lockstep.

5. **Anything secret or random goes through the Referee, never the store.** The
   sync document is visible to every client. Dice rolls, shuffles, and
   face-down values are computed by `worker/Referee.ts` and only their redacted
   results are written back. Do NOT put a hidden value in `shape.props`. See
   `SPEC.md` §1–§3, and `CardShape.tsx` for the worked redaction example.

6. **Bindings (shape↔shape links) augment a *different* map and register
   alongside shapes.** A `BindingUtil` needs `declare module 'tldraw' { interface
   TLGlobalBindingPropsMap { mybinding: Props } }`, goes in `gameBindingUtils`
   (registry.ts), is passed to `useSync({ bindingUtils })` AND `<Tldraw
   bindingUtils>`, and its schema goes in `gameBindingSchemas` (shared) →
   `createTLSchema({ bindings })`. tldraw auto-deletes a binding when either of
   its shapes is deleted. See `client/containment/` for the worked example.

7. **Editor-wide per-frame or drag/drop behaviour is "native-first" and lives in
   its own `register*.ts`.** This is the pattern every experiment that moves or
   reacts to shapes uses — `physics/registerPhysics.ts` and
   `creature/registerSwimming.ts` are the canonical references. The rules:
   - **Ride tldraw's own loop, don't spin your own.** For per-frame motion listen
     to `editor.on('tick', elapsedMs => …)` (frame-rate-independent via
     `elapsedMs`); do NOT start a separate `requestAnimationFrame`. For velocity
     read `editor.getPointerVelocity()` rather than estimating it.
   - **Move a shape by writing `shape.x/y` (and `rotation`) directly**, client-
     local, wrapped in `editor.run(fn, { history: 'ignore' })`. Sync replicates
     the positions to everyone for free — never sync per-frame velocity yourself.
   - **For drop/commit-time work** (containment, snapping), don't re-layout on
     every change: `registerAfterChangeHandler` fires in a *deferred flush loop*,
     so naive "re-layout on change" recurses (your writes re-enter the handler).
     Collect ids cheaply in the change handler; do the real work once in
     `registerOperationCompleteHandler`; skip while
     `editor.isIn('select.translating')`; keep a re-entry guard.
   - **Find the surface under a shape with native hit-testing** —
     `editor.getShapeAtPoint(center, { filter, hitInside })` (how a creature
     finds its "tank" and a piece finds its grid), not your own geometry loops.
   - Register every behaviour from `<Tldraw onMount>` and return its disposer
     (Room.tsx collects them all). Keep heavy per-frame loops cheap: early-return
     when nothing is moving.

8. **Use NATIVE styles, not custom props, for color/size/dash/fill.** Register
   tldraw's `StyleProp`s (`DefaultColorStyle`, `DefaultSizeStyle`,
   `DefaultDashStyle`, `DefaultFillStyle` from `@tldraw/tlschema`) in the shape's
   validators (`shared/shape-schemas.ts`). They appear in the style panel and
   share the global palette automatically; `createTLSchema` auto-collects them
   (no extra worker wiring). Resolve a color to hex the way built-ins do:
   `getColorValue(editor.getCurrentTheme().colors[editor.getColorMode()], color,
   'solid')`. Hand-drawn stroke = feed outline points through `getStrokePoints` →
   `getSvgPathFromStrokePoints` (the Draw-shape pipeline), gated on
   `dash === 'draw'`. NOTE: `STROKE_SIZES` and `getDefaultColorTheme` are NOT
   exported in this version — mirror stroke sizes as a local const; use
   `editor.getCurrentTheme()`. `CreatureShape.tsx` is the reference.

---

## RECIPE: add a custom shape

1. Copy `client/shapes/CreatureShape.tsx` (uses native style props — gotcha #8)
   to `client/shapes/<Name>Shape.tsx`. Use `_TEMPLATE.shape.tsx.txt` for a bare
   skeleton.
2. Rename the type, props, validators, and `static type`. Keep the
   `declare module 'tldraw'` augmentation block (gotcha #1).
3. Add the prop validators to `shared/shape-schemas.ts` and reference them from
   the new shape file (gotcha #4). Add an entry to `gameShapeSchemas`.
4. Add `<Name>ShapeUtil` to the `gameShapeUtils` array in
   `client/shapes/registry.ts`.
5. `npx tsc --noEmit` → fix any errors → done. The shape now syncs.

If the shape needs to be **placed by clicking a toolbar button**, also add a
tool (a `StateNode` in the `gameTools` array) and a toolbar button in
`client/ui/`.

## RECIPE: add an editor behaviour (motion / reactivity)

This is the shape of most new experiments — something that watches the canvas
and moves or reacts every frame or on drop.

1. Create `client/<experiment>/register<Thing>.ts` exporting
   `register<Thing>(editor): () => void` (it returns a disposer).
2. Follow the native-first rules in gotcha #7: ride `editor.on('tick', …)` for
   per-frame work or `registerOperationCompleteHandler` for drop-time work; write
   `shape.x/y` inside `editor.run(fn, { history: 'ignore' })`; use
   `editor.getShapeAtPoint`/`getPointerVelocity` instead of hand-rolling.
3. Split any pure math (steering, geometry, easing) into a separate module and
   add a `__tests__/*.test.mjs` case — see `creature/` and `grid/`.
4. Call your `register<Thing>(editor)` from `Room.tsx`'s `onMount` and add its
   disposer to the array it returns.

## RECIPE: add a main-menu item

tldraw v5 UI is customized through the `components` prop on `<Tldraw>` — you do
NOT fork tldraw's menu. Compose your item alongside the defaults:

```tsx
import { DefaultMainMenu, DefaultMainMenuContent, TldrawUiMenuGroup, TldrawUiMenuItem, TLComponents } from 'tldraw'

function CustomMainMenu() {
  return (
    <DefaultMainMenu>
      <TldrawUiMenuGroup id="game">
        <TldrawUiMenuItem
          id="reset-board"
          label="Reset board"
          icon="trash"
          readonlyOk
          onSelect={() => { /* do the thing, e.g. editor.deleteShapes(...) */ }}
        />
      </TldrawUiMenuGroup>
      <DefaultMainMenuContent />   {/* keep everything tldraw normally shows */}
    </DefaultMainMenu>
  )
}

const components: TLComponents = { MainMenu: CustomMainMenu }
// pass `components={components}` to <Tldraw> in Room.tsx
```

- Use the editor inside `onSelect` via the `useEditor()` hook (call it in the
  menu component and close over it), or via `useDefaultHelpers()` for dialogs.
- Only reach for the `overrides` prop + `actions` when the command needs a
  **keyboard shortcut** or must appear in several menus. For a one-off menu
  item, the `components` route above is correct.
- The same `components` pattern customizes `ContextMenu`, `Toolbar`,
  `StylePanel`, etc. — swap the corresponding key in `TLComponents`.

## RECIPE: add a referee action (dice/shuffle/secret)

1. Add the action to `RefereeRequest` in `shared/referee-protocol.ts`.
2. Handle it in `worker/Referee.ts` → `handleRequest` switch. Use
   `this.room.updateStore(...)` for public results, `this.room.pushPrivateReveal(seat, ...)`
   for private (owner-only) reveals. Owns the RNG via `crypto.getRandomValues`.
   Add the case to the framework-free test in `worker/__tests__/referee.test.mjs`
   and run `yarn test`.
3. On the client, call `useReferee(roomId)` and `await send({ action: ... })`.

**TRANSPORT (important):** the `@tldraw/sync` socket is ONE-WAY for custom
messages (server→client only). So:
- **client → referee** goes over HTTP `POST /api/referee/:roomId`
  (`client/referee/useReferee.ts` — it sends `sessionId: TAB_ID` so the referee
  can address private pushes back to this exact socket).
- **public results** (e.g. a dice value) come back through normal store sync —
  the referee writes them with `updateStore`, the client just re-renders.
- **private results** (owner-only reveals) are pushed via the room's
  `sendCustomMessage` and received in `client/referee/privateReveals.ts`
  (`useSync({ onCustomMessageReceived })`). They are held in a reactive `atom`
  and rendered locally — NEVER written to the store. See `SPEC.md` §3.2, §3.4.

---

## House rules

- **Lean into the canvas.** New experiments should use what's special about this
  stack — multiplayer sync, the DOM, drawing, native geometry, embedded media —
  rather than reimplementing a generic game loop. Motion and state replicate for
  free when you write to the store; reach for that before inventing transport.
- **Default to native tldraw v5.** Reuse tldraw's own styling and machinery —
  `DefaultColorStyle`/`DefaultSizeStyle`/`DefaultDashStyle`/`DefaultFillStyle`
  style props (NOT bespoke color enums or hex maps), `editor.getCurrentTheme()`
  for color resolution, `editor.on('tick')` for animation,
  `editor.getPointerVelocity()`/`getShapeAtPoint()` for input/hit-testing, and
  perfect-freehand for hand-drawn strokes — unless the user asks otherwise. See
  gotcha #7, #8 and `CreatureShape.tsx`/`registerPhysics.ts`.
- **Typecheck after every change** (`npx tsc --noEmit`). Don't hand back code
  that doesn't compile.
- **Match the existing style** in the file you're editing: heavy explanatory
  comments in shape/behaviour files (interns read them), terse in `shared/`.
- **One concept per file / per directory.** A new shape is a new file; a new
  experiment is a new directory under `client/` with its own `register*.ts` and
  `__tests__/`.
- **Keep logic testable.** Split pure math out of per-frame loops so it runs
  under the `yarn test` runner with no editor or DOM.
- **When unsure about a v5 API, check the installed types** in
  `node_modules/tldraw` / `node_modules/@tldraw/*` rather than guessing — the
  API has moved across versions and your memory may be stale.
- **Don't put secrets in shape props.** If a value must be hidden from some
  players, it belongs in the Referee (`SPEC.md` §2).
