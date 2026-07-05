# Scale Portals

A top-down movement demo about travelling between **scales**. The world is a
grid whose cells **alternate between rooms and free-standing small-maps**: a
small-map cell has no room around it — a whole tiny map just sits there, and
the tunnels from neighbouring rooms flow straight into it. Where a tunnel meets
a small-map sits an **orange portal-doorway** on the boundary — a small
rectangle, NOT a whole room. Walk a tunnel onto a doorway and the camera dives
in; you arrive at the **centre of the matching doorway** inside the small-map,
facing the tunnel you came through. Walk onto any doorway inside a small-map and
you dive back out to the centre of its doorway in the tunnel above, walking on
toward the next room. Travel literally alternates room → small-map → room.

**The nesting goes 4 scales deep, one colour per scale.** A small-map isn't a
dead end — it's a map with its OWN small-maps in it, so you can dive again, and
again. Each zoom level has a distinct colour so you can tell at a glance how
deep you are: the root (biggest) is **blue**, then **green**, then **violet**,
and the smallest (deepest) scale **light-red** (`colorForDepth` in
`game/mapGeometry.ts`). How deep is derived from the zoom window we allow: the
root is framed at 10% (tldraw's native minimum), each dive zooms in ~4.47×, and
the deepest scale must stay under `ZOOM_CEILING`. tldraw's *native* ceiling is
800%, which floors to two dive steps (three scales); we raise the ceiling to
1000% and widen the editor's `zoomSteps` to match (`App.tsx` `setCameraOptions`),
which floors to three dive steps, i.e. **four scales**, framed at ~10% / ~45% /
~200% / ~894%. See `MAX_DEPTH` in `game/constants.ts`, derived from exactly that
inequality — bump `ZOOM_CEILING` to nest deeper still.

## Controls

- **WASD** or **arrow keys** — move the red player.
- Walk a tunnel onto the **orange portal-doorway** at its mouth to dive in.
- Inside a small-map, walk onto any **portal-doorway** (orange, on the boundary
  at a tunnel mouth) to dive back out toward that doorway's tunnel.

## How it works

- **Rooms are WFC-generated.** The pure Wave Function Collapse core
  (`wfc/collapse.ts`, `wfc/tiles.ts`, `wfc/connectivity.ts`) is copied from the
  Toolkit demo. It produces a grid of rooms joined by doorways, then prunes and
  re-connects so every room is reachable.
- **The cell-role model** (`game/mapGeometry.ts`): each present cell is either
  a `room` (a filled rect in that scale's colour) or a `submap` (no rect — a
  SLOT centred in the cell holds a nested child map). Role assignment is a
  pluggable function (default: a SEEDED per-cell coin flip — ANY present cell
  can independently be a room or a submap, probability `submapProb`, default
  50%), so different world patterns are one function swap (or one probability
  tweak). The flip is seeded from the map's own seed, so one world seed still
  reproduces every role; a HOST map is guaranteed ≥1 submap (when
  `ensureSubmap` is set, if every cell came up room the one closest to submap is
  promoted) so no scale is a dead end.
- **Map PATTERNS make the complexity fractal** (`game/patterns.ts`, picker in
  `game/WorldControls.tsx`). The role function is the seam, so it's the natural
  place to add structure: the picker (top-left overlay) swaps in a named pattern
  and rebuilds the world in place (gameLoop's `regenerate`). `Grid`/`Sparse`/
  `Dense` are the seeded coin flip at different densities (`Grid` is the original
  simplest map); `Sierpiński` is a self-similar carpet, `Clustered` grows organic
  blobs, `Rings` alternates concentric shells. Because the SAME rule runs at every
  scale, a self-similar pattern reads as a true fractal — dive into a Sierpiński
  submap and the carpet motif repeats, smaller. **Bounding the shape count:** a
  self-similar rule branches geometrically (every submap builds a full child map),
  so `sierpinskiPattern` TAPERS to all-rooms past `stopDepth` (the deepest,
  barely-visible scale goes rooms-only), keeping the eager whole-tree build in
  line with `Grid` (~1400 vs ~4000 shapes). `SHAPE_BUDGET` (`constants.ts`) is the
  pattern-agnostic backstop: once a build blows it, deeper maps stop building
  eagerly and lazy-build on dive-in (logged, not silent).
  Doors are built **port-to-port**: a room's port pokes slightly into
  the room; a submap's port pokes slightly INTO the slot — which is exactly
  what lets the player's dive trigger fire at the end of a tunnel.
- **Slots and gates are INDEPENDENT — a map can have both.** `hasSlots` makes
  a level a HOST (it offers submap slots); a non-empty `gateEdges` makes it a
  GUEST (it carries gates). The ROOT is host-only; an INTERMEDIATE map is
  *both* (slots + gates) — that's what lets nesting continue past one level;
  the deepest (LEAF) map is guest-only. Gate cells always force role `room`
  (you must be able to stand where a tunnel drops you), so on an intermediate
  map gates simply override the coin flip where they land (and are excluded from
  it). Because a host map is guaranteed at least one submap, every intermediate
  map goes on to nest a third scale.
- **Gates are per-tunnel, not entrance/exit.** Each nested map gets one gate
  per door direction of its host cell (1–4 gates, straight or bent — e.g. a
  bend joins a west tunnel to a north tunnel). A gate is just a room at a
  tunnel mouth — it takes its own map's colour, so a whole map reads as one
  colour. The gate is the walkable landing room; the dive is triggered by the
  portal-doorway on its boundary (below). The pairing is geometric (by tunnel
  direction), so entrances and exits can't get mixed up.
- **Portal-doorways are the dive triggers — small rects on the boundary, not
  whole rooms** (`PortalInfo`/`buildMapLayout` in `game/mapGeometry.ts`,
  `portalAt`/`diveIn`/`diveOut` in `game/gameLoop.ts`). Every hallway↔small-map
  junction gets an orange doorway (`PORTAL_PROPS`) flush on the boundary, one
  per tunnel: an `'in'` doorway just OUTSIDE the slot (in the hallway, on the
  host map) and an `'out'` doorway just INSIDE the gate room (on the guest map).
  Each is offset toward its own map's walkable interior so its **centre is
  always walkable** — you enter/exit at that centre. They are drawn but excluded
  from collision (`walkableRects` skips kind `'portal'`): pure markers/triggers
  laid over the floor they sit on. The tunnel direction pairs the two ends, so a
  dive lands you on the matching doorway on the far side, and re-diving needs you
  to step off the doorway first (arming).
- **Nesting is purely geometric — no frames, no clipping.** Nested maps are
  written at a small scale inside their slots (`game/constants.ts` pins the
  child extent to exactly the SLOT), always visible before you enter. Room and
  gap compound `CHILD_SCALE` per depth (`roomAtDepth`/`gapAtDepth`), so a map
  at depth *d* is `CHILD_SCALE^d` the root's size. `editor.zoomToBounds` on a
  map's bounds *is* the dive effect; its inset scales by `CHILD_SCALE^depth`
  so the on-screen margin looks the same at every scale.
- **The player is one locked `geo` ellipse.** Movement is a `window` keydown/
  keyup tracker (`game/keys.ts`, which clears held keys on window blur) plus
  `editor.on('tick')` (`game/gameLoop.ts`), with axis-separated AABB slide
  collision (`game/collision.ts`). Slots are NOT walkable — you can never
  stand on a small-map at parent scale; you fall into it.
- **Depth is a stack** (`game/levelManager.ts`) and each submap's child is
  cached by its slot's PAGE position (unique across the whole tree — grid
  coords alone would collide across depths), so re-entering reuses the same
  shapes. Every scale reuses the same `buildMapLayout`; `buildChildInSlot`
  recurses eagerly at mount, building the entire nested tree down to
  `MAX_DEPTH` up front, so every tiny map is visible before you enter it.

**A new world generates every start**: the world seed is rolled randomly on
mount and logged to the console; per-submap child seeds derive from it, so one
number reproduces the entire world. Add `?seed=<number>` to the URL to replay
a specific world. Because worlds are random, the connection guarantees are
enforced rather than eyeballed: `game/validateWorld.ts` states the invariants
(one gate per tunnel, gates on tunnel centrelines, every gate strictly
overlapping its tunnel, child extent === slot, one `'in'` doorway per host
tunnel and one `'out'` doorway per gate) and `validateWorldTree` applies
them **recursively at every scale** (depth-2 gates against the depth-1 map's
tunnels, and so on) — swept across 300 seeds in tests and asserted at runtime
in dev. Nothing persists to localStorage.

## Tests

Pure logic is covered by vitest (`npm test`): WFC determinism/edge-agreement
(`wfc/__tests__`), the slot-fit nesting invariant, cell roles (no room behind
a submap, tunnel-per-door poking into the slot, pluggable role function,
intermediate maps carrying BOTH slots and gates), per-tunnel gate placement
incl. bent/1-gate/4-gate combos, portal-doorway placement (one `'in'` per host
tunnel overlapping it, one orange `'out'` per gate inside the gate room)
(`game/__tests__/mapGeometry`), the dive IN/OUT/none decision on doorways
(`game/__tests__/portalAt`), the recursive whole-tree world validation to
`MAX_DEPTH` across 300 seeds — including a deliberately-broken gate AND a missing
portal at a DEEP scale, so the recursion isn't vacuously green
(`game/__tests__/validateWorld`), the slide collision resolver (portals excluded
from walkable floor), and the level stack (incl. page-position cache keys that
don't collide across depths).
