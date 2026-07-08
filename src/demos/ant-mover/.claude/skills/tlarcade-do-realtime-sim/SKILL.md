---
name: tlarcade-do-realtime-sim
description: The load-bearing netcode/transport rules for a server-authoritative real-time physics sim on tldraw v5 + a Cloudflare Durable Object in this repo. Use whenever you touch the ant-mover Durable Object, its server tick loop, the client<->server input transport, or the pose broadcast channel. Encodes the hard constraints (verified against @tldraw/sync ^5.1.1 and the repo) that keep upstream input off the sync socket, the DO ticking only when occupied, and the pose overlay stable.
---

# tlArcade DO real-time sim conventions

The **ant-mover** demo (`src/demos/ant-mover/`) is a multiplayer piano-movers
game: many humans drag one rigid T-piece through a maze, with a DO-authoritative
planck.js sim. The Toolkit template this repo ships is **event-driven** — it has
NO server tick loop and NO client→server high-frequency channel — so a real-time
sim needs the netcode below. The source of truth for the demo design is
[ANT_MOVER_PLAN.md](../../ANT_MOVER_PLAN.md); this skill makes the transport
rules executable for any agent building the netcode. Every rule was VERIFIED this
session against the installed `@tldraw/sync@^5.1.1` and the repo code — they are
hard constraints, not suggestions.

## The rules (do not break)

1. **Client→server custom data CANNOT ride the sync socket. Never try.**
   Confirmed against `@tldraw/sync@^5.1.1`: the public `useSync` API
   (`UseSyncOptions`) exposes ONLY `onCustomMessageReceived` — a RECEIVE handler.
   There is NO client `sendCustomMessage`, no exposed socket, no send escape
   hatch. The private `TLSyncClient.sendMessage` accepts only protocol messages
   (connect/push/ping). Do not reach into internals to send input over it — the
   sync socket is owned by `TLSocketRoom` and your frames will collide with its
   framing. The repo already documents this one-way limit:
   `src/demos/toolkit/referee/useReferee.ts:7-9` and
   `src/demos/toolkit/SPEC.md:130-131`; the Toolkit sends client→server data over
   HTTP POST for exactly this reason.

2. **Upstream player input goes over a DEDICATED SECOND WEBSOCKET, not the sync
   socket.** `worker/worker.ts` routes any room-scoped path to the same DO via
   `env.TLDRAW_DURABLE_OBJECT.idFromName(roomId)` (see the `/api/connect/:roomId`
   and `/api/referee/:roomId` routes, worker.ts:19-31). Add a route
   `/api/input/:roomId` that forwards to the SAME DO the same way. The DO accepts
   THIS socket itself: its own `ctx.acceptWebSocket(serverWs)` plus a BRANCH in
   the `webSocketMessage` hibernation handler, keyed (via the socket's
   attachment) so it is distinguishable from a sync socket. `TLSocketRoom` never
   sees this socket, so there is NO framing collision — that framing hazard exists
   ONLY on the sync socket `TLSocketRoom` owns. Fallback if the second socket is
   fussy: HTTP POST per input CHANGE (not per tick), reusing the referee pattern
   (`src/demos/toolkit/referee/useReferee.ts`,
   `worker/TldrawDurableObject.ts:118` `/api/referee/:roomId`).

3. **Server→client high-frequency state goes ONLY through
   `room.sendCustomMessage(sessionId, data)`, received by
   `useSync({ onCustomMessageReceived })`. NEVER raw `ws.send` on the sync
   socket.** This is a SERVER-only method (no client counterpart — see rule 1) and
   is the one correct out-of-band downstream channel; it works today. Live
   wiring: `worker/TldrawDurableObject.ts:107` bridges the referee's
   `sendToSession` to `room.sendCustomMessage`; `worker/Referee.ts:316` calls it;
   the client receives at `src/demos/toolkit/pages/Room.tsx:35`
   (`onCustomMessageReceived: onRefereePrivateMessage`) and
   `src/demos/toolkit/referee/privateReveals.ts` holds the result in an atom.
   Raw `ws.send` on the sync socket collides with `TLSocketRoom` framing. **The
   per-tick physics pose MUST BYPASS the CRDT store** — do not put per-tick sim
   state in tldraw shapes (the store is a synced CRDT document, not a game-state
   channel; flooding it with pose updates is wrong on every axis).

4. **The tick loop is a self-re-arming `alarm()`, and it MUST stop when the room
   empties.** The Toolkit has NO server tick loop to copy — it is event-driven, so
   build the loop from scratch. A DO `storage.setAlarm()`-armed fixed-tick loop
   (~30 Hz) whose `alarm()` handler re-arms itself for the next tick is the
   DO-correct pattern; a naive `setInterval` is frozen by hibernation and will not
   tick. CRITICAL: the loop MUST stop re-arming when the last player disconnects
   (the room empties) and re-arm on the next connect. A self-re-arming 30 Hz alarm
   on an empty room ticks and BILLS forever. `wrangler.toml:28`
   (`new_sqlite_classes = ["TldrawDurableObject"]`, verified) puts the DO on
   SQLite-backed storage, so `storage.setAlarm` is available.

5. **The input socket plays by the SAME hibernation rules the sync socket already
   follows.** Hibernation is already solved in `worker/TldrawDurableObject.ts` —
   study it: it accepts each socket with `ctx.acceptWebSocket` (handleConnect,
   ~line 148), stores the sessionId in `serializeAttachment` immediately (~line
   153) so the socket is identifiable BEFORE the handshake, and on wake resumes
   via `ctx.getWebSockets()` + `handleSocketResume` (getOrCreateRoom, ~lines
   82-93). The second input socket MUST survive wake and be re-identifiable via
   its own attachment (e.g. tag it `kind: 'input'` in the attachment) — otherwise
   a hibernation cycle silently drops it and input dies.

6. **Render the broadcast pose as an `InFrontOfTheCanvas` SVG overlay, positioned
   with `editor.pageToViewport` — NEVER `pageToScreen`.** The pose is NOT a
   store-backed custom shape (rule 3). The overlay mounts INSIDE the editor
   container, so `pageToScreen` drifts by the container's screen offset — a real,
   documented bug (see the sonic and toolkit CLAUDE.md gotchas); use
   `editor.pageToViewport`. Keep the `components` object a **module-level const**
   (referentially stable) — an inline/recreated `components` remounts the overlay
   every render and resets its interpolation buffer mid-run. Read broadcast state
   through an **atom + `useValue`**, the same reactive path presence and the
   referee reveals use (`src/demos/toolkit/referee/privateReveals.ts`).
   **Interpolate between the last two received poses** (lerp position, slerp/lerp
   angle): a 30 Hz server feeding a 60–144 Hz display stutters without it. Working
   reference overlay: `src/demos/toolkit/creature/SwimDebugOverlay.tsx`.

## Transport summary

| direction | frequency | channel | why |
| --- | --- | --- | --- |
| client → server input | per input change | dedicated `/api/input/:roomId` WS (fallback: HTTP POST per change) | sync socket has no client send (rule 1, 2) |
| server → client pose | per tick (~30 Hz) | `room.sendCustomMessage` → `onCustomMessageReceived` | only downstream out-of-band channel (rule 3) |
| authored maze / static doc | on edit | normal tldraw store sync | CRDT is for the document, not per-tick state (rule 3) |

## Reference files

- `src/demos/ant-mover/ANT_MOVER_PLAN.md` — the demo's design source of truth.
- `src/demos/toolkit/referee/useReferee.ts` — the one-way-socket note + the HTTP
  client→server pattern (the input fallback).
- `src/demos/toolkit/referee/privateReveals.ts` — `onCustomMessageReceived` →
  atom, the downstream receive path (rule 3, 6).
- `src/demos/toolkit/pages/Room.tsx` (~line 35) — where `useSync` wires
  `onCustomMessageReceived`.
- `worker/worker.ts` (lines 19-31) — how a `/api/*/:roomId` route reaches the DO
  via `idFromName(roomId)`; add `/api/input/:roomId` the same way.
- `worker/TldrawDurableObject.ts` — hibernation done right: `ctx.acceptWebSocket`,
  `serializeAttachment`, `getWebSockets` + `handleSocketResume`; and line 107, the
  `room.sendCustomMessage` bridge.
- `worker/Referee.ts` (line 316) — a live `sendToSession` (→ `sendCustomMessage`)
  call.
- `wrangler.toml` (line 28) — the DO is on `new_sqlite_classes`, so
  `storage.setAlarm` is available.
- `src/demos/toolkit/creature/SwimDebugOverlay.tsx` — a working
  `InFrontOfTheCanvas` SVG overlay to copy for the pose renderer.
