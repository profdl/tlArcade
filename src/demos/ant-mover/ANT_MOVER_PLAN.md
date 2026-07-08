# Ant-Mover — a multiplayer piano-movers game

Status: **planned (v2, transport corrected). Not yet implemented.**

> **v2 changes** (from a code-grounded review of `@tldraw/sync ^5.1.1` and the
> Toolkit DO): the original client→server input path (`client sendCustomMessage`
> → `handleSocketMessage`) **does not exist** — the sync socket is receive-only
> for custom messages on the client. Input now rides a **dedicated second
> WebSocket** to the same DO. Also added: a **step-0 planck-under-Workers gate**,
> **client-side pose interpolation**, and an **empty-room stop condition** for the
> tick loop. See "Why the transport changed" and "Open flags" for the receipts.

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
the point — and whether a big crowd coordinates or collapses into tug-of-war is left
for players to demonstrate, not forced by the design.

- **Role:** one of many humans.
- **Feel:** awkward-object navigation — rotate + slide a rigid piece through tight gaps.
- **Grab:** click-and-drag **anywhere** on the T — mousedown anchors that body-local
  point, drag applies force, mouseup releases so you can re-grab elsewhere. No fixed
  handles. Any number of players may grab, and two may grab the same spot at once —
  forces simply sum (no claiming/arbitration). Where you grab relative to the center
  of mass sets how much you spin vs. translate it, so free grab points are where the
  awkward-object torque lives.
- **Multiplayer:** real, networked, server-authoritative.

### Build the sandbox, don't engineer the outcome

We are **not** trying to *prove* "humans get worse as the group grows" by
constraining the design until the effect is forced. We build the piano-movers
sandbox faithfully — one rigid T, a tight maze, many pulls summing on one body —
**let as many players join as want to**, and see what actually happens. The game
*is* the experiment; whether large crowds coordinate or descend into tug-of-war is
the thing we get to observe, not something we manufacture.

Practical consequence: **no player cap** and **no artificial coordination
friction** (no forced fog, no comms ban) baked in as a proof device. The one thing
that must be real is the physics itself — a genuinely awkward object in a genuinely
tight corridor, so the tension between pullers is emergent from the body, not
scripted. Server capacity (how many concurrent grabs one DO can simulate at tick
rate) is the real ceiling, and finding it is part of the test — see step 7.

### Native-first authoring (the maze + object are real tldraw shapes)

**Decided during step 3.** The maze and the movable object are **native tldraw
shapes on a synced canvas**, not hardcoded constants — the Sonic model:

- **Stopped = author mode.** Players draw/edit the maze with native tldraw tools
  (geo/draw/line), and **designate any shape or drawing as "the object to move."**
  Anything drawable can be the awkward load — the game is customizable.
- **Playing = sim mode.** At play-start we read the collidable shapes' **true
  geometry** (`editor.getShapeGeometry`, like Sonic's `geometry.ts` reads track):
  the designated object becomes a planck **dynamic body** built from its actual
  outline (polygon fixtures, convex-decomposed if concave — NOT a bounding box, so
  a drawn squiggle stays awkward); every other collidable shape becomes a **static**
  body (the maze). The sim runs; the pose broadcasts; players grab and pull.
- **Stop → edit → restart.** Stopping drops back to author mode with the shapes
  intact, so the maze/object can be edited and the run restarted.

Two consequences that reshape the architecture:

1. **There IS a shared document now** — the maze shapes + which shape is the object
   must be seen/edited by every player. So the netcode is **real tldraw sync
   (`TLSocketRoom` + `useSync`)**, mirroring the Toolkit; the "plain WebSocket, no
   sync" simplification is off the table. The high-frequency **pose** still rides
   the out-of-band custom-message channel (it's transient, not document state), and
   **input** still needs the dedicated upstream socket (the sync socket is
   receive-only client-side). See the transport table.
2. **"Which shape is the object"** is a piece of synced state (e.g. a tag in the
   shape's `meta`, or a dedicated marker) so all players and the DO agree on it.

Native-first also means the earlier hardcoded `geometry.ts` (T + maze constants)
becomes the **step-2 local prototype only** — its shapes move to authored native
shapes from step 4 on. The pure planck sim (`sim.ts`) stays; only where its bodies
come *from* changes (constants → shape geometry).

## Architecture

| Concern | Decision | Why |
|---|---|---|
| Netcode | Cloudflare Worker + Durable Object with **`TLSocketRoom` + `useSync`** (mirror the Toolkit), server-authoritative | There IS a shared document (the authored maze + which shape is the object), so we need real tldraw sync — not the plain-WebSocket variant. **Gate PASSED (step 0): planck runs under `workerd`.** |
| Physics engine | **planck.js** (pure-JS Box2D) running *inside the DO* | ✅ **Gate passed (step 0)** — planck imports/steps under `@cloudflare/vite-plugin`/`workerd`, applies off-center force → torque. Pure JS, synchronous instantiation (no async WASM load), single-authority makes determinism limits irrelevant. |
| The load | The **designated native shape**, read into a dynamic planck body from its **true geometry** (`getShapeGeometry` → polygon fixtures; convex-decompose if concave) | Any drawing can be the awkward object (native-first authoring). NOT a bounding box — a drawn squiggle stays awkward. Free to tumble (no self-righting). |
| The maze | Every OTHER collidable native shape → a **static** planck body from its geometry | Authored/edited on the synced canvas (Sonic model). The corridor-squeeze is what a real engine buys us. |
| **Client → server input** | **Dedicated second WebSocket** (`/api/input/:roomId`) to the *same* DO, separate from the sync socket. On mousedown the client hit-tests the cursor against the T's live pose and records a **body-local anchor**; while dragging it sends `{anchor, cursor}` (coalesced); mouseup clears it. Server holds each player's current anchor+cursor. | ⚠️ **The sync socket cannot carry client→server custom data — confirmed against `@tldraw/sync ^5.1.1`.** See "Why the transport changed". A separate socket the DO accepts itself has no `TLSocketRoom` framing conflict because the room never sees it. |
| Server loop | DO `alarm()`-armed fixed-tick loop (~30 Hz) that re-arms each tick **while players are connected**, and **stops arming when the room empties** | Toolkit has no tick loop to copy; hibernation freezes a naive `setInterval`, so the alarm pattern is DO-correct. A self-re-arming 30 Hz alarm on an empty room ticks (and bills) forever — the stop condition is mandatory, not optional. **No in-repo precedent — build & prove it in isolation (step 3).** |
| Broadcast | The T-piece pose (x, y, angle) + player cursors pushed **server→client** via `room.sendCustomMessage` / `sendToSession`, received by `useSync({ onCustomMessageReceived })` | This direction (server→client) genuinely works today (`referee/privateReveals.ts`, `pages/Room.tsx`). High-frequency poses bypass the CRDT store. **NOT raw `ws.send` on the sync socket** — that collides with `TLSocketRoom`'s framing. |
| Client render | **Interpolate** between the last two received poses each display frame (lerp position, slerp angle); render buffers ~2 poses | 30 Hz server into 60–144 Hz display renders as stutter on a heavy sliding object without it. No client-side prediction: cooperative dragging tolerates RTT lag far better than a shooter; adding prediction here buys jitter, not feel. |
| Presence / identity | tldraw sync `useSync` for who's connected + each player's pointer | Free from the Toolkit pattern |
| Sled physics | **Not reused.** Sonic's sim is a 3-point self-*righting* sled rig built to track a slope and NOT tumble (`applyUpright`, `bodyAngle`). A piano-mover T must tumble freely and be pushed from arbitrary points by N players — almost none of that rig transfers. | — |

### Why the transport changed (the receipts)

The original plan's input row said input travels "client `sendCustomMessage` → DO
`handleSocketMessage`". **That client method does not exist**, and the repo already
documents why:

- `useReferee.ts` (the plan's own cited precedent): *"the @tldraw/sync socket is
  ONE-WAY for custom messages (server→client only), so client→referee requests go
  over plain HTTP POST."* The Toolkit sends client→server data over **HTTP**
  precisely because the socket won't carry it upstream.
- `@tldraw/sync ^5.1.1` public API (`UseSyncOptions`) exposes **only**
  `onCustomMessageReceived` — a *receive* handler. There is no client
  `sendCustomMessage`, no exposed socket, no send escape hatch. The private
  `TLSyncClient.sendMessage` accepts only protocol messages (`connect`/`push`/
  `ping`), and the server's matching `onAfterReceiveMessage` fires for those same
  protocol messages — not an arbitrary upstream channel.
- `room.sendCustomMessage` is a **server** method only (`TldrawDurableObject.ts`).
  It's the broadcast (server→client) half; it has no client counterpart.

So per-tick client→server input has **no working transport in this repo** — it's the
one piece with genuinely no precedent, *more* so than the alarm loop. The fix, viable
because `worker.ts` routes any `/api/*/:roomId` to the same DO via
`idFromName(roomId)`:

- Add a route `/api/input/:roomId` → same DO.
- The DO opens/accepts the input WebSocket **itself** (its own `ctx.acceptWebSocket`
  + a branch in `webSocketMessage`), keyed so it's distinguishable from a sync
  socket. `TLSocketRoom` never sees this socket, so there's no framing collision —
  the exact hazard that rules out raw sends on the *sync* socket doesn't apply here.
- Client opens a plain `WebSocket` to `/api/input/:roomId` alongside `useSync`, and
  sends its force vector on change (coalesced to a few Hz — a player doesn't re-aim
  every 16 ms; the sim holds the last vector between messages).

Fallback if a second socket proves fussy under `@cloudflare/vite-plugin`: **HTTP POST
per input change** (not per tick), reusing the referee pattern verbatim. Chatty for
every tick, fine for change-driven sends.

## Build sequence (local-first)

0. **✅ GATE PASSED — planck runs under `@cloudflare/vite-plugin` / `workerd`.**
   Proven by a temporary `/api/_planck_gate` Worker route (since removed): with
   `planck@1.5.0` + `nodejs_compat`, a compound-T dynamic body dropped under gravity
   and took an **off-center `applyForce` at a `getWorldPoint` anchor** — it fell, slid
   +x, AND rotated (angle ≈ −0.81 rad), confirming force-at-point/torque work in the
   Workers runtime. No import warnings, no WASM/externalization noise (`planck` is pure
   JS). A plain Worker route runs in the identical runtime a DO does, so the DO-specific
   check (planck driven from an `alarm()` handler) folds into step 3 where the alarm
   loop is built. `planck` is now a real dependency. *Original gate rationale: if planck
   couldn't instantiate here, the whole physics-in-DO architecture was dead — Rapier2D
   was the fallback engine, a hand-rolled Verlet solver the last resort. Neither needed.*
1. **Scaffold the demo** — `src/demos/ant-mover/`, register in `manifest.ts`, `.am-*`
   CSS prefix (repo collision rule), unique `persistenceKey`. Empty maze + a static T
   rendered on the tldraw canvas.
2. **Local physics first** — planck sim of the T + maze + a single mouse "grab",
   running *client-side*, no netcode. Proves the feel before any server work. **Nail
   the free-grab model here:** mousedown hit-tests the cursor against the T and records
   the **body-local anchor** (so the grip stays on that spot as the T rotates); while
   held, grab = a spring from the anchor's live world position to the cursor
   (`force ∝ (cursor − anchorWorld)`, clamped, applied at `anchorWorld`) — reads as
   "grabbing a rope", the clamp doubles as the anti-tunneling guard, and grabbing off
   the center of mass produces the torque that makes the T awkward. Mouseup releases;
   re-grab anywhere. Also nail the maze/T dimension ratio so a corridor genuinely
   *requires* rotation. **Add a dev-only "scripted grabbers" toggle here** (see Local
   dev below): N fake players, each an anchor pulling toward a target, fed into the
   same local `world.step()` — lets you watch a 10/50/200-grabber crowd sim solo,
   with zero netcode, and stress the wedge behavior long before that many humans exist.
3. **Prove the alarm tick loop AND the input socket in isolation** — copy Toolkit's
   `worker/`, `wrangler.toml`, `@cloudflare/vite-plugin`, `shared/` plumbing for a
   *new* DO (`AntMoverDurableObject`, its own migration + binding). Two no-precedent
   pieces, proven together before physics:
   - `alarm()`-armed fixed-tick loop that re-arms each tick, **survives hibernation**,
     and **stops arming when the last player disconnects** (re-arms on next connect).
   - a **second WebSocket** (`/api/am-input/:roomId`) the DO accepts itself: client
     sends a dummy `{anchor, cursor}` up it; DO logs it; DO broadcasts a *dummy* pose
     driven by the vector via `room.sendCustomMessage`; client renders it moving,
     interpolated.
   This is the whole risky transport spine with zero physics — get it ticking cleanly
   so DO-hibernation, empty-room, and socket-routing bugs don't tangle with physics bugs.
   Client joins with `useSync` (the room now has a real synced store — see native-first).
3a. **Native shapes → planck bodies** — build the read layer (Sonic's `geometry.ts`
   model): `editor.getShapeGeometry` on each collidable native shape → planck fixtures.
   The **designated object** → a dynamic body from its true outline (polygon fixtures,
   convex-decomposed if concave); every other collidable shape → a static body. Plus a
   way to **designate "the object"** (a `meta` tag / marker on the shape) that syncs to
   all players. Prove it client-side first (replace step-2's hardcoded `geometry.ts`
   constants with authored shapes), then it feeds the server sim.
4. **Move the sim server-side** — port the step-2 planck sim into the ticking DO; feed
   it the shape-derived bodies from 3a (the DO reads the synced store's shapes at
   play-start); drive it from the alarm loop; broadcast the real object pose (replacing
   the dummy). **Play/Stop lifecycle:** stop = editable native shapes; play = sim from
   their geometry; stop→edit→restart.
5. **Wire real input** — replace the dummy vector with real `{anchor, cursor}` inputs
   over the input socket; each tick, for every player holding, resolve the anchor to a
   world point and `applyForce(k·(cursor − anchorWorld), anchorWorld)`; render the
   broadcast poses interpolated. Now it's real multiplayer.
6. **Multi-player correctness** — many grabs summing on one body, free per-player grab
   points (overlap allowed, no claiming), grab/release, disconnect drops that player's
   force. Prove the core mechanic (coordinate → glides; fight → jams) with 2+ real clients.
7. **Make it a game, and open the doors** — start/exit zones, win when the object clears
   the maze, a group timer. **No player cap:** let as many players join one room as
   the DO can simulate, and treat finding that ceiling as part of the test (how many
   concurrent grabs can one DO step at tick rate before poses degrade?). Optionally a
   "solo vs. crowd" stat / clear-time-by-headcount readout so the crowd-vs-coordination
   question is *observable* — surfacing what happens, not engineering it.

## Local dev / solo play

Everything is playable and observable on `npm run dev` — no deploy, and (for the
early stages) no netcode at all:

- **Play solo, zero netcode** — step 2 IS a complete single-player game in the
  browser: the client-side planck sim, the T + maze, and your own mouse grab. No
  WebSocket, no DO, no `wrangler`. This is the first thing that exists, by design
  (local-first ordering).
- **Watch a crowd simulate itself** — the step-2 dev-only **scripted-grabbers** toggle
  spawns N fake players (each an anchor pulling toward a target) into the same local
  `world.step()`. Pure client, works from step 2 on. Use it to watch 10/50/200-grabber
  crowd behavior and stress the corridor wedge long before that many humans can join —
  and as a cheap proxy for the step-7 headcount test.
- **Real multiplayer, still local** — from step 3 on, `vite dev` runs the Cloudflare
  Worker + DO locally (`@cloudflare/vite-plugin`), so **two browser tabs on the same
  `roomId`** are two real networked clients against a real DO on your machine — true
  multiplayer with no deploy. Room identity comes from the URL→DO (`idFromName`), not
  localStorage, so same-origin tabs joining one room is fine.

## Open flags

- **This branch PRs into `engine`, not `main`.** The demo infra (router, manifest,
  Toolkit Worker template) only exists on `engine`; `main` is a bare tldraw scaffold.
  Retarget once `engine` merges to `main`.
- **Input transport is the top risk, not the alarm loop.** The alarm loop is
  no-precedent but well-understood (documented DO pattern). The client→server input
  channel is no-precedent *and* the sync socket actively can't do it — hence its own
  isolation proof in step 3 and the HTTP-POST fallback.
- **Empty-room billing.** A 30 Hz self-re-arming alarm never idles the DO. The
  stop-when-empty condition is load-bearing for cost, not just cleanliness.
- **Cloudflare deploy** needs the DO migration (+ optional R2 bucket), same as Toolkit.
  Local `vite dev` runs the Worker fine without deploying.
- **New runtime dependency:** `planck` (small, pure JS) — *contingent on step 0*.

## Reference

- Toolkit multiplayer plumbing to mirror: `worker/worker.ts` (route → DO via
  `idFromName`), `worker/TldrawDurableObject.ts` (hibernation + `acceptWebSocket` +
  `webSocketMessage` — the place a second socket branch goes), `worker/Referee.ts`
  (+ its `RoomBridge`/`sendToSession` pattern), `shared/referee-protocol.ts`,
  `wrangler.toml`, `vite.config.ts`, `tsconfig.worker.json`, and client
  `src/demos/toolkit/referee/useReferee.ts` + `pages/Room.tsx`. Note the Toolkit
  authority is event-driven with **no server tick loop**.
- **Transport truth (verified against installed packages):**
  - Server→client out-of-band works today: `room.sendCustomMessage` /
    `sendToSession` (`worker/TldrawDurableObject.ts:107`, `Referee.ts:316`), received
    by `useSync({ onCustomMessageReceived })` (`referee/privateReveals.ts`,
    `pages/Room.tsx:35`).
  - Client→server does **not** work over the sync socket: `useReferee.ts:7-9`,
    `SPEC.md:130-131`, and `@tldraw/sync ^5.1.1`'s receive-only `onCustomMessageReceived`
    API. Toolkit uses HTTP POST (`/api/referee/:roomId`) for the upstream direction.
- The sled Verlet sim (`src/demos/sonic/game/physics.ts`) — a 3-point self-righting
  sled rig (`makeBody`/`stepBody`/`applyUpright`) built to track a slope and resist
  tumbling. Almost none of it transfers to a freely-tumbling multi-grab rigid T; kept
  as a reference for tunable/anti-tunneling patterns only, not reused.
