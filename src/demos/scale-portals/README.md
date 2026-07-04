# Scale Portals

A top-down movement demo about travelling between **scales**. You walk a big
map of blue rooms that **alternates** plain rooms with **portal rooms** — each
portal room literally contains a whole smaller map inside it. Walk into a portal
room and the camera dives in; you're now walking that child map at its own scale.
Each child map is a **pass-through** with two orange portals (an entrance and an
exit) — step onto either one to dive back out.

## Controls

- **WASD** or **arrow keys** — move the red player.
- Walk into a **room that has a tiny map inside it** (a portal room) to dive into
  that map.
- Inside a child map, walk onto either **orange portal** (entrance or exit) to
  dive back out.

## How it works

- **Rooms are WFC-generated.** The pure Wave Function Collapse core
  (`wfc/collapse.ts`, `wfc/tiles.ts`, `wfc/connectivity.ts`) is copied from the
  Toolkit demo. It produces a grid of rooms joined by doorways, then prunes and
  re-connects so every room is reachable.
- **The parent alternates rooms and maps.** A checkerboard of the parent's rooms
  are portals (`role: 'parent'` in `game/mapGeometry.ts`); each holds its own
  child map with a distinct seed. Portal rooms look like normal blue rooms — the
  tiny map sitting inside is what marks them (no border).
- **Nesting is purely geometric — no frames, no clipping.** Each child map is
  generated at a small scale and written *inside* its portal room's footprint
  (`game/constants.ts` derives the child scale so the child map fills the portal
  room exactly). So the child maps are always sitting there, visibly tiny, before
  you enter. `editor.zoomToBounds` on a child's bounds *is* the dive-in effect.
- **Each child is a pass-through.** Its two orange portals — an entrance (where
  you appear) and an exit — sit on the edges facing the portal room's tunnels, so
  they line up with the parent corridors. Green rooms are just floor; only the
  orange portals let you leave.
- **The player is one locked `geo` ellipse.** Movement is a `window` keydown/
  keyup tracker (`game/keys.ts`, which also clears held keys on window blur so the
  player can't drift) plus `editor.on('tick')` (`game/gameLoop.ts`), with
  axis-separated AABB slide collision (`game/collision.ts`) against the current
  level's rooms + doorways.
- **Depth is a stack** (`game/levelManager.ts`) and each portal's child is cached
  by portal, so a third depth is additive — the demo scopes to two (parent + its
  child maps) with a return trip.

Seeds are fixed (`PARENT_SEED` / `CHILD_SEED`), so the maps are the same every
reload. Nothing persists to localStorage.

## Tests

Pure logic is covered by vitest (`npm test`): WFC determinism/edge-agreement
(`wfc/__tests__`), the nesting invariant, checkerboard portals and the child's
two-portal pass-through (`game/__tests__/mapGeometry`), the slide collision
resolver, and the level stack.
