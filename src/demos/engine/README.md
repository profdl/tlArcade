# Engine

A drag-and-drop **game builder** on [tldraw](https://tldraw.dev) v5. Drop
elements from the tray, arrange them, then press **Play** to test-drive a
platformer — all on a live tldraw canvas.

## Play

1. Drop a **🙂 Player**, some **🧱 Walls** (or draw walls with the pencil), and
   optionally **⭐ Tokens**, **🔥 Hazards**, and a **🏁 Goal**.
2. Press **▶ Play**.
3. Move with **← →** / **A D**, jump with **↑** / **W** / **Space**.
4. Collect every token, then reach the goal to win. Touching a hazard respawns
   you. Press **■ Stop** to go back to editing — your level is restored exactly.

Native geo / pencil / line shapes act as **solid terrain**, so you can draw a
level freehand instead of stacking wall blocks.

## The elements

| Element | Motion | Collision | On touch |
| --- | --- | --- | --- |
| 🙂 Player | platformer (gravity + input) | solid | — |
| 🧱 Wall | static | solid | — |
| ⭐ Token | static | trigger | collect (needed to win) |
| 🔥 Hazard | static | trigger | respawn the player |
| 🏁 Goal | static | trigger | win (once all tokens are collected) |

## How it fits together

- **One custom shape** (`gameEntity`) — its `role` prop selects which element it
  is; look, size, and behavior are derived from a registry.
- **Edit vs. Play** — a runtime snapshots the authored scene, runs a
  fixed-timestep sim during Play, and restores on Stop, without touching undo.

See [CLAUDE.md](CLAUDE.md) for the architecture and how to add a new element.

## Files

- `App.tsx` — mounts `<Tldraw>`, the tray/HUD, and owns the `GameRuntime`.
- `render/EntityShapeUtil.tsx` — the single custom shape.
- `game/roles.ts` — the element registry (the demo's whole vocabulary).
- `game/engine.ts` — the play-mode runtime (physics, collision, triggers).
