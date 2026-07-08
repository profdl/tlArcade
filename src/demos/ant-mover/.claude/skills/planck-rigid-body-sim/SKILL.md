---
name: planck-rigid-body-sim
description: Use when building or tuning the ant-mover planck.js physics — the T rigid body, the maze static bodies, the grab-anywhere force model, or the fixed-tick step loop. The idioms for a server-authoritative rigid-body sim in the Durable Object (contingent on the step-0 planck-in-Worker gate).
---

# planck.js rigid-body sim (ant-mover)

The **ant-mover** demo (`src/demos/ant-mover/`) is a multiplayer piano-movers
game: many humans each click-drag *anywhere* on ONE rigid **T-shaped body** and
pull it through a tight maze. Everyone's pulls sum on one body — coordinate and
it glides through the gap; yank against each other and it jams sideways in the
corridor. **That jam is the game.** Making it feel right needs a mature
rigid-body solver, not a hand-rolled one.

**Source of truth:** [ANT_MOVER_PLAN.md](../../ANT_MOVER_PLAN.md). Read it first —
it owns the build order (steps 0–7) and the architecture decisions. This skill is
the physics reference for steps 0, 2, 4, 5. There is **no in-repo planck
precedent**; this skill is where the idioms live.

## The step-0 gate (read this before you `import planck`)

planck is **NOT yet a verified dependency here.** The plan has a step-0 GATE that
must first prove `import planck` *instantiates and steps* a world inside a
Cloudflare Worker / Durable Object under `@cloudflare/vite-plugin`. **Do not
assume planck works server-side until that gate passes.** Frame all planck usage
below as *contingent on the gate*.

Fallback ladder if the gate (or a later perf ceiling) fails:

1. **Rapier2D** — the documented fallback engine. WASM, so it fights the Worker's
   no-async-WASM-load + cold-start limits (see "Why planck" below), but it's the
   next real engine to try.
2. **Hand-rolled Verlet solver** on tldraw segments — LAST resort. The sonic demo
   ships one (`src/demos/sonic/game/physics.ts`): Verlet points + distance
   constraints, swept segment collision. Generalizes to a T (points + rigid
   distance constraints), but the plan's whole reason for a real engine is the
   corridor-squeeze, where hand-rolled solvers jitter / tunnel / explode. Use only
   if both engines are unavailable.

## Why planck over a WASM engine (Rapier), single-authority

- **Synchronous instantiation.** The DO has no-async-WASM-load + cold-start
  limits; a WASM engine (Rapier) wants an async init. planck is **pure JS** and
  instantiates **synchronously** — exactly what a DO alarm tick needs (no await
  before the world exists).
- **Determinism doesn't matter here.** planck's cross-machine determinism is
  weak, but the **DO is the single authority** — the only simulator. No client
  runs the sim authoritatively, so there's no cross-client lockstep to keep in
  sync. planck's determinism limits are irrelevant by design.
- **Right APIs.** Compound bodies (welded fixtures) and force-at-an-arbitrary-point
  are first-class in Box2D/planck — the two things the T load and the grab model
  need.

## Core model

> All code below is **illustrative** — API names and signatures **must be
> verified against the installed planck version** and its TypeScript types /
> docs. Prefer getting the *concept* exactly right and flagging the call as
> needs-verification over asserting a signature you're unsure of.

### 1. The T load — one compound dynamic body

The T is **one DYNAMIC body** carrying **two box fixtures** — a stem and a
crossbar — welded/overlapping into the T outline. It is a **compound rigid body**:
it rotates and collides as a single unit; the two boxes never move relative to
each other.

```js
// VERIFY every call against installed planck's API/types.
const t = world.createBody({ type: 'dynamic' });
t.createFixture(planck.Box(halfStemW,  halfStemH,  planck.Vec2(sx, sy)), fixtureDef);
t.createFixture(planck.Box(halfCrossW, halfCrossH, planck.Vec2(cx, cy)), fixtureDef);
// The two Box offsets (sx,sy)/(cx,cy) place both fixtures on ONE body → the T.
```

- **It is FREE TO TUMBLE.** The T has **no preferred orientation** — no upright.
  **Do NOT copy the sonic sled's self-righting rig** (`PHYSICS.uprightStiffness`
  in `sonic/game/physics.ts` rotates a mast back toward "up" each step). That rig
  exists so a sled stays upright; an awkward object being dragged through a maze
  should tumble freely. No upright spring, no orientation constraint, no preferred
  angle.
- Give it a sane linear + angular damping so pulls don't leave it spinning
  forever, but never a restoring torque toward an angle.

### 2. The maze — static bodies

The maze walls are **STATIC bodies** (`type: 'static'`) built from **box or chain
fixtures**. The whole reason a real engine is worth the risk is the
**corridor-squeeze**: a long body wedging as it rotates through a tight gap — the
exact case where hand-rolled solvers jitter / tunnel / explode and a mature Box2D
contact solver stays stable. Build the maze as static geometry and let the solver
earn its keep there.

- Box fixtures for straight walls; chain fixtures for longer/angled runs if you
  need them (verify the chain API against installed planck).
- Keep walls thicker than one tick's max travel (see anti-tunneling below).

### 3. The grab model (design-locked)

A player grab = a **spring force applied at an off-center point.** The whole game
feel is the torque from grabbing the T *away from its center of mass*.

- **On mousedown:** hit-test the cursor against the T. If it hits, record a
  **BODY-LOCAL anchor** — the grip point in the body's own frame — so the grip
  stays stuck to that same spot on the T as the T rotates/translates. (planck
  typically exposes a world→local point transform; verify the exact call.)
- **Each tick, for each holding player:** resolve the stored local anchor to its
  live **WORLD** point, then apply a spring force toward the cursor **at that
  point**:

  ```js
  // VERIFY signatures. Force AT A POINT (not the center) is the whole mechanic.
  const anchorWorld = t.getWorldPoint(localAnchor);      // local → world
  let f = mul(sub(cursorWorld, anchorWorld), SPRING_K);  // spring toward cursor
  f = clampMag(f, MAX_GRAB_FORCE);                       // clamp — see below
  t.applyForce(f, anchorWorld /*, wake=true */);          // AT the point, not center
  ```

- **Applying at the point, not the center, is non-negotiable** — that's what
  produces the rotation from off-center pulls. `applyForceToCenter` would kill the
  game.
- **Clamp the force magnitude.** This is both a feel knob and the **anti-tunneling
  guard** (an unclamped spring on a far cursor can inject enough velocity to jump a
  wall in one tick).
- **Any number of players; forces just SUM.** Two players may grab the same spot;
  there is **no arbitration** — each holding player applies its own force each tick
  and planck accumulates them. That summing *is* the co-op/conflict mechanic.

### 4. The fixed-tick step loop

Step the world at a **FIXED dt** (~`1/30`), driven from the DO `alarm()` loop that
re-arms itself each tick. **Never a variable/wall-clock dt.**

```js
// VERIFY step signature (dt, velocityIterations, positionIterations) vs planck.
world.step(FIXED_DT, VELOCITY_ITERS, POSITION_ITERS);
```

- **Keep velocity + position sane (clamp).** After the step (or by clamping input
  forces), keep the T's linear/angular velocity under a ceiling so a body never
  travels more than roughly a wall-thickness per tick — the same anti-tunneling
  discipline the sonic sim uses (`maxSpeed` clamp kept below `2*r/FIXED_DT`; see
  `sonic/game/physics.ts`). Reference sonic for the **anti-tunneling mindset
  only**, NOT for its sled rig.
- Fixed dt keeps the sim stable and reproducible across ticks regardless of how
  jittery the alarm re-arm timing is.

### 5. Server-authoritative — the sim runs ONLY in the DO

- The simulation lives **only in the Durable Object.** Clients send grab input UP
  and render the poses the DO broadcasts DOWN. **Clients never simulate
  authoritatively.**
- The input/pose transport is the separate **`tlarcade-do-realtime-sim`** skill's
  job (custom sync messages, not raw `ws.send`); this skill is only the physics.
- **The one exception:** step 2's **LOCAL-ONLY client sim**, which runs planck in
  the browser to prove the piano-movers feel *before* any netcode exists. That is
  deliberate and temporary — and it's the **same sim code** that later ports
  verbatim into the DO in step 4. Write step 2's sim so it can move server-side
  without a rewrite (editor-free, no DOM/React coupling in the sim core — mirror
  the sonic `physics.ts` "pure sim module" discipline).

## Gotchas / do-nots

- **Do NOT copy sonic's upright/self-righting rig.** The T tumbles freely; it has
  no preferred orientation. `uprightStiffness` is wrong for this body.
- **Do NOT use a variable dt.** Fixed `~1/30` from the alarm loop, always.
- **Do NOT simulate on clients** (except the explicit step-2 local-only feel
  spike, which is throwaway/portable, not authoritative).
- **Do NOT apply grab force at the center.** Off-center, at the live world anchor —
  the torque is the game.
- **Do NOT skip the force/velocity clamp.** It's the anti-tunneling guard, not
  just a feel knob.
- **Do NOT trust any signature in this file without checking installed planck.**
  Verify against the package version + its TypeScript types / docs before you rely
  on a call.

## Reference files

- [ANT_MOVER_PLAN.md](../../ANT_MOVER_PLAN.md) — source of truth (build order,
  architecture table, fallback decisions).
- `src/demos/sonic/game/physics.ts` — the anti-tunneling + pure-sim-module
  discipline to mirror; the sled's `uprightStiffness` rig to explicitly AVOID.
- `tlarcade-do-realtime-sim` skill — the DO alarm loop + custom-message
  input/pose transport (the netcode half; this skill is the physics half).
- tldraw v5 offline docs: `docs/tldraw/llms.txt` (canvas/render side, for the
  client that draws the broadcast pose).
