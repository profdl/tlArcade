# CLAUDE.md — Engine

Guidance for working on the **Engine** demo. Keep it short and true to the code —
if a fact here drifts from the source, fix the source and update this file.

## What this is

A drag-and-drop **game builder** on tldraw v5. The player drops elements from a
tray (player / wall / token / hazard / goal), arranges them on the canvas, then
hits **Play** to test-drive a platformer. Native `geo`/`draw`/`line` shapes
double as solid terrain, so a level can be *drawn* with the pencil, not just
assembled from blocks.

## The core bet: one shape, many roles

There is a **single custom shape** — `gameEntity`
([render/EntityShapeUtil.tsx](render/EntityShapeUtil.tsx)) — with props
`{ w, h, role }`. What an entity *is* (player, wall, token, …) is the `role`
prop; everything else is DERIVED from the `ROLES` table in
[game/roles.ts](game/roles.ts): color, glyph, default size, and the three
behavior axes — **motion** (`static` | `platformer`), **collision** (`solid` |
`trigger`), **effect** (`none` | `collect` | `kill` | `win`).

Adding a new element = a new `Role` + a row in `ROLES`. It only needs engine code
if it introduces a genuinely new *behavior* (a new motion or effect branch in
`game/engine.ts`). The tray in `App.tsx` is generated from `ROLE_LIST`, so it
picks up new roles for free.

## Edit vs. Play (the whole architecture)

tldraw is an editor, not a game loop, so [game/engine.ts](game/engine.ts) →
`GameRuntime` *is* the loop:

- **Edit mode** — normal tldraw. Drop/drag/resize/delete entities; draw terrain.
- **`start()`** — snapshots authored `{x,y,opacity}` of every `gameEntity`, clears
  selection, collects solids + triggers **once**, attaches keyboard listeners, and
  runs a fixed-timestep sim on `requestAnimationFrame`.
- **`stop()`** — restores the snapshot. Non-destructive.

**All canvas writes go through `editor.run(fn, { history: 'ignore', ignoreShapeLock: true })`**
so the sim never pollutes the undo stack.

**Do NOT lock play with `isReadonly`.** It also blocks the runtime's own
`editor.updateShape` calls, so the player can never move (line-rider gets away
with it only because it animates an *overlay*, not a shape). Play isn't hard-locked;
selection is just cleared, and because the sim rewrites the player's position
every frame, a stray drag self-heals on the next tick.

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

- **Only the player moves.** Solids are gathered once at `start()` (editing is
  locked during play), so there are no moving platforms or AI movers yet — those
  are the next roles to add (enemy, ball, spawner; see the repo brainstorm).
- **Collision is AABB.** A rotated wall collides as its upright bounding box.
  Keep walls thicker than one sim step (a few px) to avoid tunneling at speed.
- **The player is driven by `shape.x/shape.y`** (top-level, unrotated). Don't
  parent or rotate the player and expect the sim to track it.
- **`persistenceKey="tlArcade-engine"`** — unique per demo (the shell's CLAUDE.md
  explains why this must never be shared). Levels persist in localStorage.
- Custom shape props are **global to the TS program** — if a `TLShapePartial`
  built from a non-literal `type` stops type-checking as other demos grow, cast
  at the call site (see the root CLAUDE.md).

## tldraw v5 reference

Offline doc exports live in [docs/tldraw/](../../../docs/tldraw/) — start at
`llms.txt`. Confirm version-sensitive APIs against the installed `tldraw`
(`^5.1.1`).
