# Engine

A drag-and-drop **game builder** on [tldraw](https://tldraw.dev) v5. Drag
elements from the left tray onto the canvas, arrange them, then press **Play** to
test-drive a platformer — all on a live tldraw canvas, with no custom shapes.

## Play

1. Drag a **🙂 Player**, some **🧱 Walls** (or draw walls with the pencil), and
   optionally **⭐ Tokens**, **🔥 Hazards**, and a **🏁 Goal** from the left tray.
2. Press **▶ Play**.
3. Move with **← →** / **A D**, jump with **↑** / **W** / **Space**.
4. Collect every token, then reach the goal to win. Touching a hazard respawns
   you. Press **■ Stop** to go back to editing — your level is restored exactly.

## Native-first: color is the behavior

Every element is a plain native tldraw `geo` shape; its role is read from its
**color**:

| color | element | motion | collision | on touch |
| --- | --- | --- | --- | --- |
| blue | 🙂 Player | platformer (gravity + input) | solid | — |
| grey | 🧱 Wall | static | solid | — |
| yellow | ⭐ Token | static | trigger | collect (needed to win) |
| red | 🔥 Hazard | static | trigger | respawn the player |
| green | 🏁 Goal | static | trigger | win (once all tokens are collected) |

This applies to shapes you **draw with the pencil** too — a blue scribble is the
player, a yellow one is a token, and so on. A shape in any other color, and any
line, acts as **solid terrain**, so you can still draw a level freehand (e.g. in
black). Recolor any shape and it takes on that color's role.

## How it fits together

- **No custom shape** — the tray drops native geo shapes; the engine reads roles
  from color.
- **Left tray** — built on tldraw's official drag-and-drop-tray pattern
  (`components.InFrontOfTheCanvas` + `screenToPage` + `createShape`).
- **Edit vs. Play** — a runtime snapshots the authored scene, runs a
  fixed-timestep sim during Play, and restores on Stop, without touching undo.

See [CLAUDE.md](CLAUDE.md) for the architecture and how to add a new element.

## Files

- `App.tsx` — mounts `<Tldraw>`, the tray (via `components`) and Play/Stop bar,
  and owns the `GameRuntime`.
- `render/Tray.tsx` — the left drag-and-drop tray.
- `game/roles.ts` — the element registry (color → role, tray shapes).
- `game/engine.ts` — the play-mode runtime (physics, collision, triggers).
- `game/state.ts` — the `playingAtom` shared with the tray.
