# Sisyphus — plan

A new **template** for the Engine demo: push a gravity-affected boulder up a hill
and get it into the goal. Lives inside the existing Engine demo (adds one role +
one motion kind to the Engine's own vocabulary, then ships as frozen template
data). The demo-switcher entry stays **Engine**.

## Decisions (locked)

- **Core verb — builder pushes the ball.** You drive the existing rigged builder
  in real time to shove a boulder uphill. Reuses the platformer player unchanged;
  the straining/leaning builder imagery comes free from the `walk.ts` state
  machine. No hands-off "watch" mode in v1.
- **Push model — body-block / contact push.** The boulder inherits a fraction of
  the player's horizontal velocity on contact. No new input verb.
- **Win — boulder reaches the goal.** No Sisyphean loss twist (rollback line /
  endless hill / quota) in v1 — that's a fast follow-up once this is playable.

## The scope in one line

**One new role (`boulder`) + one new motion kind (`roll`) + two small `engine.ts`
wirings (push + goal-fires-on-boulder) + one template (frozen data).** Everything
pure is unit-tested; the two wirings get an integration test. No rig work, no AI,
no new render surface beyond a tray icon.

Per the `engine-data-converter` recipe this is the **manual/data** slice only
(steps 1–3, 5): a new game element with a pure tested runtime, authored by hand as
template data. There is **no AI converter** (step 4) — a template is "AI-shaped
data with no AI in the loop", exactly like the shipped Mario/Factory templates.

---

## Build order (smallest-first; each step green before the next)

### 1. `roll` motion — the pure sim core (`game/entities/`)

The load-bearing new primitive. A branch in `stepEntity` (`entities/step.ts`),
pure and editor-free, unit-tested next to `patrol`/`mover`/`sine` in
`step.test.ts`.

- **It is a falling, colliding entity** — it uses the shared gravity +
  per-axis-resolve path (like `platformer`/`patrol`), NOT the position-driven
  early-return path (`sine`/`mover`). So it seats on slopes and collides with
  walls for free via `resolveAxis`/`deepestShift`.
- **What `roll` adds on top of the shared path:**
  - **Rolling friction, not instant stop.** The platformer rubs `vx` off fast
    (`stepVx` friction); the boulder keeps momentum — `vx` decays by a gentle
    `rollFriction` factor per substep so a shove carries.
  - **Gravity-along-slope.** On a slope contact the boulder accelerates *downhill*
    along the surface tangent (this is the "gravity fights you" feel — let go and
    it rolls back down). Derived from the governing contact normal `resolveAxis`
    already computes; no new collision code.
- **New motion params** live in `MotionParams` (`entities/types.ts`) — nothing
  needed beyond the existing sim-clock fields; roll reads only tunables + contact.
- **Tunables discipline (invariant 4).** `rollFriction`, `slopeAccel`, and the
  push transfer are **not inline literals**. Roll-specific knobs that shape feel
  go in `PhysicsTunables` + `PHYSICS_DEFAULTS` (+ a `TUNABLE_GROUPS` spec if we
  want them in the live panel); non-feel constants (if any) go in `SIM`. Decide
  per-knob whether it's live-tunable — lean yes, so the physics panel can dial the
  boulder in during play.

**Test (`step.test.ts`):** a boulder on a flat floor with an initial `vx` coasts
and slowly decelerates (momentum); a boulder on a slope with zero `vx`
accelerates downhill; a boulder hitting a wall stops. Hand-built `Body` fixtures,
no editor — same style as the patrol/mover tests.

### 2. `boulder` role (`game/roles.ts`)

- New `ROLES.boulder`: `geo: 'ellipse'`, `motion: 'roll'`, `collision: 'solid'`,
  `effect: 'none'`, default size **1×1 tile** (`tiles(1)` — sits on the wall
  grid).
- **Unique color** — **brown/sienna** (thematic, currently unused). Add it to
  `COLOR_TO_ROLE` so a drawn/recolored brown ellipse reads as a boulder, and
  confirm no existing role uses it (invariant: color *is* the behavior, each role
  color must be unique).
- Tray icon in `render/icons.tsx` + a tray entry (a circle glyph). Follows the
  `tldraw-v5-native-ui` rules — it's just another role in the existing tray, no
  new surface.

### 3. Body-block push (`game/engine.ts`)

A per-frame check mirroring `checkEnemies`, run in the same effect phase:

- On **player ↔ boulder AABB overlap**, transfer a fraction of the player's `vx`
  into the boulder's `vx` (a `pushTransfer` tunable). One-directional: the player
  shoves the ball; the ball doesn't yank the player (the player's own collision
  handles resistance — see below).
- **The boulder must be a SOLID the player can lean into**, not a pass-through
  trigger (enemies pass through; a boulder must physically resist or you can't
  push it uphill). Reuse the **`solidsWithMovers` rebuild pattern** (CLAUDE.md
  "movers re-read per frame"): step the boulder first, then rebuild the solids the
  player resolves against to include each boulder's live outline, then step the
  player. This is the one subtle bit — the boulder is a moving solid, like a
  mover platform.
- **Play/Stop contract (invariant).** The boulder's shape is moved every frame →
  snapshot its `{x,y,opacity}` in `start()` and restore in `stop()`, exactly like
  the enemy. A boulder that reaches the goal / rolls offscreen must restore
  cleanly. Non-destructive after Stop.

### 4. Goal fires on the boulder (`game/engine.ts`)

The `goal` trigger currently tests the **player** outline (`checkTriggers`). Add:
the goal also fires **win** when a **boulder** entity's outline overlaps it. In a
Sisyphus level the win condition is "boulder delivered", so this is the actual
objective. Keep the player-overlap win working too (levels without a boulder are
unchanged — behavior-preserving for existing templates).

- Token-gate interaction: today `goal` only wins once every token is collected.
  Decide the Sisyphus rule — simplest is "boulder in goal wins outright"; if a
  level has tokens, keep the existing gate. Encode explicitly, don't leave
  ambiguous.

### 5. Integration test (`game/entities/boulder.integration.test.ts`)

Like `mover.integration.test.ts`/`enemy.integration.test.ts`: drive a real
player + a boulder through the actual `stepEntity` + the solids-rebuild, and prove
end-to-end: (a) the player can push the boulder up a ramp (contact transfer +
solid resistance), (b) an un-pushed boulder on a slope rolls back down, (c) the
boulder overlapping the goal triggers win. Pins the two `engine.ts` wirings.

### 6. The template — "The Hill" (`game/templates/index.ts`)

Frozen `Placement[]` + `SessionRules`, authored on the 60px tile grid per the
`engine-level-design` skill. Consult that skill for the buildable envelope (jump
reach, slope-walkability, grid alignment) before authoring.

- Player + boulder at the bottom of a long ramp (angled `wall` shapes climbing
  left→right), goal at the top. A rest-ledge or two (flat spots where the ball
  settles so you can regroup). Keep slopes **walkable** for the player but steep
  enough that the boulder rolls back if you stop pushing — that tension *is* the
  game; tune the slope angle against `roll`'s `slopeAccel` vs the player's push.
- Register in `TEMPLATES` + `TEMPLATE_LIST` so it appears in the 📦 Template
  dropdown.
- **Fixtures:** extend `templates.test.ts` (one player, a goal, valid roles —
  now including `boulder`); optionally a Sisyphus-specific structural check (has a
  boulder, has a ramp) like `tier1.test.ts` does for its primitives.

### 7. Document it (`src/demos/engine/CLAUDE.md`)

A short section (same density as the enemy / Tier-1 sections): the `boulder` role
+ `roll` motion, the push wiring + solids-rebuild reuse, goal-fires-on-boulder,
and the template. Per `engine-data-converter` step 5.

---

## The one subtle risk to watch

**Boulder-as-solid vs. push feel.** The boulder must resist the player (so you can
lean into it uphill) AND accept a push impulse (so it moves). These pull opposite
ways: too much resistance and it's a wall you can't move; too little and the
player tunnels through. The `solidsWithMovers` pattern gives resistance; the
`pushTransfer` contact impulse gives motion. If body-block feels bad in practice,
the fallback (per the earlier decision) is a dedicated push action — but prototype
body-block first and tune `pushTransfer` / `rollFriction` / `slopeAccel` live in
the physics panel before reaching for it.

**Known limit inherited from the sim:** no velocity inheritance — a player
standing on a horizontally moving solid isn't dragged (CLAUDE.md M6). Not relevant
to pushing, but means the boulder won't carry a player who stands on it. Fine for
v1.

## Verification (the `engine-verify` gate)

Before "done": `npm run build` + `npm test` + `npm run lint` green, then **drive
the actual flow** — load "The Hill", Play, push the boulder up the ramp into the
goal (win fires), let go mid-slope and watch it roll back, Stop and confirm the
boulder restored to its authored spot (non-destructive). A change that
type-checks but where the boulder can't be pushed, or doesn't restore after Stop,
is **not** done.

## Explicitly out of scope for v1 (fast follow-ups)

- The Sisyphean **loss twist** (rollback line mirroring the kill-plane / endless
  hill / delivery quota).
- An **AI converter** (auto-generate a Sisyphus level) — the recipe's step 4.
- More Sisyphus templates ("Switchbacks", "The Gauntlet", the "endless hill"
  joke).
- Player velocity inheritance / riding the boulder.
