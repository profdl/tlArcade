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
| violet | enemy | patrol mover → stomp / kill (see The enemy below) |

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

## The tile grid

Levels are built on a **square tile grid** like a classic side-scroller. The
unit is `roles.ts` → **`TILE = 60`**, chosen so the player (the drawn builder,
`builder.ts` → `BUILDER_HEIGHT = 120`) is exactly **1 tile wide × 2 tiles tall**
— the standard 1×2 platformer footprint. Every role's default `size` is a
whole/half-tile multiple expressed via `tiles(n)` (wall 1×1, token ½×½, hazard
1×½, goal 1×2, enemy 1×1, spring 1×¼, checkpoint ½×1½, oneway 2×¼). **Walls
default to a 1×1 square you stretch to whole-tile multiples** to build floors and
platforms (a floor is one wide wall, not many stacked squares).

`level.ts` and the templates author positions **and** sizes in tile units via
`tiles()` (aliased `T`), so a layout reads as grid coordinates and stays on the
grid. The **ground row sits at `T(8)` (y=480)**; the player and goal are 2 tiles
tall, so they rest on it at `y = T(6)`. Keep new levels grid-aligned. There is no
interactive snap-to-grid yet — dragged/placed shapes size on the grid but land at
the free cursor point; snapping would be a `Tray.tsx`/editor-config follow-up.
Nothing hardcodes a pixel size: `Tray.tsx` and `ai/autoLevel.ts` read `ROLES[…]
.size` at runtime, so changing `TILE` (or a role's tile size) reflows everything.

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
- The player is **entity 0** (`platformer`); the first real mover is the **enemy**
  (`patrol`, see below). A level with **no** non-player entity plays byte-for-byte
  the original player-only path (the N-entity refactor was behavior-preserving,
  adversarially verified). More movers (moving platform, projectile) are further
  motion kinds added the same way.

## The enemy (patrol + stomp, G2a)

The first non-player mover — a **violet** `geo` shape (tray role `enemy`, motion
`patrol`). At `start()` each enemy shape becomes an entity via `collectPlayerBody`
(a lone shape → one leaf, offset 0, merged outline — same path as a single-shape
player); enemies are **excluded from solids and triggers** (they're movers, not
static geometry).

- **Patrol motion** (`entities/step.ts` → `stepEntity` `motion === 'patrol'`):
  walks at `params.patrolSpeed` (default `DEFAULT_PATROL_SPEED`) in `kin.facing`,
  falls under gravity + resolves like any entity, and **reverses when grounded** on
  hitting a wall (`touchingWall`) or reaching a **ledge** (`groundAhead` probes a
  few px forward for a floor-ish contact). Pure + unit-tested (`step.test.ts`).
- **Stomp vs kill** (`engine.ts` → `checkEnemies`, each frame before the static
  triggers): when the player AABB overlaps a live enemy, `stompCheck` decides —
  **stomp** (player falling, feet above the enemy's vertical midpoint) defeats the
  enemy (`entity.defeated = true`, shape hidden, player bounces up `jumpSpeed *
  STOMP_BOUNCE`), else **kill** (side/underneath → `respawn`, same as a hazard). A
  defeated enemy stops stepping and isn't written; `stop()` restores its shape from
  the part snapshot (position + opacity), so Play/Stop stays non-destructive.
- The stomp/kill *decision* is pure (`stompCheck`/`verticalBounds`, tested); an
  end-to-end integration sim (`enemy.integration.test.ts`) drives a player + a
  patrol enemy through the real `stepEntity` and reproduces the engine's overlap
  decision to prove patrol / stomp-and-bounce / side-kill together.

## Static props (G3a) — spring, checkpoint, one-way

Three more color-coded roles, all pure decisions in
[entities/props.ts](game/entities/props.ts) wired into `engine.ts`:

- **spring** (orange, `effect: 'bounce'`) — a trigger that launches the player up
  (`springLaunchVy(jumpSpeed * SPRING_LAUNCH)`).
- **checkpoint** (light-blue, `effect: 'checkpoint'`) — a trigger that, on first
  touch (`shouldActivateCheckpoint`), moves the respawn point to the player.
- **oneway** (light-green, `collision: 'oneWay'`) — a platform solid **only from
  above**. Tagged `Body.oneWay`; the resolver (`deepestShift`) skips it on the X
  pass and accepts only floor-normal (landing) contacts on Y — so you jump up
  through it and land on top. Unit-tested in `step.test.ts`.

## Kill-plane / bottomless pit (T0)

A **death line below the level** so falling through a gap in the floor is a death,
not a fall forever — the difference between "a gap you can walk into" and "a pit
you die in" that every classic platformer assumes. Not a role/shape: it's a
page-space Y (`GameRuntime.deathY`) computed at `start()` as
`KILL_PLANE_MARGIN` (4 tiles) below the **deepest solid's `bounds.maxY`** (or below
the player's spawn if the level has no solids at all). The pure decision is
`belowKillPlane(topY, deathY)` in [entities/props.ts](game/entities/props.ts) — it
fires only once the entity's outline **top** clears the plane (the whole body has
fallen past it), so a body still straddling the line hasn't fallen yet.

Checked each frame in `checkKillPlane()` (after `writeEntities`, before the enemy/
trigger checks). The **player** falling off costs a life and respawns via the
existing `respawn()` — identical to a hazard (a `'death'` sound, game over if out
of lives). An **enemy** that walks off a ledge into a pit is just marked
`defeated` so it stops stepping (no fall-forever, no shape flung off-page); `stop()`
still restores it from its part snapshot, so Play/Stop stays non-destructive.
Behavior-preserving: a normal 2-tile gap jump clears the pit without a false death
(proven in `entities/killplane.integration.test.ts`, which drives the real
`stepEntity` through a walk-off fall, a stay-on-ground run, and a gap jump).

## Tier-1 recreation primitives (T1a–T1f, PLAN §4.7)

Six primitives that turn the biggest set of template beats from *evocations* into
faithful recreations. Each follows the repo discipline: a **pure decision in
`props.ts`/`step.ts` + colocated test**, then the wiring in `engine.ts`. All new
per-element config rides on the shape's **`meta`** (see `PlacementMeta` in
[level.ts](game/level.ts)): a template `Placement` carries `meta`, `loadLevel`
stamps it onto the created shape, and the runtime's `start()` scan reads it back
via `metaOf`. New colors: `block` light-red, `portal` light-violet. **`platform` is
the exception to "unique color per role":** it is GREY (like a wall — the color
budget is exhausted) rendered DASHED, and identified by a `meta.role: 'platform'`
MARKER that `roleOf` checks before color (PLAN §1.3's "meta.role is the primary
mechanism for roles the color budget can't fit"). `COLOR_TO_ROLE` excludes it so
grey still resolves to `wall` — otherwise a plain grey wall would read as a platform.

**The shared sim clock.** `sine`/`mover`/`blink`/`crumble` all need "time since
start", so the runtime carries `GameRuntime.simTime` — advanced by `FIXED_DT` each
substep, **deterministic** (a function of substep count, never wall-clock) — and
sets it on each mover entity's `params.simTime` before `stepEntity`. Reset to 0 at
`start()`.

**The one new wiring pattern — movers re-read per frame.** A `mover` (T1e) is the
first **solid that moves**, so `step()` steps the movers FIRST, then rebuilds the
solids the player resolves against = static `solids` + each present mover's live
outline (`solidsWithMovers` → `moverBody`), THEN steps the player. This is the
deliberate exception to "solids captured once at start". *Limit:* there's **no
velocity inheritance** — a player standing on a horizontally moving platform isn't
dragged sideways (that's M6); vertical support (elevators) works because collision
resolution pushes the player up. Documented + pinned in `mover.integration.test.ts`.

- **T1a angled spring** — the `spring` role gains `meta.launchAngle` (deg from
  straight-up, + tilts right). `springLaunchV(impulse, angle)` returns a `{vx,vy}`
  vector; **angle 0 is byte-identical** to the old straight-up launch.
- **T1b hittable block** (`block`, ❓ light-red) — a **solid** you bonk from BELOW.
  `checkBlocks()` fires once when a rising player's head reaches its underside:
  `ejectTokenAbove` spawns a coin (if `meta.contains === 'token'`) and the block
  breaks (hidden + dropped from `solids`). Snapshotted for non-destructive restore.
- **T1c warp pipe** (`portal`, 🌀 light-violet) — a teleport trigger. Pairs link by
  `meta.channel`; `teleportThroughPortal` centers the player on the partner and
  starts `PORTAL_COOLDOWN_FRAMES` debounce so arrival doesn't instantly re-warp.
- **T1d oscillating enemy** (`enemy` + `meta.sine`) — a `motion: 'sine'` mover
  (Piranha-plant rise/fall). `sinePosition` = base + sin along an axis; no
  gravity/collision (it's on a track). Stomp/kill still work — they're AABB+vy
  tests, motion-agnostic.
- **T1e moving platform** (`platform`, 🟫 grey + dashed, marker-identified) — a `motion: 'mover'` solid on a
  ping-pong `meta.path`. `moverPosition` is a triangle wave A↔B. See the rebuild
  pattern above.
- **T1f blink / crumble platform** — `platform` variants gated by `platformPresent`
  in the solids rebuild: `meta.blink` toggles solid on a phase clock
  (`blinkSolidAt`); `meta.crumbleMs` drops it out after the player first stands on
  it (`checkCrumble` arms `entity.crumbleStandMs`; `crumbleGone` decides).

## Game session & framing (M1 lean, M5, M8)

- **Session** (M1, lean) — [session/session.ts](game/session/session.ts): a PURE
  reducer for **lives / score / timer** + the win/lose decision (`newSession`,
  `onCollect`/`onStomp`/`onDeath`/`onWin`, `tickTime`). The runtime owns a
  `Session`, calls it on each event, and `endGame('won'|'lost')` stops the sim while
  keeping the session active (so the next Play/Stop restores). A death costs a life;
  0 lives ⇒ game over. Single-level scope for now (a multi-level `GameDef` is later).
- **Follow camera** (M5) — [camera/camera.ts](game/camera/camera.ts): a PURE
  `computeCamera(player, viewport, prev)` (deadzone + velocity look-ahead), applied
  each frame via `editor.setCamera` in `updateCamera()`; the authored camera is
  captured at `start()` and restored at `stop()`. **Sign convention** (`screen =
  (page + camera) * z`) is isolated in the module's `screenTargetToCamera` — the one
  spot to flip if the view ever scrolls the wrong way.
- **HUD** (M8) — [render/Hud.tsx](render/Hud.tsx): a play-only `InFrontOfTheCanvas`
  overlay (top-center) reading `gameStateAtom` (which `emit()` sets alongside the
  App callback). Shows lives / tokens / score / timer.

## Audio (M7) — event sounds

[game/audio.ts](game/audio.ts) — a framework-free `AudioEngine` voiced with the
Salamander Grand piano (`@tonejs/piano` on Tone.js). It **reuses the line-rider
demo's audio infrastructure** (`line-rider-side/game/audio.ts`): lazy Piano build
+ CDN sample stream, a no-op fallback when Web Audio is unavailable, the
fade-not-cut mute ramp, and the "all tunables in one `AUDIO` object" discipline.
What differs is the **sound model**: line-rider sonifies *continuous surface
contact* (impact + ride); a platformer is driven by *discrete game events*, so
each event (`jump / land / collect / stomp / spring / checkpoint / death / win`)
maps to a struck note (win adds a two-note motif), with an optional 0..1 intensity
scaling velocity (a bigger fall lands harder; the coin ping brightens as you near
a full collection).

- **The runtime calls it; the sim stays silent.** `GameRuntime` holds an
  `AudioEngine` and fires `play(sound, intensity?)` at each existing event site
  (`checkTriggers` collect/spring/checkpoint/hazard/goal, `checkEnemies`
  stomp/kill). **Jump and land** happen inside the *pure* `stepEntity`, which can't
  make sound — so the runtime detects them by diffing the player's kinematic state
  across the substep (jump = left the ground rising; land = became grounded, with
  the descending speed captured BEFORE the step since the resolver zeroes `vy` on
  the landing substep).
- **Silent until a user gesture.** Tone gates its `AudioContext` behind a gesture,
  so App calls `runtime.resumeAudio()` on the **Play click** (and `disposeAudio()`
  on unmount). Before `resume()` the engine is a no-op, so **every test and flow
  that never resumes is behavior-identical** — audio adds no coupling to the sim.
- **The pure mapping is split into [game/audioMap.ts](game/audioMap.ts)** (`AUDIO`
  tunables, `SOUNDS` recipes, `midiToNote`, `soundVelocity`) with **no Tone
  import**, so it's unit-tested (`audio.test.ts`) under Vitest — Tone's ESM build
  doesn't resolve in Vitest's Node env (same class of incompatibility as the
  Cloudflare Vite plugin, see the shell CLAUDE.md). `audio.ts` imports the mapping
  and adds only the Piano/Tone I/O.

## Templates (v1 exit test, §5.5)

[templates/index.ts](game/templates/index.ts) — **frozen data** (level `Placement[]`
+ `SessionRules`), no new engine code: a template is AI-shaped data with no AI in the
loop. Ships four: **Mario-1-1-like** + **Runner** (v1's exit tests) and the Tier-1
exit tests **Underground** (bonk-blocks + warp pipe + a rising plant over real pits)
and **Factory** (a moving platform over a pit + a blink-pad gauntlet + a crumble pad
+ an angled spring). All are **original layouts built from our own block primitives**
that capture a genre's design *patterns* — NOT copies of any specific game's level
map, art, or data. Loaded from the **📦 Template dropdown in the custom top panel**
(App.tsx's `handleLoadTemplate` lays the level down + applies the rules). Each is a
regression fixture: `templates.test.ts` checks structure (one player, a goal, valid
roles); `tier1.test.ts` checks the Underground/Factory templates actually use their
intended Tier-1 primitives with working meta configs.

## Rigging — Tier A rigid + live animation (R1 + R2, PLAN §3)

The first "character comes alive" converter: a **bone rig** on the player whose leaf
shapes rotate/translate rigidly with their bones (cut-out puppet, Tier A of §6). The
authoring model is **draw bones** (the Spine/Rive/DragonBones convention), split from
play: the editor AUTHORS a skeleton → bakes it to data → a pure evaluator PLAYS it. The
**default builder player is pre-rigged and its whole body animates on Play** (R2, below).

**Authoring = drawing bones (pivot → tip).** You draw each bone as a click-drag over
the figure, FROM the joint (shoulder, hip, base of neck) TO the far end (elbow, knee).
The **start point IS the pivot**, so a limb swings about its joint, not its center —
this was the whole point of the redesign. Starting a bone near an existing bone's TIP
**snaps** to it and makes it that bone's **child**, so `shoulder → elbow → wrist` is a
real FK chain (rotating the shoulder carries the whole arm). Parts **auto-attach** to
the nearest bone segment. Pieces:

- **Pure authoring core** — [game/rig/authoring.ts](game/rig/authoring.ts): a
  `DraftRig` (bones as `pivot→tip` segments, entity-local) + `snapParentForStart` /
  `snappedStart` (tip-snap chaining), `nearestBone` (proximity auto-attach), and
  `bakeDraft` (draft → immutable `Rig`: pivot→origin relative to the parent's pivot,
  drawn direction → rest angle, |pivot→tip| → `length`, attachments → `rigid` slots).
  Editor-free, unit-tested (`authoring.test.ts` proves a shoulder swing orbits the
  whole arm about the shoulder; an elbow swing only the forearm about the elbow).
- **Entry** — the **"Rig"** button on the single selection toolbar
  ([render/PlayerToolbar.tsx](render/PlayerToolbar.tsx), which holds BOTH "Set as
  Player" and "Rig" so the contextual toolbars never stack) → `enterRigMode`.
- **The tool** — [render/RigTool.ts](render/RigTool.ts): a custom **`StateNode`**
  (id **`rig`** — a SIMPLE id, no dot: `setCurrentTool` treats a dotted id as a state
  path, so a root tool must be unqualified; registered via `tools` on `<Tldraw>`) so
  bone-drawing OWNS the pointer while active (Escape/cursor for free — the native-UI
  decision, §7.5). Pointer down = pivot (tip-snapped), move = rubber-band preview
  (`dragBoneAtom`), up = tip → commits a bone to `draftRigAtom`.
- **The overlay + panel** — [render/RigOverlay.tsx](render/RigOverlay.tsx)
  (`InFrontOfTheCanvas`): renders the draft (bone lines + pivot/tip dots) tracking the
  camera via `pageToScreen`, plus a panel — **Rig** (enter, from the contextual
  toolbar), **Auto-attach parts**, **Bake to player**, **Done**. Shared state
  (`rigModeAtom` / `rigTargetAtom` / `draftRigAtom`) lives in
  [game/rig/state.ts](game/rig/state.ts) (atoms, like game/state.ts).

**Play = a pure evaluator.** [game/rig/evaluate.ts](game/rig/evaluate.ts) is editor-free
and unit-tested (like physics.ts): given the immutable `Rig` + a live `Pose`, it runs
the §3.4 Tier-A slice — **FK** (walk the bone tree in dependency order → each bone's
world transform, for rest and pose) then **rigid deform** (per rigid leaf, delta
`D = W_pose·W_rest⁻¹`). Returns leafId → `Mat2D` delta. Its 2D affine is
[game/rig/mat2d.ts](game/rig/mat2d.ts) (no tldraw import — the rig stays pure).

**Why the split (§8 ownership rule):** the evaluator owns each child transform during
play; `writeEntities` writes only the body's base translation and then applies each
leaf's rig delta (`writeRigPart`). Collision stays the merged **rest** outline (§6) —
the rig is cosmetic, the body doesn't deform.

- **Data model** — [game/rig/types.ts](game/rig/types.ts): `Bone` (strict tree, single
  root; `x,y` = pivot relative to the parent's pivot, `rotation` = rest angle, `length`
  = |pivot→tip| descriptive), `Slot`, `Attachment` (R1 ships only `rigid`; `skinnedPath`
  is R6), `Constraint` (declared, solved in R3), `Rig` (`version: 1`, stored in the
  character's **`meta.rig`**, entity-local coords). Faithful to §3.1; only Tier-A is LIVE.
- **Runtime** — `start()` reads `meta.rig` (`readRig`) and stores the `Rig` on entity 0.
  No rig ⇒ the rigid whole-body path, unchanged. (Bones live in `meta`, not as shapes,
  so there are no markers to hide or exclude from the body.)

### R2 — live animation (the default builder walks/jumps/climbs)

R1's play pose was empty (a baked rig played at rest). **R2 makes the default builder
come alive**: it's pre-rigged and animated by a pure procedural state machine — no
clips, no timeline UI (that's a later nicety; the data path exists, see below).

- **Default rig** — [game/rig/builderRig.ts](game/rig/builderRig.ts): a pure function
  that builds a Tier-A `Rig` for the hand-drawn builder — a **`pelvis → spine → head`
  chain** with the four limb bones (`armL/armR/legL/legR`) **hanging off the spine**, so
  when the body bobs/leans the limbs follow (the whole figure moves as a body). The
  spine drives the torso; the head bone drives the head + smile + both eyes (they nod as
  one). [builder.ts](game/builder.ts) bakes it into `meta.rig` on the player group at
  create time. **Critical frame gotcha:** the rig is built against the group's **rendered
  page bounds**, NOT the art's tight `BUILDER_ART.boundsW/boundsH` — the draw strokes
  overflow those tight bounds (the arms reach out), and the runtime resolves each leaf
  relative to the **merged page-bounds top-left** ([player.ts](game/player.ts) `offX/offY`);
  building the rig in the tight frame cramps every bone toward center-x (bones drift off
  the limbs). `createBuilderPlayer` measures `getShapePageBounds(groupId)` and passes
  *those* dims. **Limbs are single un-splittable outline loops**, so each limb is ONE
  bone driving ONE leaf (no knee/elbow bend — a later art pass would split each limb).
- **The state machine** — [game/rig/walk.ts](game/rig/walk.ts): pure, editor-free (like
  physics.ts). `selectState({grounded, vx, vy, touchingWall, simTime, strideDistance})` →
  `idle | walk | jump | fall | climb`, and `poseForState` dispatches to a per-state
  procedural `Pose` (sine/offset math, no keyframe data):
  - **idle** — arms drop to the sides (static) + a breathing bob (spine/head);
  - **walk** — arms hang at the sides and swing *subtly*, the spine bobs twice per stride
    and **leans into travel** (`vx` sign), head counter-nods; amplitude scales with speed.
    The leg cycle is **driven by distance travelled, not wall-clock** (`stridePhase` reads
    `strideDistance / strideLength`, not `simTime`): the swing rate tracks the body's real
    speed and the legs **stop the instant the body stops** (a `simTime` cycle kept them
    waving while the body decelerated — the old "player slides" tell). The runtime
    accumulates `strideDistance` from the player's GROUNDED horizontal travel each substep.
    - **Two leg modes** (`WalkState.legMode`, toggled live in the physics panel →
      **Animation → IK / Straight**, `legModeAtom`, default **IK**): **straight** swings the
      THIGHS opposed with the knee kept inline (reads like the old one-piece leg);
      **IK** (Phase B) plants each foot at a **world target** (`footTarget`: distance-linear
      fore/aft in stance so the planted foot holds still, a lifted arc in swing) and solves
      the **two-bone leg chain** ([game/rig/ik.ts](game/rig/ik.ts), pure analytic
      law-of-cosines) to reach it — so the **knee bends** and the feet carry the walk.
    - **The legs are a two-bone chain now** (`thighL/shinL/thighR/shinR`, thigh child of the
      spine, shin child of the thigh — see `builderRig.ts` `legChain` + `BUILDER_LEG_BONES`),
      and the builder's single leg strokes are replaced by **generated thigh+shin segments**
      — native `draw` straight lines styled like the arms (black, medium, draw dash;
      [builder.ts](game/builder.ts) `createLegSegment`, points encoded to a `path` via
      `b64Vecs`), from the same `LEG_ANCHORS` the rig uses so art and rig align by
      construction. The runtime measures the per-side leg
      geometry (`legRigsFrom` → `LegRig`) from the rest rig once at start and passes it to the
      pose. **Three IK gotchas learned the hard way:** (1) `WALK_DEFAULTS.footDrop` MUST
      be inside the leg's full reach (thigh+shin ≈ 27px for the 120px builder) — beyond
      it the solver clamps to a dead-straight leg and the knee never bends. (2) The leg
      segments MUST be placed in the **same frame the rig is built in** (the rendered
      group bounds `rigW/rigH`, NOT the tight art `figW/figH`) — `createBuilderPlayer`
      generates them provisionally then RE-PLACES each on its bone in the rig frame after
      grouping, or the leaf sits off its pivot (worse on the off-center left leg) and
      rotates wrong. (3) `bendSign` is the SAME (−1) for both legs — an opposite sign per
      leg makes one knee bend backward (the "wrong-way leg" bug).
  - **jump** — arms sweep **up and out** overhead, legs tuck, torso stretches;
  - **fall** — arms out for balance, legs trail, torso compresses;
  - **climb** — **wall-scramble**: triggered when airborne AND `kin.touchingWall`
    (reuses the slope-jump contact machinery — no new mechanic), hand-over-hand arm reach
    with alternating leg pushes.
  All tunables live in `WALK_DEFAULTS` (`amplitude`, `cadence`, `strideLength`, `bob`,
  `lean`, `armDrop`, `idleBob`, …). `engine.ts` sets `playerEntity.pose = poseForState(...)` each substep;
  an empty pose ⇒ identity ⇒ rest is byte-identical to as-drawn.
- **Clip scaffold (data path, no UI yet)** — [game/rig/clip.ts](game/rig/clip.ts): a
  keyframed `Clip` type + `sampleClip`/`mergePose`, so data/AI-authored clips (R5) drop
  in beside the procedural path *without rework* — both just return a `Pose`. Unit-tested;
  nothing drives it live yet.
- **Bones toggle** — `showRigDebugAtom` (default **off** so the figure shows clean); a
  play-time **🦴 Bones** button in [render/RigOverlay.tsx](render/RigOverlay.tsx)
  (bottom-right, clear of the native minimap) shows/hides the live skeleton overlay,
  which `engine.ts` publishes via `rigDebugAtom` + `evaluateBoneWorlds`.

**Tests:** `mat2d.test.ts`, `evaluate.test.ts`, `authoring.test.ts`,
`rig.integration.test.ts` (R1 math), `ik.test.ts` (2-bone solver: FK round-trip lands the
foot on target, reach clamping, bend-side), plus `builderRig.test.ts` (chain structure incl.
the two-bone leg chains + whole-body propagation), `walk.test.ts` (state machine, per-state
poses, distance-driven stride, `footTarget` planner + IK FK round-trip), and `clip.test.ts`
(the sampler). End-to-end: `e2e/walk-e2e.mjs` drives real Play and asserts the limbs swing
while walking, settle at rest, and (IK mode) the **knee bends** over the stride. Physics
constraints (spring/damped IK) are R3; auto-rig (vision) R4; auto-animate (clips) R5;
weighted skinning R6.

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

- **Walls block, they don't lift (no "slide up walls").** Each axis pass ignores
  the OTHER axis's surfaces symmetrically: the X pass skips floor-ish/slope
  contacts (`|nx| < WALL_NX`), and the Y pass skips near-vertical WALL contacts
  (`|nx| >= WALL_NX`). Without the Y-pass guard, a sample jammed into a wall's SIDE
  resolves to the wall's nearest edge — often its top corner — and dividing the
  push depth by that near-zero `|ny|` flings the player UP the face. A second,
  sneakier path fed the same glitch: a sample landing exactly on a wall's vertical
  edge is dead-on-the-boundary in `collision.ts` → `penetration`, which used to
  return a hardcoded "nudge up 0.5px"; it now pushes PERPENDICULAR to the governing
  edge (horizontal, out of the wall). Together these keep a grounded player pinned
  flat against a wall (which then reads as `idle`, and airborne-into-a-wall as
  `climb` — the walk.ts wall states line up for free). Pinned in `step.test.ts`
  ("does NOT slide the player up its face"), `collision.test.ts` (the vertical-edge
  normal), and `e2e/wall-e2e.mjs` (the real running app).

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

- **The player and enemies move; the terrain doesn't.** The player (`platformer`)
  and enemies (`patrol`, G2a) are stepped entities; walls/tokens/hazards/goal are
  static and the level is gathered once at `start()`. More movers (moving platform,
  projectile, ball, spawner) are further motion kinds (PLAN.md §G2/G3).
- **Solids are captured once at start**, in page space — a rotated wall collides
  by its real outline (see collision.ts) but a wall moved/rotated mid-play won't
  update. Collision is not swept: keep walls thicker than one substep's travel to
  avoid tunneling at high speed (no continuous collision detection yet).
- **Enemies collide with terrain but not each other**, and the player passes
  *through* an enemy (contact fires stomp/kill rather than blocking). Enemies read
  the same `solids` captured at start — they patrol static ground, not each other
  or moving platforms.
- **The player is driven by `shape.x/shape.y`** of the player record — the group
  (or lone shape), top-level and unrotated. Moving the group carries its parts;
  but don't rotate the player record, or re-parent it under something else, and
  expect the sim to track it.
- **A group player's COLLISION body is rigid.** Parts are merged into one outline
  at `start()` and the collision body never deforms. With a **rig** the leaves
  *can* move relative to each other visually (the evaluator drives each), but that's
  cosmetic — collision still uses the merged rest outline (§6). Without a rig, the
  parts ride rigidly as before. The default builder IS rigged and articulated during
  play (R2 — the walk.ts state machine drives it); collision still uses its merged
  rest outline, so the moving limbs don't change what the body collides by.
- **`stop()` must restore each part's ROTATION, not just x/y/opacity.** A rigged
  leaf's record `rotation` is overwritten every frame by `writeRigPart`
  (`restRotation + rig delta`). The part snapshot (`PlayerPart.snap`, captured in
  `player.ts` → `collectPlayerBody`) therefore carries `rotation` too, and `stop()`
  restores it. WITHOUT this, a play session that ends mid-pose (most reliably a WIN,
  which freezes the player rotated) leaves each leaf at its last posed rotation; the
  next `start()` reads THAT as the new rest (`restRotation = pageTransform.rotation()`)
  and re-applies the rig delta on top — the rig misaligns to the character and the
  drift COMPOUNDS every replay (limbs fly off). Pinned in `e2e/replay-e2e.mjs`.
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
runtime → manual editor → AI → docs). All reach the user through **one** door:
**✨ Generate** in the custom top panel (a button that drops down a form —
[render/GeneratePanel.tsx](render/GeneratePanel.tsx), which takes the `editor` as a
prop since the topbar renders outside tldraw's context), with a target selector —
never a button per converter (PLAN §7.5). Add a converter by adding a target here.

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
  - **The brief is grid-aware.** `levelBrief()` teaches the 60px `TILE` grid (think
    in tile rows/cols; ground floor row 8; a wide floor is ONE stretched wall, not
    stacked squares), states reach in tile units (~2-tile gap/rise), and — since the
    only building blocks are the 7 roles — tells the model to express THEME through
    **layout** (a dungeon = an enclosed corridor: floor + a ceiling wall row + side
    walls). This is the level.ts / template design language handed to the AI.
  - **`applyLevelLayout` snaps to the grid** (`snapToTile`, sizes floored to one
    tile) as a safety net, so even off-grid model output lands as clean as a
    hand-built level. The pure snap is unit-tested (`autoLevel.test.ts`); the apply
    path itself is editor-bound and not unit-tested.

Both proven end-to-end against the live API. Set the key first:
`wrangler secret put ANTHROPIC_API_KEY` (a local `.env` `ANTHROPIC_API_KEY` works
for `npm run dev`). Note: **AI output is non-deterministic** — the same prompt
yields different (valid) data each call; that's authoring, not the loop. The
runtime is deterministic only once the data is fixed.

## tldraw v5 reference

Offline doc exports live in [docs/tldraw/](../../../docs/tldraw/) — start at
`llms.txt`. Confirm version-sensitive APIs against the installed `tldraw`.
