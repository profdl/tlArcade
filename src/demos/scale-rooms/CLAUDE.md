# Scale Rooms — architecture notes

Read [README.md](README.md) first for the player-facing description. This file is the
map for working in the code.

## The world model in one paragraph

Every level is ONE square room. A room's children are **smaller rooms (side × 1/√2)
that overlap its floor and are SOLID** — you walk around them and step onto an orange
doorway to dive in. The whole tree is generated up front and every room's shapes are on
the page from the start; a **dive is pure camera-zoom easing + player reposition + a
level-stack push/pop** (no frames, no clipping). This is deliberately unlike the sibling
[scale-portals](../scale-portals) demo (WFC grid, hallways, inset slots) — there is no
grid, no WFC, no hallways here.

## Files (all under `game/`, plus `App.tsx`)

- **`constants.ts`** — the tuning knobs: `SCALE_RATIO` (1/√2), `MAX_DEPTH` (15 → 16
  levels), `ROOM_BUDGET`/`CHILDREN_MAX` (tree shape), the `DEPTH_COLORS` 3-cycle, portal
  fractions, zoom range. Sizes are ratios of the current room, so `ROOM_ROOT` is a feel
  knob, not a correctness one.
- **`roomTree.ts`** — the PURE geometry (no tldraw import; takes an id factory).
  `generateWorld(newId, seed, style)` grows the budgeted tree and attaches each room's
  `RoomLayout` (drawn rects + `PortalInfo` triggers). This is where placement math,
  the doorway `doorway()` helper, and `connectionEdge` live. **Start here** for anything
  about where rooms/doors sit.
- **`styles.ts`** — the pluggable seam: `WorldStyle` = placement (`corner`/`center`/
  `offset`/`mixed`), plus the picker registry.
- **`collision.ts`** — axis-separated slide, now **obstacle-aware**: `resolveMove(box,
  dx, dy, walkable, obstacles)` and `findClearPoint(...)` (used to keep the player off
  solid rooms on spawn/landing). Pure.
- **`levelManager.ts`** — the root→current path as a `RoomNode` stack (the tree itself
  is the cache). `walkableRects(node)` = the room square; `obstacleRects(node)` = its
  DIRECT children.
- **`gameLoop.ts`** — the ONLY impure file: builds the world, writes all shapes, rides
  `editor.on('tick')` for movement + the geometric zoom-ease dive, and does `diveIn`/
  `diveOut`/`portalAt`.
- **`validateWorld.ts`** — recursive invariant checker (dev assertion + test sweep).
- **`player.ts` / `PlayerSnail.tsx` / `SnailArt.tsx` / `keys.ts`** — copied ~verbatim
  from scale-portals (invisible locked ellipse + snail overlay + key tracker).

## Gotchas / invariants to preserve

- **Children are SOLID and the 1/√2 overlap is large.** One child already covers ~half
  a parent; that's why `CHILDREN_MAX` is 2 (biased to 1) and placement is corner-first —
  more/denser children tile over the whole floor and there's nowhere to walk. If you
  raise branching, you must keep a connected walkable floor (and `findClearPoint` needs
  somewhere to land the player).
- **The visible door IS the trigger.** A doorway is ONE `connectorDoor` rect: drawn orange
  AND used as the portal `hit`, straddling the wall (DOOR_HALF each side) so it's
  overlappable from both scales. Never split the drawn rect from the trigger rect, or dives
  fire where there's no visible door (the bug this replaced). Landing points come from
  `findClearPoint` (off any door), not from the door rect.
- **Every non-root level must keep a reachable exit.** Children go only in
  `cornersAwayFrom(connEdge)` so a solid child can't cover the room's own exit doorway;
  `validateWorld` asserts no child overlaps the exit. If you change placement, preserve this.
- **Parent↔child doorways pair by the child's `key`** (rounded page origin). `diveIn`
  finds the child by `portal.childKey`; `diveOut` finds the parent's `'in'` portal with
  the matching `childKey`. Both ends share the SAME `connectorDoor` geometry, so they align.
- **Shapes are written pre-order** so children draw over the parent floor they overlap.
- **`connEdge` faces the parent's centre**, which guarantees parent floor beyond it (so
  a dive-out lands clear) — `validateWorld` asserts it. Don't place a doorway on an edge
  flush with a parent wall.
- Colour comes only from `colorForDepth(depth)` (the 3-cycle); don't special-case a
  depth's colour elsewhere.
