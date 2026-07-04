# CLAUDE.md

Guidance for working in this directory. Keep it short and true to the code —
if a fact here drifts from the source, fix the source of truth (the code /
README) and update this file.

> **This is one prototype in the [tlArcade](../../../CLAUDE.md) platform**,
> mounted at `/demos/line-rider-machines`. It has no `package.json`/build of
> its own — everything below (`npm run dev`/`build`/`test`/`lint`) runs from
> the **repo root**. It's a fork of `line-rider-classic` — check there too if
> something seems shared but missing here.

## What this is

A [Line Rider](https://en.wikipedia.org/wiki/Line_Rider) clone on **tldraw v5**:
draw track on the canvas, hit Play, watch a snail on a constraint-solved sled rig
ride it under a hand-rolled Verlet physics sim — upright and tracking the slope,
ragdolling on a hard crash. **Vite + React 19 + TypeScript**, no physics-engine
dependency.

## Commands (from the repo root)

```bash
npm run dev    # http://localhost:5173/demos/line-rider-machines
npm run build  # tsc -b + vite build for the whole app (type-checks this demo too)
npm test       # vitest run — includes this demo's physics unit tests
npm run lint   # eslint, whole repo
```

## Architecture

Read [README.md](README.md) for the file-by-file map; it's accurate. The short
version:

- [App.tsx](App.tsx) — mounts `<Tldraw>`, control panel, mounts `Rider`
  via `components.InFrontOfTheCanvas`. Toggles `isReadonly` while playing. The
  `components` object is a **module-level constant** (stable identity) so the
  overlay never remounts; gameplay state flows through atoms (see state.ts), not
  props.
- [game/state.ts](game/state.ts) — the shared gameplay atoms
  (`playing`/`follow`/`startPoint`/`showCollisions` inputs, `stats`/`score`
  outputs). `showCollisions` is a debug toggle that makes `Rider` draw the actual
  collision geometry (each shape's segments + the sled rig's contact circles).
  Atoms, not React state/props, so `App`'s `components` object stays referentially stable —
  threading these through props would remount `Rider` mid-ride and snap the sled
  to the start. App mirrors them with `useValue`; Rider polls/writes them in its
  rAF loop.
- [game/geometry.ts](game/geometry.ts) — turns collidable native page
  shapes into page-space collision segments; maps shape **color → `LineKind`**.
  Also collects `note` shapes as scoring checkpoints (oriented boxes, so a
  rotated note's catch region matches its footprint, not its inflated AABB).
- [game/checkpoints.ts](game/checkpoints.ts) — pure checkpoint hit-test
  (point-in-oriented-box, scored once per run). **Pure & framework-free.**
- [game/portals.ts](game/portals.ts) — pure portal teleport: `pointInMouth`
  (reuses the checkpoint oriented-box test) + `teleportBody` (re-centers the rig
  on `exit.center`, rotating velocity by the mouths' rotation difference, speed
  preserved — see the entrance-detection gotcha below for why the re-center is
  anchored on the body's own center rather than the entrance mouth's). A
  **portal is authored natively as an
  arrow bound at both terminals to geo shapes** (`start`→entrance, `end`→exit) —
  no reserved color, the arrow's bindings *are* the link. `geometry.ts` reads the
  bindings (`collectPortalsNow` via `editor.getBindingsFromShape`) and excludes the
  arrow + its two mouths from collision; `runController.stepFixed` applies the
  teleport after each substep, guarded by a `Body.portalCooldown` so it can't
  immediately re-enter. `scale` is carried on `Portal` but fixed at 1 (v1); the
  exit/entrance size ratio will drive scale portals later. A **multiplier** is
  the same grammar with a second arrow out of the same entrance shape
  (`geometry.ts`'s `groupPortalArrowsByEntrance` groups arrows by entrance id;
  exactly 1 → `Portal`, 2+ → `Multiplier`): instead of teleporting, `splitBody`
  clones the rig (`cloneBody` in physics.ts) and teleports the original out
  `exits[0]` and the clone out `exits[1]`, both anchored on the same origin as a
  normal `teleportBody` call. **Pure & framework-free.**
- [game/physics.ts](game/physics.ts) — the sim. The rider is a **sled
  rig** (`makeBody`/`stepBody`): a runner base (`BACK`<->`FRONT`) plus a mast held
  upright by a spring (`applyUpright`), so it rides upright and **tracks the
  slope** (`bodyAngle`) like classic Line Rider instead of tumbling — until a hard
  hit latches `body.crashed` (see `shouldCrash`) and the spring switches off so it
  ragdolls. `step()` is the single-point primitive the rig reuses, so both share
  one collision path (`resolveCollisions`). `PHYSICS` holds all tunables. **Pure &
  framework-free** — keep it that way so the unit tests stay simple. It reports
  surface contacts for audio by *pushing* `ContactEvent`s into an optional sink
  (`step`/`stepBody`'s last arg); omit the sink and behavior is byte-identical, so
  it makes no sound itself.
- [game/audio.ts](game/audio.ts) — surface sounds, voiced with the
  Salamander Grand piano via `@tonejs/piano` (on Tone.js). **Pure of
  React/tldraw**; the rAF loop is its only caller, through the same
  `AudioEngine` interface as before (`resume`/`impact`/`setRide`/`setMuted`/
  `dispose`), so swapping the synth didn't touch `Rider`. A piano is struck, not
  a drone, so surfaces are sonified as **notes**: `impact` strikes a note on
  contact-enter; `setRide` retriggers a soft note on a speed-scaled cadence while
  riding. Each `LineKind` owns a register + scale (`KIND_NOTES`); speed climbs
  the scale. Samples **stream from the library's CDN (tambien.github.io) on first
  play** and the browser caches them; `load()` is async and all sound is skipped
  until it resolves. All tunables in the `AUDIO` object.
- [game/SnailArt.tsx](game/SnailArt.tsx) — the snail character SVG,
  normalized to a belly-centered, +x-facing local frame the rig places each frame.
- [game/Rider.tsx](game/Rider.tsx) — fixed-timestep rAF loop; draws each
  active rider's snail (`SnailArt`) as an SVG group from a **pre-mounted, fixed
  pool of `MAX_RIDERS` slots** (a multiplier split changes the rider count
  mid-run, and this pool means that never triggers a React re-render — see the
  gotcha below), writing each slot's transform (position from `bodyCenter`,
  rotation from `bodyAngle`, scale from zoom) imperatively every frame (no
  per-frame React render) and hiding slots past the current rider count. Owns
  the audio engine: passes a reused contact sink into `stepBody`, does
  enter-detection (diffs this substep's contact keys vs. last) to fire impacts,
  and drives the ride voices.

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
- **Pass the shape *id* (not the snapshot object) to geometry/transform reads,
  and read them reactively.** tldraw's `getShapeGeometry` / `getShapePageTransform`
  are reactive computeds that invalidate **automatically** when a shape's props
  change (epoch-based). The freshness bug we hit — stale geometry after dragging a
  shape — was caused by passing the *enumerated snapshot object* to these calls;
  passing `shape.id` makes the cache resolve against the live record and fixes it.
  An `editor.run(..., { history: 'ignore' })` transaction does **not** force a
  cache recompute — invalidation is automatic and reads inside a `computed` are
  tracked as dependencies on their own. So the track is exposed as reactive
  `makeSegmentsComputed` / `makeCheckpointsComputed` views: read `.get()` (every
  frame for the live debug overlay; once at run start to freeze the gameplay
  snapshot) and they only recompute when shapes change. See `collectSegmentsNow`
  / `makeSegmentsComputed` in geometry.ts.
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
- **Portal entry detection is a per-substep point sample, not a sweep** — unlike
  wall collision, there's no `sweptContact`-style boundary crossing test for
  `pointInMouth`. At high speed the body's center can land anywhere inside the
  entrance box on the substep that trips it (edge, corner, or dead center), not
  right at the boundary. `teleportBody` anchors the rig's re-center on the
  body's own center at that moment (not the entrance mouth's center), so the
  exit position is always exactly `exit.center` regardless of where inside the
  box the crossing happened — anchoring on the entrance mouth's center instead
  would carry that arbitrary offset into the exit frame and could pop the rider
  out past a smaller exit mouth's bounds. See `portals.test.ts`'s "lands
  exactly on exit.center..." case.
- **`RunController` owns an ARRAY of riders, not one.** A multiplier split
  (see the portals.ts bullet above) can grow it up to `MAX_RIDERS`.
  `currentBody`/`facing` still exist and mean "the PRIMARY rider (`riders[0]`)"
  — every pre-multiplier call site (tests, stats, the start marker) keeps
  working against that single body — but reach for `bodies`/`facings` when you
  need every active rider (Rider.tsx's render pool and debug overlay, the
  camera-follow centroid, checkpoint scoring). `stepFixed` steps a *snapshot* of
  the rider count each substep so a rider spawned by a split doesn't also get
  stepped (and potentially re-split) in the same substep it was created.
- **New physics tunables go in the `PHYSICS` object**, not as inline literals.
- **Only `COLLIDABLE_TYPES` shapes are track.** `collectSegmentsNow` allowlists
  `draw`/`line`/`geo`/`arrow`; text, images, frames, etc. are skipped so they
  don't act as invisible walls. To make a new shape type ridable, add it there.

## Adding a line behavior (color → kind)

The kind→behavior split already exists. To add one:
1. extend the `LineKind` union in physics.ts,
2. add color rows to `COLOR_TO_KIND` in geometry.ts,
3. add the per-kind branch in the collision block in `step()`,
4. add a `physics.test.ts` case proving the effect vs. plain solid,
5. add a `DEBUG_KIND_COLOR` entry in Rider.tsx and a `KIND_NOTES` entry in
   audio.ts. Both are typed `Record<LineKind, …>`, so the compiler (and a failing
   `npm run build`) will tell you if you forget — but the audio one is a runtime
   lookup, so don't skip it. Optionally add a `LEGEND` row in App.tsx (UI only).

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
