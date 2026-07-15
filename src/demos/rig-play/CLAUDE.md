# CLAUDE.md — Rig Play

Guidance for working on the **rig-play** demo. Keep it short and true to the code — if a
fact here drifts from the source, fix the source and update this file.

## What this is

A **focused rig playground**: draw bones on a character, bake, then hit **Play** and
drive it with the keyboard. It is the Engine demo's rig (draw-bones authoring + a pure
evaluator + a procedural walk state machine), **lifted out of the platformer** — no
terrain, collision, entities, triggers, camera, physics tuning, or AI. Just: rig a
figure, then a lightweight WASD mover brings it to life.

Controls (Play): **A/D** move + flip facing · **W/Space** jump · **S** crouch · **E** wave.

## Self-contained by copy

Per the shell CLAUDE.md ("each demo self-contained"), the pure rig core is **copied
verbatim** from `engine/game/rig/` into [rig/](rig/) — `mat2d.ts`, `evaluate.ts`,
`ik.ts`, `authoring.ts`, `types.ts`, `builderRig.ts` (all editor-free, unchanged) and
`walk.ts` (the one file we EXTENDED — see below). No import coupling to `engine/`, so
divergence is free. Unique `persistenceKey="rig-play"` and `.rigplay-*` CSS prefix (the
two collision traps the shell CLAUDE.md calls out).

## The authoring ↔ play split (inherited from Engine)

- **Authoring = draw bones.** [render/RigTool.ts](render/RigTool.ts) is a custom
  `StateNode` (id **`rig`** — a SIMPLE id, no dot: `setCurrentTool` treats a dotted id
  as a state PATH and silently fails). Pointer down = pivot (tip-snapped → child),
  up = tip → commits a bone to `draftRigAtom`. [render/RigOverlay.tsx](render/RigOverlay.tsx)
  renders the draft + a panel (auto-attach parts → bake to character). Authoring atoms
  live in [render/rigState.ts](render/rigState.ts) (`rigplay:`-namespaced). Bake writes
  the immutable `Rig` to the character's **`meta.rig`**.
- **Play = a pure evaluator + a procedural pose.** [game/runtime.ts](game/runtime.ts)
  is the loop. Each fixed substep it runs the WASD mover, builds a `WalkState`, asks the
  pure state machine ([rig/walk.ts](rig/walk.ts)) for a `Pose`, evaluates the rig
  ([rig/evaluate.ts](rig/evaluate.ts)) → per-leaf `Mat2D` deltas, and writes each leaf
  (`writeRigPart`) + the body's base translation. Bones live in `meta.rig`, not as
  shapes, so nothing but leaf transforms move.

## The WASD mover ([game/runtime.ts](game/runtime.ts))

A tiny KINEMATIC mover — NOT a physics sim, NO collision, NO terrain. A/D approach
±`MOVE.moveSpeed` (exponential blend), W/Space is an edge-triggered gravity hop caught
by a **single floor line** (`floorY` = the character's start bottom), S sets a crouch
flag, E fires a one-shot wave timer. It feeds `{grounded, vx, vy, strideDistance, crouch,
wave, legMode, legs}` into `poseForState`. Everything else about the character's motion
is just the walk state machine reacting to those inputs.

**walk.ts additions over the Engine copy** (the only diverged rig file):
- a **`crouch`** grounded state (beats idle/walk; ignored airborne) → `crouchPose`
  (spine sinks + squashes, knees bend, arms drop);
- a one-shot **`wave`** (0..1 phase) LAYERED over the base state's pose in `poseForState`
  — only `armR` is overridden, so you can wave while idle OR walking.
Pinned in [rig/walk.test.ts](rig/walk.test.ts).

## Load-bearing invariants (carried from `engine-runtime-conventions`)

- **All canvas writes go through `editor.run(fn, { history: 'ignore', ignoreShapeLock:
  true })`** so play never pollutes undo.
- **`stop()` restores each part's ROTATION, not just x/y/opacity.** A rigged leaf's
  record `rotation` is overwritten every frame by `writeRigPart` (`restRotation` + rig
  delta). `BodyPart.snap` therefore carries `rotation`; without restoring it, `stop()`
  leaves a leaf at its last posed rotation and the next `start()` reads THAT as the new
  rest → the rig drifts and compounds every replay.
- **Don't lock play with `isReadonly`** — it also blocks the runtime's own
  `updateShape` calls (the character can never move). Selection is just cleared at start.
- **The default figure's rig is built in the RENDERED page-bounds frame**, not the art's
  tight `BUILDER_ART.boundsW/H` (the strokes overflow the tight bounds; building there
  cramps the bones toward center-x). See [game/builder.ts](game/builder.ts)
  `createBuilderCharacter` → `getShapePageBounds(groupId)`.

## The character

A **group** of native shapes marked `meta.role === 'character'` (see
[game/body.ts](game/body.ts) — a trim of Engine's `player.ts`: `collectRigBody` gathers
per-leaf offsets/rotations/snap for `writeRigPart`, NO collision sampling). "Add figure"
drops the **pre-rigged builder** ([game/builder.ts](game/builder.ts), ported from Engine)
— a pelvis→spine→head chain with arm bones + two-bone leg chains — so it walks the moment
you Play. Or draw your own art, select it, hit **Rig**, draw bones, and bake.

## Verify

- `npm run build` (tsc + vite), `npm run lint`, `npm test` (incl. `rig/walk.test.ts`).
- **Drive the real app** — [e2e/rig-play-e2e.mjs](e2e/rig-play-e2e.mjs) (Playwright,
  DEV `window.__rigplay` hooks): asserts the default figure has a baked rig, holding D
  translates it + swings the legs (IK knee bends), standing still settles, E waves, W
  jumps. Run: `npm run dev` then `node src/demos/rig-play/e2e/rig-play-e2e.mjs` (needs
  `playwright` + chromium; install ad-hoc — it is not a repo dep).

## tldraw v5 reference

Offline doc exports live in [docs/tldraw/](../../../docs/tldraw/) — start at `llms.txt`.
