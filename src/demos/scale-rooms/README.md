# Scale Rooms

A top-down movement demo about travelling between **scales** — a sibling of Scale
Portals with a very different world model. Instead of a WFC grid of rooms joined by
hallways, the world is a **telescope of single square rooms**: each level is ONE
room, and its children are **smaller rooms drawn overlapping its floor**. Walk onto
a room's orange **portal-doorway** and the camera dives in until that room fills the
viewport; it holds its own smaller rooms, and so on — up to **16 scales deep**.

## The shape of it

- **Each level is one square room.** A child's side is exactly **1/√2** its parent's
  (half the area) — the ratio from the size chart this was built to. Colours **cycle
  every three levels**: blue → light-blue → light-violet (the chart's
  `#4465e9 / #4ba1f1 / #e085f4`). See `game/constants.ts`.
- **Children are SOLID and overlap the parent.** A child room sits inside its
  parent's square (placed in a corner by default, so the parent keeps an L-shaped
  walkable floor around it). You **can't walk onto a child** — you walk around it on
  the parent floor and step onto its doorway to dive in. With the 1/√2 ratio a single
  child already covers half the parent, so branching is kept low (1–2 children,
  biased to 1) and corner-anchored; the world reads as a **nested-corner spiral**.
- **Branching tree, budgeted.** The world is grown by randomly expanding a frontier
  of rooms until `ROOM_BUDGET` (300) rooms exist or `MAX_DEPTH` (15) is reached, so
  branches terminate at **varied depths** (some shallow, some deep). Deepest full
  branch frames at ~900% (`ZOOM_CEILING` is set above it, `zoomSteps` widened to
  match — `App.tsx`).

## Controls

- **WASD** or **arrow keys** — move the snail.
- Walk up to a smaller room's **orange doorway** to dive in.
- Inside a room, walk onto its own **orange doorway** (on the wall facing where you
  came from) to dive back out.

## How it works

- **The geometry is pure** (`game/roomTree.ts`, no tldraw import — takes an id
  factory, unit-tested). `generateWorld` grows the room tree from one seed + a
  `WorldStyle`, then attaches each room's `RoomLayout` (its drawn rects + the portal
  triggers used at that level).
- **Placement is pluggable** (`game/styles.ts`, picker in `game/WorldControls.tsx`):
  `corner` (the chart look), `center` (concentric), `offset` (seeded, biased to a
  corner), or `mixed` (a seeded mix). Picking a style rebuilds the world in place under
  the same seed (`gameLoop.regenerate`).
- **Portal-doorways pair a parent and one child.** Each non-root room draws one
  **one orange rect straddling** its `connEdge` (the edge facing the parent's centre).
  That single rect is BOTH the drawn door AND the dive trigger — what you see is exactly
  what triggers, no invisible hit zone (`connectorDoor`). It's the parent's `'in'` door
  (walk onto it from the parent floor → dive in) and the child's `'out'` door (walk onto
  it from inside the child → dive out), paired by the child's origin key; sized to the
  CHILD so it's a localized opening, not a slab that swamps the floor. The player spawns
  and lands OFF any door (`findClearPoint` avoids doorway hits) so the trigger arms
  cleanly. Every non-root room's exit is guaranteed REACHABLE: children are only placed in
  the corners AWAY from the room's own exit edge (`cornersAwayFrom`), so a solid child can
  never cover the way out.
- **Collision is solid-room aware** (`game/collision.ts`). A move is accepted only if
  the player box stays contained in the current room AND clear of every child-room
  obstacle (`resolveMove`). `findClearPoint` nudges the player off any solid room on
  spawn and after a dive, so it never lands inside one.
- **The dive is camera-only** (`game/gameLoop.ts`). Every room's shapes are written
  up front (pre-order, so children draw over the parent floor they overlap), so a
  dive is pure camera-zoom easing (geometric, log-space) + a player reposition +
  a level-stack push/pop (`game/levelManager.ts`) — no frames, no clipping. The
  per-tick follow keeps the player pinned on screen while the zoom eases.
- **The player is one locked, invisible `geo` ellipse** (`game/player.ts`); the
  visible snail is painted over it by `game/PlayerSnail.tsx`. Movement is a `window`
  key tracker (`game/keys.ts`) + `editor.on('tick')`.

**A new world generates every start**: the seed is rolled randomly and logged to the
console; add `?seed=<number>` to the URL to replay a specific world. Nothing persists
to localStorage. Because worlds are random, the geometry guarantees are enforced, not
eyeballed: `game/validateWorld.ts` states the invariants (child side = parent × 1/√2,
child fully inside parent, colour = `colorForDepth(depth)`, one in-doorway per child,
one out-doorway per non-root room, depth ≤ MAX_DEPTH) and `validateWorldTree` applies
them recursively at every depth — swept across 100 seeds in tests and asserted at
runtime in dev.

## Tests

Pure logic is covered by vitest (`npm test`): the nesting geometry + budgeted tree
(`__tests__/roomTree` — ratio, containment, placement modes, budget/depth caps, varied
depths, determinism), the dive IN/OUT/none decision on doorways (`__tests__/portalAt`),
the recursive whole-tree invariants across 100 seeds incl. a deliberately-broken deep
node (`__tests__/validateWorld`), and the slide + solid-obstacle collision resolver and
clear-point finder (`__tests__/collision`).
