---
name: engine-level-design
description: The buildable envelope for authoring an Engine level — the tile grid, the player's real jump reach, the full role vocabulary and each role's can/can't + meta config, and a validation checklist. Use whenever you hand-author a level (level.ts / a template), write a level-generation prompt/brief, or review whether a level is winnable and on-grid.
---

# Engine level design

Everything an author (human or AI) needs to lay down a **winnable, on-grid**
Engine level. This is the design language behind [game/level.ts](../../game/level.ts),
the [templates](../../game/templates/index.ts), and the `levelBrief()` in
[game/ai/autoLevel.ts](../../game/ai/autoLevel.ts) — keep all three consistent
with what's here. If a fact drifts, fix the source ([roles.ts](../../game/roles.ts)
is the registry of record) and update this skill.

The organizing idea: a level is **`Placement[]`** — a role + a page position
(+ optional size + optional Tier-1 `meta`). Nothing else. The runtime reads roles
off the canvas at `start()`; there is no separate level format.

## The grid (non-negotiable)

- **1 tile = 60px** (`roles.ts` → `TILE`). Author in tile units via `tiles(n)`
  (aliased `T` in level.ts), never raw pixels.
- **Every `x/y/w/h` is a whole-tile multiple** (a few roles are half-tile, 30px).
  Off-grid values look broken and the AI apply path snaps them anyway
  (`autoLevel.ts` → `snapToTile`), so author on-grid from the start.
- **The ground row's top is `T(8)` = y=480.** A surface whose top is tile row `R`
  has `y = R*60`. Coordinates increase **down and right** (tldraw page space).
- **A wide floor is ONE stretched wall**, not many stacked 1×1 squares
  (`{ role: 'wall', x: T(0), y: T(8), w: T(9), h: T(2) }`), — cheaper and cleaner.

## The player & its reach (what sizing is built around)

The default player is the drawn **builder** (`game/builder.ts`), **1 tile wide ×
2 tiles tall (60×120)** — the classic platformer footprint. Every size and gap
below is scaled to what that 1×2 body does under the shipped physics
(`PHYSICS_DEFAULTS`: `moveSpeed 340`, `jumpSpeed 860`):

- **One jump clears ~a 2-tile-wide GAP and ~a 2-tile RISE.** So:
  - Make gaps **~2 tiles** wide (3+ needs a spring, a mover, or is a death pit).
  - Step platforms **up ~2 tiles at a time**, each landing platform **≥2 tiles
    wide** (a full player-width of landing).
- **Standing height is 2 tiles.** Anything that *stands on* a row-`R` surface and
  is 2 tiles tall (player, goal) is placed at **`y = T(R-2)`**. General rule:
  `y = (R - h_in_tiles) * 60`.
- **Tokens (½ tile) sit ~1½ tiles above a surface** — inside the jump arc, so
  they're grabbed in passing, not out of reach.
- A **screen is ~15 tiles wide × ~8 tall**; a longer level extends in +x.

## The role vocabulary (the only building blocks)

Twelve roles ([roles.ts](../../game/roles.ts) → `ROLES`). Color **is** behavior
for the original set; the three Tier-1 roles past the color budget use a
`meta.role` marker. Default sizes are whole/half-tile multiples — override per
placement only when the design needs it.

| Role | Color | Default (tiles) | Can | Can't / gotcha |
|---|---|---|---|---|
| **player** | blue | 1×2 | the one input-driven body; stomps enemies, dies to hazards | exactly ONE per level; it's the drawn builder, not a geo shape |
| **wall** | grey | 1×1 | solid terrain — stretch to whole-tile floors/platforms/steps | doesn't move; captured once at `start()` |
| **token** | yellow | ½×½ | collectible; ALL must be collected before the goal opens | — |
| **hazard** | red | 1×½ | trigger → respawn (a spike) | never blocks; it's a trigger, walk *into* it to die |
| **goal** | green | 1×2 | win — but ONLY once every token is collected | put it past the challenges, reachable |
| **enemy** | violet | 1×1 | patrols, turns at walls/ledges; stomp from above (bounce), lethal from side | passes *through* the player (trigger); needs ground to patrol on |
| **spring** | orange | 1×¼ | launch pad; `meta.launchAngle` deg aims it (0 = straight up) | a trigger — overlap launches you |
| **checkpoint** | light-blue | ½×1½ | first touch moves the respawn point here | — |
| **oneway** | light-green | 2×¼ | land ON from above, jump UP through from below | thin; place at the row you want to land on |
| **block** | light-red | 1×1 | solid you bonk from BELOW; `meta.contains: 'token'` ejects a coin, else breaks | fires once; needs headroom above for the bonk/eject |
| **portal** | light-violet | 1×2 | teleport to its channel partner; pair via `meta.channel` | needs a PARTNER with the same `channel`; debounced on arrival |
| **platform** | grey + dashed | 2×½ | a moving solid (`meta.path` A↔B), or blink/crumble variant | grey like a wall — identified by a `meta.role` marker, NOT color; **no velocity inheritance** (a horizontal mover carries you visually but doesn't fling you on jump — that's M6) |

## Tier-1 `meta` config (per `PlacementMeta` in [level.ts](../../game/level.ts))

Each field is only meaningful for its role. Stamp it on the placement's `meta`:

- **spring** — `launchAngle?: number` (deg; 0 straight up, + tilts right).
- **block** — `contains?: 'token' | null` (coin above, or just break).
- **portal** — `channel: number` (a PAIR shares one channel).
- **enemy (oscillator)** — `sine: { amplitude, frequency, axis: 'x'|'y', phase? }`
  → a `motion: 'sine'` track-rider (Piranha plant); no gravity/collision.
- **platform (mover)** — `path: { ax, ay, bx, by, speed }` ping-pong A↔B.
- **platform (blink)** — `blink: { onMs, offMs, phaseMs? }` — solid on a phase clock.
- **platform (crumble)** — `crumbleMs: number` — drops out that long after first stood on.

## Theme through LAYOUT, not new blocks

The 12 roles are the whole vocabulary — express a THEME by *arrangement*:
a cave/dungeon = an enclosed corridor (floor + a ceiling wall row + side walls);
a tower = a tall vertical climb; a field = wide and open. Don't invent a role the
level needs — compose it, or (if it's genuinely a missing primitive) that's a
PLAN §4.6 gap, not a level-authoring problem.

## Validation checklist (a level is done when ALL hold)

1. **Exactly one player**, on solid ground, near the left.
2. **A reachable goal**, placed after the challenges.
3. **Every token reachable** within the ~2-tile jump arc from a surface.
4. **Every gap is either ~2 tiles (jumpable), spring/mover-assisted, or a
   death pit** — never an accidental 3-tile gap you can't clear and don't die in.
5. **Every landing platform ≥2 tiles wide**; every rise ≤~2 tiles (or assisted).
6. **All coordinates whole-tile multiples** (half-tile only for the ½-tile roles).
7. **Nothing rests off its surface**: a 2-tile-tall body on row-`R` top is at `T(R-2)`.
8. **Paired roles are paired**: every portal has a same-`channel` partner.
9. **Bonk/eject room**: a `block` with `contains: 'token'` has open tiles above it.
10. **Winnable end-to-end** — trace start→goal collecting every token; if a
    template can't be authored from these blocks, a *primitive* is missing (fix
    the primitive, don't special-case the level — PLAN §5.5).

## Where this shows up

- **level.ts** `DEFAULT_LEVEL` — the reference hand-authored level; read its
  comments for the row-by-row reasoning.
- **templates/index.ts** — frozen `Placement[]` + `SessionRules` (the §5.5 exit tests).
- **autoLevel.ts** `levelBrief()` — this same envelope handed to Claude; keep the
  brief and this skill in sync (both cite the grid, the reach, the role list).
