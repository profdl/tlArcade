# CLAUDE.md — Engine

Guidance for working on the **Engine** demo. Keep it short and true to the code —
if a fact here drifts from the source, fix the source and update this file.

## What this is

A drag-and-drop **game builder** on tldraw v5. You drag elements from a left
tray (player / wall / token / hazard / goal) onto the canvas, arrange them, then
hit **Play** to test-drive a platformer.

## Native-first: no custom shape

There is **no custom shape**. Every element is a plain native tldraw shape, and
its ROLE is read from its **color** at play time (the same color→behavior idea
the Line Rider demos use):

| color | role | behavior |
| --- | --- | --- |
| blue | player | gravity + input mover |
| grey | wall | solid |
| yellow | token | trigger → collect |
| red | hazard | trigger → respawn |
| green | goal | trigger → win |

Both `geo` shapes (from the tray) **and shapes drawn with the pencil** (`draw`)
map their color to a role — so you can draw any element, not just place it. A
shape in any **other** color, and any `line`, is **solid terrain** (draw a level
in e.g. black). Because color *is* the behavior, each role's color must be
**unique** (see `roles.ts` → `COLOR_TO_ROLE`); recoloring a shape reassigns it.

Since a `draw` shape has no `props.w/h`, the player is sized and positioned from
its **page bounds** (`getShapePageBounds`), not props — with an offset captured
at start to convert the sim's bounds position back to the shape's record x/y (see
`engine.ts` → `start`/`writePlayer`). This works for a geo player too (offset 0).

Everything about a role lives in [game/roles.ts](game/roles.ts): its tray
appearance, the geo shape the tray drops (`shapeForRole`), its color, default
size, and the three behavior axes — **motion** / **collision** / **effect**.
`roleForColor` maps a color back to a role for the engine.

## The left tray

[render/Tray.tsx](render/Tray.tsx) is adapted from tldraw's official "Drag and
drop tray" example: a custom UI mounted via `components.InFrontOfTheCanvas` that
uses pointer capture + a small drag state machine, then on release converts the
screen point to a page point (`editor.screenToPage`) and `createShape`s the
role's geo shape. Gotchas:

- The `InFrontOfTheCanvas` layer (`.tl-canvas__in-front`) is
  `pointer-events: none` so canvas panning works through it — the tray opts back
  in with `pointer-events: all` (see App.css). Without it, tray items are dead.
- `components` is a **module-level const** in App.tsx (stable identity) so the
  tray never remounts. It can't take props, so it reads play state from
  [game/state.ts](game/state.ts) → `playingAtom` (App sets it; the tray hides
  itself while a game runs).

## Edit vs. Play (the runtime)

tldraw is an editor, not a game loop, so [game/engine.ts](game/engine.ts) →
`GameRuntime` *is* the loop:

- **`start()`** — snapshots authored `{x,y,opacity}`, clears selection, reads the
  level off the canvas **once** (role via `roleOf` → `roleForColor`), and runs a
  fixed-timestep sim on `requestAnimationFrame`. Returns false if no player
  (nothing blue).
- **`stop()`** — restores the snapshot. Non-destructive.

**All canvas writes go through `editor.run(fn, { history: 'ignore', ignoreShapeLock: true })`**
so the sim never pollutes undo.

**Do NOT lock play with `isReadonly`.** It also blocks the runtime's own
`editor.updateShape` calls, so the player can never move (line-rider gets away
with it only because it animates an *overlay*, not a shape). Play isn't
hard-locked; selection is just cleared, and because the sim rewrites the player's
position every frame, a stray drag self-heals on the next tick.

## The sim (MVP)

Per fixed substep (`PHYSICS.FIXED_DT`): read input → set `vx` directly from
left/right, accumulate gravity into `vy`, jump if grounded → move X and resolve,
move Y and resolve. Collision is **per-axis AABB** against the solids collected
at start. Triggers are tested each frame against the player box:
- **token** → collect (opacity→0, counter++),
- **hazard** → respawn at the player's authored spot (deaths++),
- **goal** → win, but only once every token is collected.

Tunables live in the `PHYSICS` object — add new ones there, not as inline
literals.

## Known limits / gotchas

- **Only the player moves.** The level is gathered once at `start()`, so there
  are no moving platforms or AI movers yet — those are the next roles to add
  (enemy, ball, spawner; see the repo brainstorm).
- **Collision is AABB.** A rotated wall collides as its upright bounding box.
  Keep walls thicker than one sim step (a few px) to avoid tunneling at speed.
- **The player is driven by `shape.x/shape.y`** (top-level, unrotated). Don't
  parent or rotate the player and expect the sim to track it.
- **`persistenceKey="tlArcade-engine-native"`** — unique per demo (the shell's
  CLAUDE.md explains why this must never be shared). Levels persist in
  localStorage.

## tldraw v5 reference

Offline doc exports live in [docs/tldraw/](../../../docs/tldraw/) — start at
`llms.txt`. Confirm version-sensitive APIs against the installed `tldraw`.
