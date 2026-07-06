---
name: engine-runtime-conventions
description: The load-bearing invariants for touching the Engine demo's play-mode runtime (the sim). Use whenever you edit game/engine.ts, game/physics.ts, the entity step loop, or any code that writes to the tldraw canvas during play. Encodes the hard-won rules that keep Play/Stop non-destructive and the player able to move.
---

# Engine runtime conventions

The Engine demo (`src/demos/engine/`) turns tldraw — an editor, not a game loop —
into a platformer. `game/engine.ts` → `GameRuntime` **is** the loop. These rules
are non-negotiable; breaking one produces a class of bug that looks like "the
game is subtly broken" rather than a crash, so they're easy to violate and hard
to debug. The source of truth is [engine/CLAUDE.md](../../CLAUDE.md); this skill
makes the rules executable for any agent touching the sim.

## The invariants (do not break)

1. **Every canvas write during play goes through
   `editor.run(fn, { history: 'ignore', ignoreShapeLock: true })`.**
   The sim rewrites the player's position ~60×/sec; without `history: 'ignore'`
   it floods the undo stack and Stop can't cleanly restore. `ignoreShapeLock` lets
   the sim move locked shapes. Authoring actions (e.g. `markAsPlayer`) are the
   exception — they're *meant* to be undoable, so they use normal history. Rule of
   thumb: **sim writes = ignore history; user-authoring writes = normal history.**

2. **NEVER lock play with `editor.updateInstanceState({ isReadonly: true })`.**
   `isReadonly` also blocks the runtime's *own* `updateShape` calls, so the player
   can never move. (The Line Rider demos get away with it only because they animate
   an *overlay*, not a real shape.) Play isn't hard-locked — `start()` just clears
   selection, and because the sim overwrites the player's position every frame, a
   stray drag self-heals on the next tick. If you think you need to lock the
   canvas, you don't.

3. **Pure sim math is editor-free and unit-tested.** The movement/jump/gravity
   math lives in `game/physics.ts` (see `stepVx`/`stepVy`/`gravityMult`/`approach`)
   and touches **no** tldraw API — that's what lets `physics.test.ts` test it
   directly. Collision math lives in `game/collision.ts` with `collision.test.ts`.
   When you add a pure computation (an ability, an IK solve, an entity motion
   function), put it in an editor-free module with a colocated `*.test.ts`, not
   inline in `engine.ts`. Follow the `physics.ts` precedent exactly.

4. **Feel knobs are data, never inline literals.** Every tunable that shapes how
   the player moves lives in **all three** of: the `PhysicsTunables` interface,
   the `PHYSICS_DEFAULTS` object, and (if it should show in the live panel) a
   `TunableSpec` in `TUNABLE_GROUPS` — all in `physics.ts`. Adding a magic number
   like `vy *= 0.4` inline in `engine.ts` is a bug: it can't be tuned live, the
   Copy/Reset panel won't see it, and the AI feel-tuner (planned) can't reach it.
   The runtime reads `tunablesAtom` each substep so panel edits apply mid-play —
   don't cache tunables across substeps or read `PHYSICS_DEFAULTS` directly in the
   loop; read `this.tunables()`.

5. **Non-feel constants go in `SIM`** (`physics.ts`) — substep `FIXED_DT`, frame
   clamp `MAX_FRAME`, the `GROUND_NY` / `WALL_NX` normal thresholds. These never
   need live tuning; keep them out of `PhysicsTunables`.

6. **`persistenceKey="tlArcade-engine-native"` is unique to this demo and must
   never be shared or changed casually.** Levels persist in localStorage under it;
   the shell [CLAUDE.md](../../../../CLAUDE.md) documents why a shared key silently
   merges demos' documents. If you add a second persistence surface, give it its
   own key.

## The Play/Stop contract

- `start()` snapshots authored `{x, y, opacity}` of everything it might mutate,
  reads the level off the canvas **once**, and runs a fixed-timestep sim on
  `requestAnimationFrame`. Returns `false` if there's no player.
- `stop()` restores the snapshot. **Play/Stop must stay non-destructive** — after
  a Stop the canvas is byte-for-byte the authored scene. If you add sim state that
  mutates a shape (opacity, position, a new prop), you MUST snapshot it in
  `start()` and restore it in `stop()`, or Stop will leave the mutation behind.
- The player is driven by writing each **leaf** shape's `x/y` (a group's container
  transform is derived from its children — don't write the group record). See
  `writePlayer` and `game/player.ts`.

## The fixed-timestep loop (don't change its shape casually)

`frame()` accumulates real dt (clamped to `SIM.MAX_FRAME`) and runs `step()` in
fixed `SIM.FIXED_DT` slices, then does the visible `writePlayer()` + trigger
check **once per rendered frame** (not per substep). Physics that must be
frame-rate-independent goes in `step(dt)`; per-frame canvas writes go in `frame`.
Don't move `updateShape` calls into `step()` — you'd write the canvas 120×/sec.

## Before you report done

Run the `engine-verify` skill (build + test + lint + drive the flow). A sim change
that type-checks but softlocks the player, floods undo, or leaves a mutation after
Stop is **not** done. Play-test: Play, move, jump, touch a token/hazard/goal, Stop,
confirm the scene restored.
