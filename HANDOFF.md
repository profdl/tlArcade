# Busytown — handoff to the build phase

## What this is
A tldraw (v5) canvas that feels like a living little town. The player drops
characters, props, and vehicles in and they come alive — always active, with
roughly **1–2 interactions happening at any moment**.

It is a **faked** simulation, deliberately. No ecology, no energy economy, no
conservation. The earlier predator–prey path was abandoned: the "alive" feeling
comes from legible activity and local interactions, not from a balanced food web.

## Architecture (three layers, sim never imports tldraw)
```
sim/      source of truth. Plain TS + Miniplex (ECS). Knows nothing about tldraw.
render/   reads entities, syncs tldraw shapes ~10×/sec (TICK_MS). Wrap writes so
          they never hit the undo stack.
tldraw    canvas + interaction. Custom shape utils, kept lightweight.
```

## The one mechanic
Props advertise **affordances** (`sit`, `shop`, `perch`, `home`). Townsfolk carry
a shifting **whim**, seek the nearest matching affordance, walk over with visible
intent, and play a short animation. Dropping a new element registers its
affordances live; nearby townsfolk notice it on their next whim roll. That's the
whole "comes alive" hook (`dropEntity` in components.ts).

## Verified numbers (don't re-derive — measured over 6 seeds)
- Start roster: **7 townsfolk, 4 birds**, 2 benches, 1 stall, 3 houses, 3 trees, 1 van.
- Lands at **~1.7 concurrent interactions**; something happening ~87% of the time;
  pile-ups (4+) only ~7%.
- **Townsfolk count is the only dial that matters.** Birds are garnish.
- Start low (7) on purpose: the player's additions push it toward bustling.
- Two knobs to retune density without changing counts: interaction **duration**
  and **GREET_RADIUS** (both in config.ts → TIMING).
- All numbers ported from a Python feel-sim; full mix was bench chat 40%,
  buy 25%, greet 14%, restock/flee ~10% each — varied, not repetitive.

## Files in this spec
- `config.ts` — every tunable, with the finding behind each number.
- `components.ts` — Miniplex `Entity` type, `buildWorld()`, `dropEntity()`.
  Typechecks clean against miniplex@^2.

## Next phase

### Step 0 — scaffold the runnable project (do this first)
These spec files are not yet a bootable app. Set up before writing systems:
- `npm create vite@latest . -- --template react-ts`
- `npm i miniplex tldraw`
- Place `config.ts` and `components.ts` under `src/sim/`.
- Mount a tldraw canvas in `App.tsx` and confirm it renders (the v5 `<Tldraw />`
  component). No custom shapes yet — just prove the canvas boots.
- Verify `buildWorld()` runs (a throwaway `console.log(world.entities.length)`).

### Step 1 — write the systems
`sim/systems.ts`, each a Miniplex archetype query over `buildWorld()`:
1. **whimSystem** — when a townsperson is idle past its cooldown, re-roll a whim
   (WHIM_WEIGHTS) and pick the nearest affordance matching it.
2. **moveSystem** — step movers toward `mover.target` at `speed`; set `arrived`.
3. **arriveSystem** — on arrival: `sit` (bench), `shop` (decrement stall stock),
   or idle (wander/home), with dwell from TIMING.
4. **greetSystem** — walking pairs within GREET_RADIUS, off cooldown → greet.
5. **benchChatSystem** — 2 seated on one bench → ongoing chat interaction.
6. **fleeSystem** — bird within FLEE_RADIUS of a person/van → flee, then re-perch.
7. **vanSystem** — drive the path; stop at stall for VAN_RESTOCK_DUR; refill; leave.
Then a `render/bridge.ts` that diffs entity positions → tldraw shapes at TICK_MS.

Port the headless Python (`sim.py`) for behavior reference; it already produced
the verified cadence.
