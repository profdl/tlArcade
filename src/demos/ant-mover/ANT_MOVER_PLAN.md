# Ant-Mover — a multiplayer piano-movers game

Status: **planned, local-first build order approved.** Not yet implemented.

## The idea

Based on the YouTube short *"Ants Vs Humans: Problem Solving Skills"* (ProjectTomorrow) —
the collective piano-movers experiment where groups cooperatively drag an awkward
**T-shaped load** through a **maze**. The striking finding: ant groups get *better*
the larger they are, while human groups get *worse* (too many cooks, conflicting
strategies).

**In this game you are one of many humans.** You and other players each grab a corner
of one big **rigid T-piece** and pull it toward the exit through a tight maze. Because
it's a single rigid body, everyone's pulls sum: coordinate and it glides through the
gap; yank against each other and it jams sideways in the corridor. That friction is
the point — the game *is* the phenomenon.

- **Role:** one of many humans.
- **Feel:** awkward-object navigation — rotate + slide a rigid piece through tight gaps.
- **Multiplayer:** real, networked, server-authoritative.

## Architecture

| Concern | Decision | Why |
|---|---|---|
| Netcode | Cloudflare Worker + Durable Object, server-authoritative | Mirrors the Toolkit demo's proven plumbing |
| Physics engine | **planck.js** (pure-JS Box2D) running *inside the DO* | WASM engines (Rapier) fight the Worker's no-async-WASM-load + cold-start limits; planck instantiates synchronously, ideal compound-body + force-at-point APIs, and single-authority makes its determinism limits irrelevant. Rapier2D is the fallback if perf ceilings appear. |
| The load | One dynamic planck `Body` = two welded box fixtures (stem + crossbar) = the T | Compound rigid body; rotates and collides as one |
| The maze | Static planck bodies (box/chain fixtures) | The corridor-squeeze is exactly what a real engine buys us |
| Player input | Each player's grab = `applyForce(force, point)` at their handle each tick. Input travels client→server as a **custom sync message** (client `sendCustomMessage` → DO `handleSocketMessage`), *not* per-tick HTTP RPC | Literally the "many pulls on one body" mechanic; the socket custom-message channel is the only ~30–60 Hz-appropriate transport (the Referee's HTTP RPCs are for rare events, not per-tick input) |
| Server loop | **New:** DO `alarm()`-armed fixed-tick loop (~30–60 Hz) that re-arms itself each tick | Toolkit has no tick loop to copy; hibernation freezes a naive `setInterval`, so the alarm pattern is DO-correct. **No in-repo precedent — build & prove it in isolation (build step 3) before moving planck server-side.** |
| Broadcast | The T-piece pose (x, y, angle) + player cursors pushed via **`room.sendCustomMessage` / `sendToSession`**, received client-side by `useSync({ onCustomMessageReceived })`, bypassing the CRDT store | High-frequency poses shouldn't route through the store. **NOT raw `ws.send`:** the DO hands every socket to tldraw's `TLSocketRoom`, which owns the framing — raw sends interleave with sync frames and the client's `useSync` reader can't decode them. The custom-message channel already round-trips today (`referee/privateReveals.ts`, `pages/Room.tsx`). |
| Presence / identity | tldraw sync `useSync` for who's connected + each player's pointer | Free from the Toolkit pattern |
| Sled physics | **Not reused.** A real engine handles the rigid-squeeze better than hand-rolled SAT | — |

## Build sequence (local-first)

1. **Scaffold the demo** — `src/demos/ant-mover/`, register in `manifest.ts`, `.am-*`
   CSS prefix (repo collision rule), unique `persistenceKey`. Empty maze + a static T
   rendered on the tldraw canvas.
2. **Local physics first** — planck sim of the T + maze + a single mouse "grab",
   running *client-side*, no netcode. Proves the feel (does the piano-movers squeeze
   feel good?) before any server work. **Lowest-risk ordering — do this before step 3.**
   Also fold in a throwaway spike: `import planck` inside a DO and step one world, to
   confirm planck runs under `@cloudflare/vite-plugin` (assumption, not yet verified).
3. **Prove the alarm tick loop in isolation** — copy Toolkit's `worker/`,
   `wrangler.toml`, `@cloudflare/vite-plugin`, `shared/` plumbing for a *new* DO. Add
   a bare `alarm()`-armed fixed-tick loop that re-arms each tick, survives hibernation,
   and broadcasts a *dummy* pose via `room.sendCustomMessage` — client renders it moving.
   **This is the one piece with no in-repo precedent; get it ticking cleanly before any
   planck goes server-side, so DO-hibernation bugs and physics bugs don't tangle.**
4. **Move the sim server-side** — port the step-2 planck sim into the ticking DO; drive
   it from the alarm loop; broadcast the real T-piece pose (replacing the dummy).
5. **Wire client input** — send grab inputs up as custom sync messages
   (`sendCustomMessage` → `handleSocketMessage`), apply them as forces in the sim, render
   the broadcast poses via `onCustomMessageReceived`. Now it's real multiplayer.
6. **Make it a game** — start/exit zones, win when the T clears the maze, a group
   timer, maybe a "solo vs. crowd" stat that surfaces the phenomenon.

## Open flags

- **This branch PRs into `engine`, not `main`.** The demo infra (router, manifest,
  Toolkit Worker template) only exists on `engine`; `main` is a bare tldraw scaffold.
  Retarget once `engine` merges to `main`.
- **Cloudflare deploy** needs the DO migration (+ optional R2 bucket), same as Toolkit.
  Local `vite dev` runs the Worker fine without deploying.
- **New runtime dependency:** `planck` (small, pure JS).

## Reference

- Toolkit multiplayer plumbing to mirror: `worker/worker.ts`,
  `worker/TldrawDurableObject.ts`, `worker/Referee.ts` (+ its `RoomBridge` pattern),
  `shared/referee-protocol.ts`, `wrangler.toml`, `vite.config.ts`,
  `tsconfig.worker.json`, and client `src/demos/toolkit/referee/useReferee.ts` +
  `pages/Room.tsx`. Note the Toolkit authority is event-driven with **no server tick
  loop** — the alarm-driven physics tick is the one piece not present to copy.
- **Out-of-band pose/input channel to reuse:** the DO already pushes non-store data via
  `room.sendCustomMessage` / `sendToSession` (see `worker/TldrawDurableObject.ts` line
  ~107 wiring `sendToSession`, and `Referee.ts`), received client-side by
  `useSync({ onCustomMessageReceived })` (`referee/privateReveals.ts`,
  `pages/Room.tsx`). This is the pose-broadcast + grab-input transport — not raw
  `ws.send`, which would collide with `TLSocketRoom`'s framing on the same socket.
- The sled Verlet sim (`src/demos/sonic/game/physics.ts`) — assessed as portable
  (Verlet points + distance constraints generalize to a T), but a real engine wins for
  the rigid-body-through-corridors collision. Kept as reference, not reused.
