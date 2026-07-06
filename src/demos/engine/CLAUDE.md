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
the Line Rider demos use) — *except* the player, which can also be marked
explicitly (see **The player** below), and that marker wins over color:

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

## The player (single shape or a group)

The player is identified by a **marker**, `meta.role === 'player'`, which **wins
over color** — so a stick figure can be any colour(s). It's set from a **contextual
toolbar** that floats above the current selection: select shapes, click **"Set as
Player"** (`render/PlayerToolbar.tsx` → `game/player.ts` → `markAsPlayer`). If >1
it `groupShapes` them first, then stamps the marker on the group. There is always
exactly **one** player — marking clears the previous marker. Marking is an
authoring action (undoable); it does NOT go through `history: 'ignore'`.

The toolbar is a `TldrawUiContextualToolbar` (tldraw's official "Contextual
toolbar" example pattern), mounted with the drag `Tray` under a single
`InFrontOfTheCanvas` wrapper in `App.tsx`; it hides during play and when nothing
is selected.

At `start()`, `collectPlayerBody` (`game/player.ts`) reads the player's page bounds
(the union of a group's children) and **merges every leaf part's outline** into one
page-space sample set — so a multi-part figure collides by its real combined
perimeter. The sim treats those samples exactly like a single shape's (it never
cared how many shapes produced them, see below), and `writePlayer` moves the group
record's `x/y` each frame; the parts ride along via tldraw's parenting (grouping
preserves page positions). The player's whole descendant subtree is **excluded**
from the level scan so a limb isn't collected as terrain.

Legacy fallback: an unmarked single **blue** shape still plays as the player (color
→ role), so old levels keep working.

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

## The N-entity model (`game/entities/`)

The sim steps a **list of entities** (`GameRuntime.entities`); the **player is
`entities[0]`** with `motion: 'platformer'`. The per-substep physics, per-axis
collision resolution, and outline overlap test are the **pure, editor-free**
functions in [game/entities/step.ts](game/entities/step.ts) (`stepEntity`,
`resolveAxis`, `deepestShift`, `tryCornerCorrect`, `touches`) — unit-tested in
`step.test.ts` with hand-built `Body` fixtures, exactly like `physics.ts`/
`collision.ts`. `GameRuntime` owns only the editor glue (read the level, read
input, write shapes, fire effects). The entity types live in
[game/entities/types.ts](game/entities/types.ts) (`Entity`, `EntityKinematic`,
`EntityInput`).

- **Only the player reads input and runs the jump/coyote/buffer/variable-cut/
  slope-jump feel pipeline** — that whole block in `stepEntity` is gated on
  `isPlatformer`. **Gravity + per-axis integrate + collision resolution run for
  every entity**, so a future mover reuses the same path.
- **Trigger/win/respawn ownership stays on the player** (`checkTriggers`/
  `respawn` in `engine.ts`): the runtime keeps its own inline effect loop (a
  hazard respawn mutates `player.kin` mid-loop, so later triggers that frame see
  the respawned position — the original ordering) and uses the pure `touches()`
  only for the overlap test.
- **Per-leaf offsets stay in `entity.parts`** (a group player is many leaves at
  their own page offsets), NOT flattened onto the entity — flattening would deform
  a group figure. `EntityKinematic` carries only the body's bounds top-left.
- Today there is **exactly one entity**; with a single `platformer` entity and no
  others (the only state that exists — no `meta.role`/behavior is ever set yet)
  the loop is byte-for-byte the original player-only path, so every level keeps
  working. This was a behavior-preserving refactor, adversarially verified. Movers
  (enemy, moving platform) become **additional entities** in later phases.

## The sim

Per fixed substep (`SIM.FIXED_DT`): read input + jump edges → accelerate `vx`
toward the target speed (friction when idle), integrate `vy` under asymmetric
gravity, resolve the jump (buffer + coyote + variable height) → move Y and
resolve, move X and resolve, then tick the feel timers. Triggers are tested each
frame against the player outline:
- **token** → collect (opacity→0, counter++),
- **hazard** → respawn at the player's authored spot (deaths++),
- **goal** → win, but only once every token is collected.

**Game feel lives in [game/physics.ts](game/physics.ts)** — the movement/jump/
gravity math and every tunable. The pipeline is contemporary-platformer standard:

- **Accel/friction, not instant velocity** — `vx` approaches `dir*moveSpeed`
  (`stepVx`); ground and air use different rates so air control feels lighter.
- **Coyote time** — a jump still fires for `coyoteTime` s after leaving a ledge.
- **Jump buffering** — a jump pressed `jumpBuffer` s before landing fires on
  touchdown. Both fold into one `bufferTimer>0 && coyoteTimer>0` check in `step`.
- **Variable jump height** — releasing jump while rising cuts `vy *= jumpCut`
  (tap = short hop). Needs key EDGES (`jumpPressed`/`jumpReleased`), not just the
  held `keys` Set — see the key handlers (`e.repeat` filters OS auto-repeat).
- **Asymmetric gravity** — heavier falling (`fallGravityMult`), floaty at the
  apex (`apexGravityMult` within `apexThreshold` of vy=0) — `gravityMult`.
- **Corner correction** — on a ceiling bonk the resolver probes ±`cornerCorrect`
  px sideways (`tryCornerCorrect` via `deepestShift`) and slips the head past a
  small overhang instead of killing the jump.
- **Slope jump** — a slope too steep to walk up (its normal is wall-ish, so it
  fails `GROUND_NY` and can't ground you) would otherwise TRAP you: no forward
  walk (X pass blocks it), no jump (not grounded). So `resolveAxis` records a
  `touchingWall` contact + its outward `wallNx` whenever it pushes you out of a
  steep/wall surface, and `step` lets a buffered jump fire off it — kicking UP
  and AWAY along `wallNx`. Gravity still slides you down a steep slope otherwise.
  `touchingWall` is re-detected every step (no coyote grace), which is fine since
  gravity keeps you pressed into the hill while in contact.

Collision resolution is still **per-axis** against the real-outline solids
collected at start (`resolveAxis` → `deepestShift`, which returns the governing
contact's `nx`/`ny`; `SIM.WALL_NX`/`GROUND_NY` decide wall-vs-slope-vs-floor).
Non-feel constants (substep, ground/wall normal thresholds) are `SIM` in
physics.ts; add new feel knobs to `PhysicsTunables` + `PHYSICS_DEFAULTS`, never
as inline literals.

### Live tuning

`PHYSICS_DEFAULTS` is the shipped "tight & snappy" baseline. A **live debug
panel** ([render/PhysicsPanel.tsx](render/PhysicsPanel.tsx)) shows during play and
writes every knob to `tunablesAtom` (game/state.ts); the runtime reads that atom
each substep, so edits are felt on the next jump. **Copy** dumps the current
values as JSON to paste back into `PHYSICS_DEFAULTS`; **Reset** restores defaults.
App re-seeds the atom to defaults on mount (it's module-global). The panel sits
top-right, so the runtime hides tldraw's `StylePanel` during play (App.tsx) to
avoid the overlap. Slider layout is data-driven from `TUNABLE_GROUPS`.

## Known limits / gotchas

- **Only the player moves** *today*. The sim is now N-entity-capable (see The
  N-entity model above), but only one entity — the player — is ever built, and
  the level is gathered once at `start()`. Moving platforms / AI movers are added
  as **additional entities** with non-`platformer` motions in later phases (enemy,
  ball, spawner; see PLAN.md §G2/G3).
- **Solids are captured once at start**, in page space — a rotated wall collides
  by its real outline (see collision.ts) but a wall moved/rotated mid-play won't
  update. Collision is not swept: keep walls thicker than one substep's travel to
  avoid tunneling at high speed (no continuous collision detection yet).
- **The player is driven by `shape.x/shape.y`** of the player record — the group
  (or lone shape), top-level and unrotated. Moving the group carries its parts;
  but don't rotate the player record, or re-parent it under something else, and
  expect the sim to track it.
- **A group player is a rigid body.** Parts are merged into one outline at
  `start()` and never move relative to each other during play — no articulated
  limbs/walk cycles yet.
- **`persistenceKey="tlArcade-engine-native"`** — unique per demo (the shell's
  CLAUDE.md explains why this must never be shared). Levels persist in
  localStorage.

## The AI substrate (`game/ai/`, `worker/engine.ts`)

The toolkit spine for "AI authors data; the deterministic runtime plays data"
(see [PLAN.md](PLAN.md) §1). Three pieces, all shipped:

- **Worker proxy** — [worker/engine.ts](../../../worker/engine.ts), mounted at
  `POST /api/engine/messages` (see [worker/worker.ts](../../../worker/worker.ts)).
  A thin relay that attaches the Anthropic key (`ANTHROPIC_API_KEY`, a **Worker
  secret** — `wrangler secret put ANTHROPIC_API_KEY`; never in the browser bundle)
  and forwards a Messages-API body to Anthropic. No prompt logic lives here — it's
  just the key-holder, so it stays stable as prompts evolve.
- **AI client** — [game/ai/client.ts](game/ai/client.ts) → `generate({ schema,
  prompt, images? })`. POSTs through the proxy, extracts the model's JSON (tolerant
  of ```` ```json ```` fences / stray prose via `stripToJson`), **Zod-validates it
  against the caller's schema, and retries ONCE on invalid JSON, feeding the parse
  error back** so Claude fixes its own output. Every converter is a thin wrapper
  over this one call. Tested in `client.test.ts` with a stubbed `fetch`.
- **Schemas** — [game/ai/schemas.ts](game/ai/schemas.ts): the single Zod contract
  shared by client, Worker, and every converter. Each persisted model carries a
  `version` (levels persist in localStorage, so old docs carry old schemas — parse
  + migrate, never crash). Ships `LevelLayout` and `TunablesPatch` today; Rig /
  Clip / EnemyBehavior / GameDef extend the same pattern later.

**The perception bundle** — [game/ai/perceive.ts](game/ai/perceive.ts) →
`perceive(editor, ids)`. THE reusable "let Claude see a drawing" primitive: one
bundle of **PNG** (what Claude visually perceives), **leaf geometry keyed by real
shape id** (the ground truth it maps onto, so it returns real ids + exact
coordinates, not guesses), and **SVG** (precision tiebreaker). Every vision
converter calls this and differs only in prompt + schema. Verified tldraw APIs:
`toImageDataUrl` → `{ url, width, height }` (a `data:` URL, **not** a bare string —
split it with `toImageInput`), `getSvgString` → `{ svg, … } | undefined`,
`getShapeAndDescendantIds` to expand a group to its leaves.

The converter pattern that builds on this (data model → runtime → manual editor →
AI → docs) is the `engine-data-converter` skill; the runtime invariants are
`engine-runtime-conventions`; the native-UI rules are `tldraw-v5-native-ui`; the
self-check gate is `engine-verify` (all in `.claude/skills/`).

## The AI converters (`game/ai/auto*.ts`)

Each is a thin wrapper over `generate()` following the five-step recipe (schema →
runtime → manual editor → AI → docs). All reach the user through **one** native
door: **✨ Generate** in the `HelperButtons` slot ([render/GeneratePanel.tsx]
(render/GeneratePanel.tsx)), a small form with a target selector — never a button
per converter (PLAN §7.5). Add a converter by adding a target here, not a button.

- **autoTune** (G5, feel) — [game/ai/autoTune.ts](game/ai/autoTune.ts). Prompt
  ("floaty like Celeste with a big jump") → a partial `TunablesPatch` (only the
  knobs the prompt implies) → `applyTunables` **merges it onto `tunablesAtom`,
  clamped to each knob's panel range**, so the runtime feels it next substep and
  the live physics panel (the manual editor / safety net) reflects it. No
  perception, no shape mutation. Pure merge/clamp logic is unit-tested
  (`autoTune.test.ts`); the model prompt is built from `TUNABLE_GROUPS` so it can't
  drift from the real knobs.
- **autoLevel** (G4, level) — [game/ai/autoLevel.ts](game/ai/autoLevel.ts). Prompt
  → a `LevelLayout` (roles + page coords) → `applyLevelLayout` lays it down as
  **native shapes via the same `createShape`/`shapeForRole` path as `level.ts`** —
  so the result is ordinary shapes the tray+canvas (the manual editor) already
  edits and the runtime already plays. Two modes: **replace** (clear + generate
  fresh) and **extend** (`perceive()` the current drawing, add only NEW
  placements). The role prompt is built from the `ROLES` registry.

Both proven end-to-end against the live API. Set the key first:
`wrangler secret put ANTHROPIC_API_KEY` (a local `.env` `ANTHROPIC_API_KEY` works
for `npm run dev`). Note: **AI output is non-deterministic** — the same prompt
yields different (valid) data each call; that's authoring, not the loop. The
runtime is deterministic only once the data is fixed.

## tldraw v5 reference

Offline doc exports live in [docs/tldraw/](../../../docs/tldraw/) — start at
`llms.txt`. Confirm version-sensitive APIs against the installed `tldraw`.
