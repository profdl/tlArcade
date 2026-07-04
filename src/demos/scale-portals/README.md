# Scale Portals

A top-down movement demo about travelling between **scales**. The world is a
grid whose cells **alternate between blue rooms and free-standing small-maps**:
a small-map cell has no room around it — a whole tiny map just sits there, and
the blue tunnels from neighbouring rooms flow straight into its **orange
gates, one per tunnel**. Walk a tunnel to its end and the camera dives in;
you arrive at the gate facing the tunnel you came through. Step onto any gate
and you dive back out into that gate's tunnel, walking on toward the next
room. Travel literally alternates room → small-map → room.

## Controls

- **WASD** or **arrow keys** — move the red player.
- Walk a tunnel to its end (into the tiny map) to dive in.
- Inside a small-map, walk onto any **orange gate** to dive back out toward
  that gate's tunnel.

## How it works

- **Rooms are WFC-generated.** The pure Wave Function Collapse core
  (`wfc/collapse.ts`, `wfc/tiles.ts`, `wfc/connectivity.ts`) is copied from the
  Toolkit demo. It produces a grid of rooms joined by doorways, then prunes and
  re-connects so every room is reachable.
- **The cell-role model** (`game/mapGeometry.ts`): each present cell is either
  a `room` (blue rect) or a `submap` (no rect — a SLOT centred in the cell
  holds a nested child map). Role assignment is a pluggable function
  (default: checkerboard parity), so different world patterns are one function
  swap. Doors are built **port-to-port**: a room's port pokes slightly into
  the room; a submap's port pokes slightly INTO the slot — which is exactly
  what lets the player's dive trigger fire at the end of a tunnel.
- **Gates are per-tunnel, not entrance/exit.** Each child map gets one orange
  gate per door direction of its host cell (1–4 gates, straight or bent —
  e.g. a bend joins a west tunnel to a north tunnel). Arrival gate = the side
  you touched the slot from; any gate dives you back out toward its own
  tunnel. The pairing is geometric, so entrances and exits can't get mixed up.
- **Nesting is purely geometric — no frames, no clipping.** Child maps are
  written at a small scale inside their slots (`game/constants.ts` pins the
  child extent to exactly the SLOT), always visible before you enter.
  `editor.zoomToBounds` on a child's bounds *is* the dive effect.
- **The player is one locked `geo` ellipse.** Movement is a `window` keydown/
  keyup tracker (`game/keys.ts`, which clears held keys on window blur) plus
  `editor.on('tick')` (`game/gameLoop.ts`), with axis-separated AABB slide
  collision (`game/collision.ts`). Slots are NOT walkable — you can never
  stand on a small-map at parent scale; you fall into it.
- **Depth is a stack** (`game/levelManager.ts`) and each submap's child is
  cached by cell, so re-entering reuses the same shapes. Child generation
  reuses the same `buildMapLayout`, so deeper nesting later is the same call
  at child scale.

**A new world generates every start**: the world seed is rolled randomly on
mount and logged to the console; per-submap child seeds derive from it, so one
number reproduces the entire world. Add `?seed=<number>` to the URL to replay
a specific world. Because worlds are random, the connection guarantees are
enforced rather than eyeballed: `game/validateWorld.ts` states the invariants
(one gate per tunnel, gates on tunnel centrelines, every gate strictly
overlapping its tunnel, child extent === slot) — swept across 300 seeds in
tests and asserted at runtime in dev. Nothing persists to localStorage.

## Tests

Pure logic is covered by vitest (`npm test`): WFC determinism/edge-agreement
(`wfc/__tests__`), the slot-fit nesting invariant, cell roles (no room behind
a submap, tunnel-per-door poking into the slot, pluggable role function),
per-tunnel gate placement incl. bent/1-gate/4-gate combos
(`game/__tests__/mapGeometry`), the slide collision resolver, and the level
stack.
