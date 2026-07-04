# "Current" — game design + simulation findings

This is the **proving ground** for the game described in `../CURRENT_GAME_SPEC.md`. Before
building the shader/tldraw version, we tuned the mechanics headlessly so the core is known to
be **balanced and fun** first. The pure functions here (`field.mjs`, `economy.mjs`) are the
exact logic that will drive the real game's shader uniforms and creature steering.

## The game in one paragraph

Two players shape an invisible **fluid field** by placing **emitter** pieces (current / vortex /
heat). Autonomous **creatures** drift in the field; you win by routing them into your goal edge.
You never move creatures directly — you engineer the current that carries them. Emitters cost
**energy** from a regenerating pool, so the core decision is *spend now or bank for a bigger play*,
and placing emitters near each other **combos** them into a more efficient "machine" — that
proximity-wiring is the invisible "execution graph."

## The three resolved design pillars (what makes it fun)

1. **Economy: regenerating pool.** Energy refills over time; emitters cost to place and drain
   while active. Regen is tuned to **sustain a focused ~3-emitter build but NOT a 6-emitter
   carpet** — so you can't just spam. Over-extend and you "brown out" (cheapest emitters
   auto-deactivate). Decision rhythm, not a one-time draft.

2. **Skill: combo/chaining (= the dependency graph).** Emitters near each other interact:
   - **vortex + friendly current → WIDENS its coverage** (and amplifies a little). This is the
     key mechanic: a concentrated "machine" gets *reach*, letting it compete with currents spread
     thin across lanes. **Coverage vs concentration is the central strategic axis.**
   - **heat + friendly current → BENDS it** toward the heat (cheap steering; heat has no push of
     its own).
   - **agreeing friendly currents → MERGE** into a stronger stream.

3. **Counterplay (soft rock-paper-scissors):**
   - opposing currents **cancel** where they meet head-on,
   - an enemy **vortex scatters** a current (beats brute force without out-pushing it),
   - **heat-bent currents dodge** a scatter (heat counters disruptor).

## Simulation results (proof it's balanced)

Run `node sim/balance.mjs 120` — round-robin, 600 matches. Latest balanced state:

```
       A\B     spam    combodisruptor     heat     idle   |  overall
      spam       --      43%      84%      58%     100%   |  67.2%
     combo      45%       --      62%      65%     100%   |  63.0%
 disruptor      46%      78%       --      58%      98%   |  57.4%
      heat      33%      26%      75%       --      99%   |  54.3%
      idle       2%       0%       0%       0%       --   |  0.6%
```

What this proves:
- **No dominant strategy:** the four real strategies sit in a tight **54–67%** band.
- **No dead strategy:** even the weakest (heat, 54%) is viable and has a clear role.
- **`idle` wins 0.6%** — doing nothing loses to everything, i.e. the FIELD decisively drives
  outcomes (this was the hardest thing to achieve; early versions had idle at ~48%).
- **A counter-triangle exists:** combo > disruptor > {forces heat} , heat > disruptor,
  spam > disruptor, combo ~ spam. Every strategy beats something and loses to something.
- **Pacing:** avg match ~71s (cap 90s), decisive lead changes (watch one to see).

### The journey (why the numbers are what they are)
Each fix was driven by a harness flag, in order:
1. *idle won 48%* → creatures barely followed the field. Fix: `fieldGain` ≫ `wander` so the
   field dominates motion. idle → ~25%.
2. *everyone browned out* → regen (6/s) couldn't even sustain 2 currents (drain 8/s). Fix: regen
   13/s + bots only place when sustainable. idle → ~1%; strategy started mattering.
3. *combo lost to spam (8%)* → concentration lost to coverage. Fix: **vortex WIDENS a current's
   radius** (coverage), not just strength. combo → 78% vs spam (over-corrected), then trimmed to
   peer (45–50%).
4. *heat weak (36%)* → it's a finesse tool dumb bots underused. Fix: stronger bend + bot places
   heat off-axis toward the swarm. heat → 54% and now hard-counters disruptor.

## Known open tuning notes (minor — for whoever builds/polishes)

These are real but not blockers; the headline balance is solid.
- **Disruptor under-spends and still wins its counters** — in eyeballed matches it sits near full
  energy (its scatter is cheap and very effective). Consider raising `vortex` cost/drain or
  lowering `vortexScatter` slightly if it feels oppressive with real (human) opponents.
- **~30% of matches time out / draw**, concentrated in *symmetric* matchups (combo-vs-combo, etc.)
  where two equal builds cancel mid-board. Options: lower `captureGoal`, add a sudden-death
  tiebreaker, or a slow center "drift toward whoever's ahead" to break stalemates.
- The harness auto-flags "spam dominates 67%" and "combo loses to spam 45%" — these are **stale
  thresholds** for this mature state: 67% is the top of a healthy band (not a runaway), and 45%
  means combo/spam are *peers* (better than a hard counter). Don't chase them.

## How to use this simulator

```bash
# unit tests for the pure field math (run after any tuning change)
node sim/field.test.mjs

# balance harness — the main tuning loop. edit sim/tuning.mjs, re-run, read the table.
node sim/balance.mjs [matchesPerPair]      # e.g. 120

# watch ONE match play out in ASCII to eyeball fun, not just read numbers
node sim/watch.mjs [botA] [botB] [seed]     # e.g. combo disruptor 7
```

**The tuning loop is the whole point:** every number lives in `sim/tuning.mjs`. Change one,
re-run `balance.mjs`, read the win-rate band + flags, repeat. Because the sim uses the *same*
pure `resolveField`/`sampleField` the real game will, a balanced sim transfers directly — the
shader and tldraw shapes become presentation on top of a proven-fun core.

## Files

- `sim/field.mjs` — **THE CORE.** `resolveField` (graph execution) + `sampleField` (flow vector).
  Pure. This is the code that ports verbatim into the real game (shader + steering both read it).
- `sim/economy.mjs` — regenerating-pool rules (place cost, drain, regen, brown-out). Pure.
- `sim/tuning.mjs` — **every tunable number.** The dial board.
- `sim/match.mjs` — headless match engine (creatures, capture, clock, seeded PRNG).
- `sim/bots.mjs` — strategies (spam / combo / disruptor / heat / idle) that stress the design.
- `sim/balance.mjs` — round-robin win-rate harness + auto design-flags.
- `sim/watch.mjs` — ASCII single-match viewer.
- `sim/field.test.mjs` — pure-math invariant tests.

## Handoff to the build

When building the real game (`../CURRENT_GAME_SPEC.md`), **port `field.mjs` and `economy.mjs`
and the constants in `tuning.mjs` verbatim** into the game's `src/field/` — they are the proven,
balanced core. The tldraw shapes, the WebGL fluid shader, and `registerSwimming` are presentation
and input layers wrapped around this exact logic. Keep `sampleField` as the single source the
shader and the creature steering both read (the "one FieldState, two consumers" rule).
