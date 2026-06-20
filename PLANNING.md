# Planning — tldraw Line Rider

Living design/roadmap doc. Code-confirmed facts live in the README; this file
holds decisions and not-yet-built plans.

## Open decisions

### Unmapped colors collide as solid (current behavior)

`kindOf` in [src/game/geometry.ts](src/game/geometry.ts) defaults any shape
whose color isn't in `COLOR_TO_KIND` to `'solid'`, and `collectSegments` pulls
in every non-scenery shape on the page. Consequence: text, images, frames, etc.
act as solid collision geometry (invisible walls).

**Decision (for now):** leave it. Unmapped colors — and shapes with no color —
behave as basic solid track, same as black lines. This keeps the native-first
contract simple: "anything not opted out (scenery-green) is track."

**Planned:** assign a distinct gameplay behavior to *every* tldraw color so the
default-to-solid fallback only ever applies to truly color-less shapes
(text/image/frame). See below.

## Roadmap: behavior for all 13 tldraw colors

tldraw v5's default palette (`TLDefaultColorStyle`) has 13 colors. Today
`COLOR_TO_KIND` maps 8 of them to 4 kinds. The plan is to give each color a role.
Lighter shades pair with their base color as a "weaker/variant" version so the
palette stays learnable.

| Color           | Current kind | Planned behavior                                              |
|-----------------|--------------|--------------------------------------------------------------|
| `black`         | solid        | **Solid** — basic collidable track (the default line).       |
| `grey`          | solid        | **Solid** — same as black; a neutral alias.                  |
| `red`           | accelerate   | **Accelerate** — tangential boost in the direction of travel.|
| `light-red`     | accelerate   | **Accelerate (weak)** — smaller boost than red.              |
| `orange`        | —            | **Decelerate / brake** — tangential drag, slows the sled.    |
| `yellow`        | —            | **Bounce / trampoline** — high restitution (springy).        |
| `green`         | scenery      | **Scenery** — decorative, non-collidable (unchanged).        |
| `light-green`   | scenery      | **Scenery** — non-collidable alias (unchanged).              |
| `blue`          | oneway       | **One-way (up)** — collide from the front only.              |
| `light-blue`    | oneway       | **One-way (weak/down)** — one-way, opposite-facing variant.  |
| `violet`        | —            | **Sticky / high-friction** — strong tangential drag, "grip". |
| `light-violet`  | —            | **Sticky (weak)** — mild high-friction variant.              |
| `white`         | —            | **Ice / frictionless** — zero surface friction, max glide.   |

### Implementation notes

- **Where it lands:** the kind→behavior split already exists. `COLOR_TO_KIND`
  in [geometry.ts](src/game/geometry.ts) maps color → `LineKind`; `step` in
  [physics.ts](src/game/physics.ts) switches on `seg.kind`. New behaviors mean
  (1) extend the `LineKind` union in physics.ts, (2) add the color rows to
  `COLOR_TO_KIND`, (3) add the per-kind branch in the collision block.
- **Tunables:** new behaviors should get named constants in the `PHYSICS` object
  (e.g. `brakeDrag`, `bounceRestitution`, `iceFriction`) rather than literals,
  matching the existing `accelerateBoost` / `accelerateMaxSpeed` pattern.
- **Tunneling guard:** any behavior that raises speed (bounce, ice) must respect
  the `~2*riderRadius / FIXED_DT` tunneling threshold — cap speed like
  `accelerateMaxSpeed` does, or the sled shoots through thin lines.
- **Tests:** each new kind needs a `physics.test.ts` case proving its effect
  vs. plain solid (the accelerate/oneway tests are the template).
- **Weak vs. strong variants** are the same `LineKind` with a different constant,
  *or* distinct kinds — decide per behavior when implementing; prefer one kind +
  a magnitude field only if the math is otherwise identical.

### Still TODO before any of this ships

- Decide whether non-track shape *types* (text/image/frame) should be excluded
  from collision entirely, independent of color (see "Open decisions" above).
- A legend/UI hint so players know which color does what.
