# CLAUDE.md — Working in the tldraw Game Designer's Toolkit

This file is read automatically by Claude Code. It teaches you (Claude) how to
extend this repo correctly. The humans here are **vibe-coding interns**: they
will prompt you with things like *"add a menu item that resets the board"* or
*"make a new hexagon token shape."* Your job is to make those changes land on
the first try, following the patterns already in the repo.

**Read this whole file before adding a shape, tool, or UI element.** The tldraw
v5 API has a few non-obvious requirements; getting them wrong produces confusing
type errors or shapes that silently fail to sync.

---

## What this project is

A collaborative tabletop toolkit built on **tldraw v5** (`tldraw@^5.1`) with
**`@tldraw/sync`** for multiplayer, hosted on a **Cloudflare Worker + Durable
Object**. The architecture is **server-authoritative**: a "referee" inside the
Durable Object owns randomness (dice), hidden state (face-down cards), and
identity (seats). See `SPEC.md` for the full design — it is the source of truth.

### Repo map

```
client/                 React + Vite front-end
  pages/Room.tsx        ← mounts <Tldraw>; registers shapes/bindings/tools/components,
                          the referee receive channel, and editor behaviours
  shapes/               ← ONE FILE PER CUSTOM SHAPE (the main thing interns add)
    registry.ts         ← the only file you edit to register a shape/binding/tool
    TokenShape.tsx      ← reference example: simplest shape (public state)
    TrackerShape.tsx    ← reference example: shape with value/clamp math
    DieShape.tsx        ← reference example: a referee-backed (server-random) shape
    CardShape.tsx       ← reference example: a SECRET-bearing shape (redaction)
    ContainerShape.tsx  ← deck/bag/hand (containment + hidden contents)
    GridShape.tsx       ← a snapping surface + backdrop (no state, no referee)
    _TEMPLATE.shape.tsx.txt  ← copy this to start a new shape
  containment/          ← the "drop a piece into a container" subsystem (a binding
                          + a drop-time side-effect). See SPEC §4.2.
  grid/                 ← pure grid geometry (square/hex) + the snap behaviour
  referee/              ← client side of the referee: useReferee (HTTP send) +
                          privateReveals (owner-only receive channel)
  tools/                ← custom toolbar tools (StateNode subclasses), if any
  ui/                   ← custom menu items + context menu (UI overrides)
worker/                 Cloudflare Worker (the back-end)
  TldrawDurableObject.ts  ← the sync room + the POST /api/referee route
  Referee.ts            ← server-authoritative logic (dice, seats, secrets, decks)
  __tests__/referee.test.mjs  ← framework-free referee tests (run via `yarn test`)
shared/                 Code imported by BOTH client and worker
  shape-schemas.ts      ← prop validators (ONE source of truth for client+server),
                          plus gameBindingSchemas
  referee-protocol.ts   ← the client↔referee wire contract
SPEC.md                 The architecture spec. Read it for the "why".
```

### Run / verify

- `yarn dev` — runs client + worker locally (Vite + wrangler).
- `npx tsc --noEmit -p tsconfig.json` — typecheck everything. **Always run this
  after a change, BEFORE committing.** Zero errors is the bar.
- `yarn test` — runs the framework-free referee + grid-geometry tests. Add a case
  here whenever you add a referee action or geometry function (they need no editor
  or DOM, so they run under plain `node --experimental-strip-types`). NOTE: this
  runner can't handle TS *parameter properties* (`constructor(private x)`) — use a
  plain field + assignment in any code you want testable this way.
- `npx vite build` — verify the client bundles.

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

7. **Editor-wide drag/drop behaviour belongs in a side-effect, run on DROP not
   per-frame.** `editor.sideEffects.registerAfterChangeHandler` fires on every
   committed change in a *deferred flush loop*, so naive "re-layout on change"
   recurses (your writes re-enter the handler). The pattern that works
   (see `client/containment/registerContainment.ts` and `client/grid/
   registerSnapping.ts`): collect ids cheaply in the change handler; do the real
   work once in `registerOperationCompleteHandler`; skip while
   `editor.isIn('select.translating')`; wrap writes in `editor.run(fn, { history:
   'ignore' })`; keep a re-entry guard. Register from `<Tldraw onMount>` and
   return the disposer.

---

## RECIPE: add a custom shape

1. Copy `client/shapes/TokenShape.tsx` to `client/shapes/<Name>Shape.tsx`.
2. Rename the type, props, validators, and `static type`. Keep the
   `declare module 'tldraw'` augmentation block (gotcha #1).
3. Add the prop validators to `shared/shape-schemas.ts` and reference them from
   the new shape file (gotcha #4). Add an entry to `gameShapeSchemas`.
4. Add `<Name>ShapeUtil` to the `gameShapeUtils` array in
   `client/shapes/registry.ts`.
5. `npx tsc --noEmit` → fix any errors → done. The shape now syncs.

If the shape needs to be **placed by clicking a toolbar button**, also add a
tool (next recipe) and a toolbar button in `client/ui/`.

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

- **Typecheck after every change** (`npx tsc --noEmit`). Don't hand back code
  that doesn't compile.
- **Match the existing style** in the file you're editing: heavy explanatory
  comments in shape files (interns read them), terse in `shared/`.
- **One concept per file.** A new shape is a new file, not an addition to an
  existing shape's file.
- **When unsure about a v5 API, check the installed types** in
  `node_modules/tldraw` / `node_modules/@tldraw/*` rather than guessing — the
  API has moved across versions and your memory may be stale.
- **Don't put secrets in shape props.** If a value must be hidden from some
  players, it belongs in the Referee (`SPEC.md` §2).
