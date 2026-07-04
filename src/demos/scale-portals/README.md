# Scale Portals

A top-down movement demo about travelling between **scales**. You walk a small
map of rooms; one room is a **portal** that literally contains a whole smaller
map inside it. Step onto the portal and the camera dives in — you're now walking
the child map at its own scale. Step onto the child's **exit** room and you dive
back out to exactly where you left off.

## Controls

- **WASD** or **arrow keys** — move the red player.
- Walk onto the **violet outlined room** (parent) to dive into the map nested
  inside it.
- Walk onto the **orange room** (child, your spawn room) to dive back out.

## How it works

- **Rooms are WFC-generated.** The pure Wave Function Collapse core
  (`wfc/collapse.ts`, `wfc/tiles.ts`, `wfc/connectivity.ts`) is copied from the
  Toolkit demo. It produces a grid of rooms joined by doorways, then prunes and
  re-connects so every room is reachable.
- **Nesting is purely geometric — no frames, no clipping.** The child map's
  rectangles are generated at a small scale and written *inside* the parent
  portal room's footprint (`game/constants.ts` derives the child scale so the
  child map fills the portal room exactly). So the child map is always sitting
  there, visibly tiny, before you enter. `editor.zoomToBounds` on the child's
  bounds *is* the dive-in effect.
- **The player is one locked `geo` ellipse.** Movement is a `window` keydown/
  keyup tracker (`game/keys.ts`) plus `editor.on('tick')` (`game/gameLoop.ts`),
  with axis-separated AABB slide collision (`game/collision.ts`) against the
  current level's rooms + doorways.
- **Depth is a stack** (`game/levelManager.ts`), so a third depth is additive —
  the demo just scopes to two (parent + one child) with a return trip.

Seeds are fixed (`PARENT_SEED` / `CHILD_SEED`), so the maps are the same every
reload. Nothing persists to localStorage.

## Tests

Pure logic is covered by vitest (`npm test`): WFC determinism/edge-agreement
(`wfc/__tests__`), the nesting invariant + layout (`game/__tests__/mapGeometry`),
the slide collision resolver, and the level stack.
