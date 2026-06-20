# CLAUDE.md

Guidance for working in this repo. Keep it short and true to the code — if a
fact here drifts from the source, fix the source of truth (the code / README)
and update this file.

## What this is

A [Line Rider](https://en.wikipedia.org/wiki/Line_Rider) clone on **tldraw v5**:
draw track on the canvas, hit Play, watch a constraint-solved multi-point sled
ride it under a hand-rolled Verlet physics sim. **Vite + React 19 + TypeScript**, no
physics-engine dependency.

## Commands

```bash
npm run dev    # vite dev server -> http://localhost:5173
npm run build  # tsc -b + vite build (run this to type-check)
npm test       # vitest run (physics unit tests)
npm run lint   # eslint
```

## Architecture

Read [README.md](README.md) for the file-by-file map; it's accurate. The short
version:

- [src/App.tsx](src/App.tsx) — mounts `<Tldraw>`, control panel, mounts `Rider`
  via `components.InFrontOfTheCanvas`. Toggles `isReadonly` while playing. The
  `components` object is a **module-level constant** (stable identity) so the
  overlay never remounts; gameplay state flows through atoms (see state.ts), not
  props.
- [src/game/state.ts](src/game/state.ts) — the shared gameplay atoms
  (`playing`/`follow`/`startPoint` inputs, `stats`/`score` outputs). Atoms, not
  React state/props, so `App`'s `components` object stays referentially stable —
  threading these through props would remount `Rider` mid-ride and snap the sled
  to the start. App mirrors them with `useValue`; Rider polls/writes them in its
  rAF loop.
- [src/game/geometry.ts](src/game/geometry.ts) — turns collidable native page
  shapes into page-space collision segments; maps shape **color → `LineKind`**.
  Also collects `note` shapes as scoring checkpoints (oriented boxes, so a
  rotated note's catch region matches its footprint, not its inflated AABB).
- [src/game/checkpoints.ts](src/game/checkpoints.ts) — pure checkpoint hit-test
  (point-in-oriented-box, scored once per run). **Pure & framework-free.**
- [src/game/physics.ts](src/game/physics.ts) — the sim. The sled is a multi-point
  body (`makeBody`/`stepBody`); `step()` is the single-point primitive it reuses,
  so both share one collision path (`resolveCollisions`). `PHYSICS` holds all
  tunables. **Pure & framework-free** — keep it that way so the unit tests stay
  simple. It reports surface contacts for audio by *pushing* `ContactEvent`s into
  an optional sink (`step`/`stepBody`'s last arg); omit the sink and behavior is
  byte-identical, so it makes no sound itself.
- [src/game/audio.ts](src/game/audio.ts) — Web Audio surface sounds. **Pure of
  React/tldraw**; the rAF loop is its only caller. Per-kind voices: a one-shot
  `impact` on contact-enter and a sustained, speed-scaled `setRide` voice while
  riding. All tunables in the `AUDIO` object.
- [src/game/Rider.tsx](src/game/Rider.tsx) — fixed-timestep rAF loop; draws the
  sled body as an SVG polygon, writing its screen-space geometry imperatively
  each frame (no per-frame React render). Owns the audio engine: passes a reused
  contact sink into `stepBody`, does enter-detection (diffs this substep's
  contact keys vs. last) to fire impacts, and drives the ride voices.

## Core design contract: native-first

There is **no custom shape and no custom tool**. Users draw with tldraw's
built-in pencil/geo/line tools and pick a color; we read each shape's geometry
and interpret its color as gameplay behavior. Preserve this — prefer reading
native shapes over inventing custom records.

## Gotchas (things that will bite you)

- **Position the overlay with `editor.pageToViewport`, not `pageToScreen`.** The
  sled lives in `components.InFrontOfTheCanvas`, which tldraw mounts inside the
  editor *container* (CSS `inset: 0` on `.lr-sled-svg`). `pageToViewport` returns
  container-relative coords; `pageToScreen` returns window-relative ones and
  drifts by the container's screen offset whenever the editor isn't flush to the
  window. See the comment in `Rider.tsx`.
- **Keep the `components` object referentially stable.** It's a module-level
  const in App.tsx. tldraw remounts a `components` slot when the object's
  identity changes, so threading volatile state (play/follow/start/stats) through
  it would remount `Rider` and reset its rAF loop mid-ride. That state lives in
  atoms (state.ts) instead; the overlay reads/writes them, App mirrors with
  `useValue`.
- **Read geometry inside `editor.run(..., { history: 'ignore' })`.** tldraw's
  geometry/transform caches (`getShapeGeometry`, `getShapePageTransform`) are
  reactive computeds; read cold from a bare rAF callback they can return
  pre-move values, silently breaking collision after a shape is dragged. See the
  comment in `collectSegments`. Also pass the shape **id** to those calls, not
  the enumerated snapshot object.
- **Draw (pencil) shapes hold multiple strokes** separated by pen-lifts. Decode
  each stroke with `getPointsFromDrawSegment` and push it separately — never
  bridge across strokes or you draw phantom collision lines.
- **Collision is swept, not proximity-only.** `resolveCollisions` resolves each
  point against a segment via `sweptContact`, which tests the point's THIS-STEP
  motion (`prev`→`pos`) against the line and orients the contact normal toward
  the side the point came from. This is what stops a fast point tunneling through
  a thin line, and stops the "ejected into the inside of a box" bug (a one-sided
  push-out using `pos - closestPoint` sends a point that landed just past a line
  deeper through it). A consequence: collision no longer depends on a shape's
  outline winding, so rotating/transforming a geo shape can't flip which side is
  solid.
- **Tunneling threshold (still keep it).** Swept collision catches a single
  thin-line cross, but stacked thin lines or huge per-step jumps can still slip
  through. Any new behavior that raises speed should stay under
  `~2 * riderRadius / FIXED_DT`; `accelerateMaxSpeed` is the existing cap — copy
  that pattern rather than relying on the swept test alone.
- **New physics tunables go in the `PHYSICS` object**, not as inline literals.
- **Only `COLLIDABLE_TYPES` shapes are track.** `collectSegments` allowlists
  `draw`/`line`/`geo`/`arrow`; text, images, frames, etc. are skipped so they
  don't act as invisible walls. To make a new shape type ridable, add it there.

## Adding a line behavior (color → kind)

The kind→behavior split already exists. To add one:
1. extend the `LineKind` union in physics.ts,
2. add color rows to `COLOR_TO_KIND` in geometry.ts,
3. add the per-kind branch in the collision block in `step()`,
4. add a `physics.test.ts` case proving the effect vs. plain solid.

The full color→behavior roadmap (all 13 tldraw colors) lives in
[PLANNING.md](PLANNING.md).

## tldraw v5 reference

Offline copies of tldraw's LLM doc exports (pinned at download time) live in
[docs/tldraw/](docs/tldraw/):

- `llms.txt` — the index. **Start here** to find the right SDK feature, then
  read its section.
- `llms-docs.txt` — full SDK feature guides (shapes, geometry, camera,
  coordinates, components, `editor.run`, etc.).

When unsure about a tldraw API, consult these before guessing. They're a
snapshot — for anything version-sensitive, confirm against the installed
`tldraw` package version (`^5.1.1`).
