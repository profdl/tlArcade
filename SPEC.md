# Game Designer's Toolkit for tldraw v5 — Architecture & Specification

> **Status:** Design spec, v0.2
> **Target runtime:** `tldraw@5.1.x` + `@tldraw/sync@5.1.x` (verified current `latest` as of 2026-06-24)
> **Trust model:** Server-authoritative (Cloudflare Worker + Durable Object referee)
> **Networking:** Networked from day one
> **Stacking model:** Count-on-one-shape
> **Identity:** Seat-based — backs both logged-in users and guests (§3.7)

This document is the spine for a toolkit of custom tldraw shapes and editor behaviors that turn a tldraw canvas into a collaborative tabletop. It is deliberately ordered **authority first, shapes second** — because in a synced CRDT world the hard problems are *trust and secrecy*, not rendering.

---

## 0. Reading guide

| Chapter | What it answers |
|---|---|
| 1. The authority model | Who is allowed to mutate what, and where secrets physically live |
| 2. Data architecture | Shape props vs. server state; the redaction boundary |
| 3. The referee (backend) | The Cloudflare Worker / Durable Object that owns randomness & secrets — incl. seat-based identity (§3.7) |
| 4. Shared subsystems | Grid/snapping and spatial containment — consumed by multiple shapes |
| 5. The six shapes | Token, Card, Die, Tracker, Container, Grid — each as a `ShapeUtil` |
| 6. Inspector & context menus | The designer-facing UI surface |
| 7. Build phases | The order to actually build it |
| 8. Open questions | Decisions still to make |

---

## 1. The authority model

### 1.1 The two hard truths of tldraw sync

`@tldraw/sync` is a **CRDT relay**, not a game server. It synchronizes a shared `TLStore` between clients. Two consequences drive the entire architecture:

1. **There are no secrets in the store.** Every connected client holds the *full* document. If a face-down card's value lives in `shape.props.value`, any player can read it in devtools. "Hidden" cannot be a rendering trick — it must be a **data-placement** decision.
2. **There is no built-in referee.** Whoever clicks "Roll" is the one who computes the result. Trust-based randomness is the default unless an external authority computes it.

This spec resolves both with a **server-authoritative referee**: a Cloudflare Durable Object that runs *alongside* the sync server, owns hidden state and randomness, and writes only *revealed/redacted* results back into the synced store.

### 1.2 Authority taxonomy per action

| Action | Authority | Why |
|---|---|---|
| Move / resize / rotate a shape | Client (native tldraw) | No secrecy or fairness concern |
| Edit a tracker value, token color | Client | Pure public state |
| Roll a die | **Referee** | Fair randomness; client must not pick its own number |
| Shuffle a deck/bag | **Referee** | Order must be unknowable to all clients, including the shuffler |
| Draw from a deck/bag | **Referee** | Reveals one hidden item to one player |
| Flip a card face-up | **Referee** (if value was hidden) / Client (if already public) | Revealing a secret requires the holder of the secret |
| Set container visibility | Client (the owner) | It's a policy declaration, not a secret operation |

**Rule of thumb:** *if the operation's correctness depends on information no client should possess, the referee performs it.* Everything else stays client-side and rides native tldraw sync.

### 1.3 The trust boundary diagram

```
┌─────────────┐      CRDT (full doc, no secrets)      ┌─────────────┐
│  Client A   │◄────────────────────────────────────►│  Client B   │
│  (tldraw)   │            @tldraw/sync relay         │  (tldraw)   │
└──────┬──────┘                                       └──────┬──────┘
       │  "request: roll die X" / "draw from bag Y"          │
       │  (RPC over WebSocket, NOT a store edit)             │
       ▼                                                     ▼
            ┌──────────────────────────────────────┐
            │   Referee Durable Object (per room)   │
            │  • holds hidden state (deck order,    │
            │    face-down values, bag contents)    │
            │  • owns the RNG                        │
            │  • writes redacted results into store │
            └──────────────────────────────────────┘
```

The referee is the **only** actor that may write secret-bearing values into the shared store, and it only ever writes them *redacted* (see §2.2) or *revealed to the entitled player*.

---

## 2. Data architecture

### 2.1 Three tiers of state

| Tier | Lives in | Visible to | Examples |
|---|---|---|---|
| **Public shape props** | `shape.props` (synced store) | Everyone | position, color, token count, face-up card value, tracker value |
| **Redacted props** | `shape.props` (synced store) | Everyone, but contents hidden | `faceDown: true`, `secretRef: "card_abc"` (an opaque handle, not the value) |
| **Server-held secret state** | Durable Object storage | No client | the actual face-down value behind `secretRef`, full deck order, bag contents |

The discipline: **a secret never appears in props.** Props carry an opaque `secretRef` — a handle the referee can resolve. A client holding `secretRef: "card_abc"` learns nothing; only the referee maps it to a value, and only reveals it through an authorized action.

### 2.2 The redaction pattern (per shape)

Every secret-bearing shape carries:

```ts
{
  // public, always present
  state: 'faceDown' | 'faceUp',
  // present only while hidden — an opaque handle, never the value
  secretRef: string | null,
  // present only once revealed to THIS client
  revealedValue: CardValue | null,
}
```

`revealedValue` is written by the referee **into the store** when the value becomes public to all (e.g. a card flipped face-up on the table). For owner-only reveals (you draw a card into your hand), the referee delivers the value over the **private RPC channel**, and the client renders it locally from session state — it is *never* written to the shared store. See §3.4.

### 2.3 IDs and references

- Shapes use native `createShapeId()`.
- Bindings (v5 `BindingUtil`) connect Container↔contents and Tracker↔value-source. Use `createBindingId()`.
- `secretRef` is a referee-namespaced string (`"deck:<id>:card:<uuid>"`), opaque to clients.

---

## 3. The referee (backend)

### 3.1 Topology

Two Durable Objects per room, or one DO with two responsibilities:

1. **Sync DO** — the standard `TLSocketRoom` from `@tldraw/sync-core`, relaying the CRDT.
2. **Referee DO** — owns hidden game state and the RNG. Receives RPCs, mutates hidden state, and writes redacted results back into the synced document via the sync DO's store API.

> Co-locating both in one DO is simplest (shared room lifecycle, single WebSocket). Keep them as separate classes internally for testability even if deployed as one.

### 3.2 The RPC channel

Clients talk to the referee over a **side channel**, not by editing the store.

> **Implementation note (corrects the original recommendation):** the
> `@tldraw/sync` socket turns out to be **one-way for custom messages**
> (server→client only — `TLSyncClient` exposes no public send). So a single
> WebSocket cannot carry client→referee RPCs. The shipped design splits the
> transport:
> - **client → referee:** HTTP `POST /api/referee/:roomId` to the room's DO,
>   carrying the `RefereeEnvelope` plus the client's sync `sessionId` (which is
>   `TAB_ID` from `@tldraw/editor` — what `useSync` uses on its socket).
> - **referee → client (public):** written into the store via `updateStore`;
>   arrives through normal sync.
> - **referee → client (private):** `room.sendCustomMessage(sessionId, …)`,
>   received via `useSync({ onCustomMessageReceived })`.
>
> This is less code than a second WebSocket and needs no socket interception.

### 3.3 Referee actions (the authoritative API)

```ts
type RefereeRequest =
  | { action: 'roll';     dieId: ShapeId }
  | { action: 'shuffle';  containerId: ShapeId }
  | { action: 'draw';     containerId: ShapeId; toSeat: SeatId }
  | { action: 'drawRandom'; containerId: ShapeId; toSeat: SeatId }
  | { action: 'flip';     cardId: ShapeId }            // reveal to table
  | { action: 'reveal';   cardId: ShapeId; to: 'table' | SeatId }
  | { action: 'claimSeat'; seatId: SeatId; identity: IdentityProof }
```

Ownership is always expressed in terms of **seats** (`SeatId`), never raw session ids — see §3.7. The referee resolves "which sessions currently occupy this seat" internally when delivering private reveals.

Each handler:
1. Validates the requester is entitled (e.g. only the owner may `draw` from an owner-only bag — or anyone may, depending on bag policy).
2. Mutates server-held hidden state.
3. Writes the redacted/revealed result into the store (public reveals) or sends it over the private channel (owner-only reveals).

### 3.4 Owner-only reveal flow (the subtle one)

```
Player A (seated in seat S_A) drags a card into their owner-only hand container
        │
        ▼
client → referee:  { action: 'draw', containerId, toSeat: S_A }
        │
        ▼
referee: pop hidden value, record "card_abc owned by seat S_A"
        │
        ├─► to every session currently occupying S_A (private channel): { cardId, value: '7♥' }
        │       ← A's device(s) render locally; a reconnect re-fetches from the ownership table
        │
        └─► to store (public):  shape.props = { faceDown: true, secretRef: 'card_abc', owner: S_A }
                                 → B sees a face-down card labeled "A's card", no value
```

The value reaches A's screen but **never enters the shared store**, so B (and devtools) cannot see it. Ownership is recorded against the *seat* (`S_A`), not the session — so when A reconnects (new session id) and re-occupies seat `S_A`, the referee re-delivers their hand (§3.6, §3.7). If A later plays the card to the table, a `reveal: 'table'` action writes `revealedValue` publicly.

### 3.5 Fair randomness

The referee owns a CSPRNG (`crypto.getRandomValues`). For *verifiable* fairness (optional, advanced), use a commit-reveal scheme: referee commits `hash(seed)` before play, reveals `seed` after, clients verify. **Not required for v1** — flag as a §8 future option.

### 3.6 Reconnection & durability

- Hidden state persists in DO storage; survives client disconnects and DO hibernation.
- On reconnect, a client re-subscribes; the referee re-delivers that client's owner-only reveals from the ownership table.
- If the referee restarts mid-action, actions must be **idempotent** (carry a client-generated `requestId`; referee dedupes).

### 3.7 Identity & seats (logged-in users *and* guests)

The toolkit supports **both authenticated users and anonymous guests** at the same table. The trick is to never let the rest of the system care which one a player is. We do that with a three-layer model where only the *bottom* layer differs between users and guests; everything above is uniform.

```
┌───────────────────────────────────────────────────────────┐
│ SEAT  (SeatId)   ← the durable game role; ownership lives here │
│   • "Player 1", "the dealer", "North"                          │
│   • survives reconnects; what the referee checks for entitlement│
└───────────────────────────────────────────────────────────┘
                         ▲ occupied by
┌───────────────────────────────────────────────────────────┐
│ IDENTITY  (IdentityProof)  ← who is allowed to (re)claim the seat │
│   • USER:  signed token / account id (verified server-side)       │
│   • GUEST: device-persisted secret (localStorage) → guestId       │
└───────────────────────────────────────────────────────────┘
                         ▲ connects via
┌───────────────────────────────────────────────────────────┐
│ SESSION  (SessionId)  ← one live WebSocket connection             │
│   • ephemeral; a reconnect mints a new one                        │
│   • tldraw presence / cursors key off this                        │
└───────────────────────────────────────────────────────────┘
```

**The rule:** *ownership, entitlement, and private reveals are always expressed against `SeatId`.* `SessionId` is used only for cursors/presence and for routing a private message to the right live socket. The referee maintains a `seat → {identity, activeSessions[]}` table.

#### Identity proofs

```ts
type IdentityProof =
  | { kind: 'user';  token: string }   // verified against your auth (JWT/session)
  | { kind: 'guest'; guestId: string; secret: string }  // device-persisted
```

- **Logged-in user:** the client presents a token from your auth system; the worker verifies it (JWT signature or a session lookup) and binds the seat to a stable `userId`. Re-login from any device can re-occupy the seat.
- **Guest:** on first join, the client generates a `guestId` + `secret`, persists them in `localStorage`, and presents them to claim a seat. A reconnect (even after a refresh) re-presents the same pair and recovers the seat. Clearing storage = losing the guest seat (acceptable; flag in §8).

#### Claiming & recovering a seat

1. On join, client sends `{ action: 'claimSeat', seatId, identity }`.
2. Referee verifies the proof:
   - empty seat → bind identity to it;
   - seat already bound to *this same* identity → re-attach this session (the reconnect case);
   - seat bound to a *different* identity → reject (seat taken).
3. Referee adds the session to `seat.activeSessions` and replays that seat's private state (owner-only hand contents, pending reveals).

#### Why this satisfies "users and guests" cleanly

- The Container/Die/Card logic only ever sees `SeatId`. It does not branch on user-vs-guest — that distinction is fully absorbed by `IdentityProof` verification at claim time.
- Upgrading a guest to a user later (guest logs in mid-game) is just a `claimSeat` with a `user` proof that the referee accepts because the requester already holds the seat's guest secret — the seat keeps its hand, the backing identity is swapped.

#### Worker auth boundary

- Guest secrets and user tokens are presented over the same WebSocket envelope used for RPCs (§3.2).
- The worker verifies once at claim time and on each reconnect; subsequent RPCs are trusted because they arrive on an already-authenticated socket bound to a seat.
- **Do not** put any identity secret into the synced store. The store may carry only the public seat label and which seat owns a shape.

> Decision settled (was §8.1): seat-based identity, backing both users and guests. Auth-system specifics (which JWT/provider) remain a §8 integration detail, not an architectural fork.

---

## 4. Shared subsystems

These are *not* shapes. They are editor behaviors that multiple shapes consume. Spec them once.

### 4.1 The grid / snapping subsystem

Backs the **Grid Overlay** shape but is consumed by Token, Card, and Die placement.

- **Geometry providers:** `SquareGrid`, `HexGridFlat`, `HexGridPointy`. Each exposes:
  ```ts
  interface GridGeometry {
    snap(point: Vec): Vec            // nearest cell center / intersection
    cellAt(point: Vec): CellCoord    // axial coords for hex
    cellCenter(coord: CellCoord): Vec
    distance(a: CellCoord, b: CellCoord): number  // hex distance ≠ euclidean
  }
  ```
- **Hex math:** use axial/cube coordinates (Red Blob Games conventions). Flat-top vs pointy-top differ only in the axis mapping.
- **Snap integration:** a custom snapping strategy hooked via the editor's snapping system / an `onTranslate` handler on snappable shapes. `Strict` = clamp to `snap()` on pointer-up; `Loose` = visual guide only; `None` = no-op.
- **Tolerance:** strict snapping always clamps; loose snaps within N px of a cell center.

> The grid is an **overlay shape** (renders behind game pieces, `canResize`, large bounds) plus this geometry service. Keep the math in a plain module so it's unit-testable without the editor.

### 4.2 The spatial containment subsystem

Backs the **Container/Bag** shape. tldraw has **no native "reparent on overlap"** — this must be built.

- On drag-end of a game piece, hit-test against container bounds.
- If inside, create a **binding** (`ContainerContentBinding`) from container→piece and apply the container's layout (§5.5).
- On drag-out, remove the binding.
- Layout engines (`auto-grid`, `stack`, `fan`) compute child positions from binding order; the container is authoritative over its children's transforms while bound.

> Implement as a binding + an `onTranslateEnd` editor side-effect, not as native tldraw parenting (frames), because containers need custom visibility/secrecy that frames don't provide.

---

## 5. The six shapes

Each shape is a `ShapeUtil` (or `BaseBoxShapeUtil` for box-like ones). Common pattern:

```ts
class TokenShapeUtil extends BaseBoxShapeUtil<TokenShape> {
  static override type = 'token' as const
  static override props: RecordProps<TokenShape> = { /* validators */ }
  getDefaultProps(): TokenShape['props'] { /* ... */ }
  component(shape: TokenShape) { /* React render */ }
  indicator(shape: TokenShape) { /* selection outline */ }
}
```

### 5.1 Token / Meeple — *easy; pure public state*

```ts
type TokenShape = TLBaseShape<'token', {
  w: number; h: number;
  style: 'cube' | 'disc' | 'meeple' | 'cylinder' | 'ring';
  color: 'red'|'blue'|'green'|'yellow'|'black'|'white';
  count: number;          // stack size — count-on-one-shape model
  label: string;          // single char / icon, e.g. "$", "HP"
}>
```

- **Render:** SVG per style; `count > 1` shows a corner badge.
- **Stack/split (count-on-one-shape, per decision):**
  - *Stack:* drag token A onto token B of same style+color → B.count += A.count, delete A. (An `onTranslateEnd` merge rule.)
  - *Split:* context menu "Split" or badge arrows → spawn a new token shape with `count: 1` (or a chosen N), decrement source. New shape offset so it's grabbable.
  - **No referee needed** — counts are public.
- **Grid:** consumes §4.1 snapping if a grid is under it.

### 5.2 Card — *secret-bearing; referee-backed*

```ts
type CardShape = TLBaseShape<'card', {
  w: number; h: number;
  aspect: 'poker' | 'square' | 'tarot';   // 2.5×3.5 / 1×1 / tarot ratio
  state: 'faceUp' | 'faceDown';
  back: { kind: 'solid'; color: string }
      | { kind: 'pattern'; id: string }
      | { kind: 'image'; url: string };
  // public face value, ONLY when faceUp & public
  revealedValue: CardValue | null;
  // opaque handle while hidden; resolved by referee
  secretRef: string | null;
}>
```

- **Face-down render:** the back art; no value present in props (§2.2).
- **Flip:** context menu / double-click → `referee.flip(cardId)`; referee writes `revealedValue` (table reveal) or delivers privately (owner-only).
- **Context menu:** Flip, Draw (if part of a deck container), Shuffle Stack (delegates to container shuffle).
- **A loose card vs. a deck:** a standalone card is just a shape; a *deck* is a Container (§5.5) whose layout is `stack` and whose contents are cards. Shuffle/draw live on the container, not the card.

### 5.3 Die — *randomness authority; referee-backed*

```ts
type DieShape = TLBaseShape<'die', {
  w: number; h: number;
  faces: 'd4'|'d6'|'d8'|'d10'|'d12'|'d20'|'custom';
  customFaces: string[];     // e.g. ['+','+','-','-','',''] for a Fate die
  value: number;             // index into faces — current top face
  rolling: boolean;          // drives spin animation
}>
```

- **Roll:** context menu / click → `referee.roll(dieId)`. Referee picks the index, writes `{ value, rolling:false }`. Client briefly sets `rolling:true` locally for the spin, then the authoritative value lands.
- **Why referee:** a client computing its own roll could re-roll until favorable. The referee's result is final and seen identically by all.
- **Custom faces:** `faces:'custom'` uses `customFaces` (comma-separated in the inspector → string[]).

### 5.4 Tracker / Spinner — *easy; pure public state + clamp math*

```ts
type TrackerShape = TLBaseShape<'tracker', {
  w: number; h: number;
  kind: 'linearTrack' | 'circularDial' | 'spinnerArrow';
  min: number; max: number; step: number;
  value: number;             // always clamped to [min,max] on step grid
}>
```

- **Value editing:** direct number entry, drag handle (linear), drag angle (dial/spinner). All clamp to `[min,max]` and round to nearest `step`.
- **Optional binding:** a `TrackerBinding` can link a tracker to another shape (e.g. a token's HP) so moving the token carries its tracker. Public; no referee.
- **Spinner randomness?** If a "spinner" is used as a randomizer (spin to a random wedge), route through the referee like a die. A spinner used as a *manual* dial stays client-side. The inspector exposes a `randomized: boolean` toggle to pick.

### 5.5 Container / Bag — *the hard one; three features in one*

```ts
type ContainerShape = TLBaseShape<'container', {
  w: number; h: number;
  visibility: 'public' | 'hidden' | 'ownerOnly';
  owner: SeatId | null;               // for ownerOnly — a SEAT, not a session (§3.7)
  layout: 'autoGrid' | 'stack' | 'fan';
  // contents are tracked via bindings + server state, NOT inline props
  count: number;                      // public count (how many items inside)
  secretRef: string | null;          // referee handle for hidden contents
}>
```

Three concerns, addressed separately:

1. **Secrecy (visibility):**
   - `public` — contents are normal shapes bound inside; everyone sees them.
   - `hidden` — contents' values are server-held; clients see N face-down placeholders. Count is public.
   - `ownerOnly` — like hidden, but the referee reveals contents privately to the **seat** in `owner` (§3.4, §3.7). Because ownership is a `SeatId`, it survives reconnects and works identically for logged-in users and guests; the referee routes the private reveal to whichever live session(s) currently occupy that seat.
2. **Containment (spatial):** §4.2 — bind/unbind on drag, apply layout.
3. **Authority (shuffle/draw):**
   - *Shuffle Contents* → `referee.shuffle(containerId)` — referee permutes hidden order; no client learns it.
   - *Draw / Draw Random* → `referee.draw/drawRandom(containerId, toOwner)` — referee pops a hidden item and reveals it to the drawer (privately for hands, publicly for table draws).

- **Layout engines:** `autoGrid` (NxM packed), `stack` (offset pile, top draggable — this is a deck), `fan` (hand fan-out arc). Pure functions: `layout(children, bounds) → transforms[]`.
- **Ownership is a seat, not a session:** `owner` holds a `SeatId` (§3.7). The seat is claimed at join via an `IdentityProof` — a verified token for logged-in users, a device-persisted secret for guests — so owner-only contents survive reconnects and refreshes for both. The Container code never branches on user-vs-guest; that distinction is absorbed entirely by seat-claiming.

### 5.6 Grid Overlay — *a snapping system, not a game piece*

```ts
type GridShape = TLBaseShape<'grid', {
  w: number; h: number;
  type: 'square' | 'hexFlat' | 'hexPointy';
  cellSize: number;
  cols: number; rows: number;        // or 0 for infinite-repeat within bounds
  snap: 'strict' | 'loose' | 'none';
}>
```

- Renders behind pieces (low z, large bounds). Provides a `GridGeometry` (§4.1) to the snapping subsystem.
- **No state, no referee.** It's purely an editor behavior + a visual.
- Multiple grids can coexist; the active snap target is the grid whose bounds contain the dragged piece.

---

## 6. Inspector & context menus

### 6.1 Inspector panel

A right-side panel (custom React component mounted via tldraw's UI override / `components` slot) that reads `editor.getOnlySelectedShape()` and renders shape-specific controls keyed by `shape.type`. Each shape util exports an `Inspector` component; the panel dispatches on type.

- Controls write via `editor.updateShape(...)` for public props.
- Controls that change secrets (none in the inspector — secrecy changes are policy toggles like `visibility`, which are public) — fine to write directly.
- Actions that need the referee (roll, shuffle, draw, flip) render as **buttons that send RPCs**, not store edits.

### 6.2 Context menus

Override tldraw's context menu (`components.ContextMenu` or menu schema) to add per-type actions:

| Shape | Actions |
|---|---|
| Token | Split, Merge-into (when overlapping) |
| Card | Flip, Draw (in deck), Reveal to table |
| Die | Roll |
| Tracker | Reset, +step / −step |
| Container | Shuffle Contents, Draw, Draw Random, Set Visibility |

All referee-backed actions show a brief pending state until the authoritative result lands in the store.

---

## 7. Build phases

| Phase | Goal | Ships | Status |
|---|---|---|---|
| **0. Scaffold** | Fresh v5 app + sync | tldraw-sync-cloudflare base, room routing, custom-shape registration plumbing | ✅ done |
| **1. Easy shapes** | Prove the shape pattern with zero secrecy | Token (incl. stack/split), Tracker. No referee. | ✅ done |
| **2. Referee skeleton + seats** | Stand up the DO + RPC channel + identity | `claimSeat` (guest + user proofs), `roll` action end-to-end → the **Die** works fairly. Seats land here because the first private reveal (Phase 3) already needs them. | ✅ done |
| **3. Secrets** | Redaction boundary + private reveals | **Card** (table reveal via store + owner-only via private push, addressed by `SeatId`), `stashSecret`/`reveal`, server-only secret store | ✅ done |
| **4. Containment** | Spatial binding subsystem | **Container** public mode: `containment` binding + drop-detect, autoGrid/stack/fan layouts. Membership runs on drop (not per-frame) via `registerOperationCompleteHandler`, guarded against the after-change flush re-entering. | ✅ done |
| **5. Hidden containers** | Secrecy + authority on containers | `seedDeck`/`shuffle`/`draw`/`drawRandom`: server-held ordered deck (order unknowable to all clients), draw pops onto a client-created card → table (public) or seat (owner-only private). hidden/ownerOnly render. | ✅ done |
| **6. Grid** | Snapping subsystem + overlay | Square + hex grids, strict/loose snapping | next |
| **7. Polish** | Animations, presence | spin/flip animations, presence cursors, pending-action states | |

Rationale for the order: each phase unlocks the next *capability tier* (public → fair-random + identity → secret → spatial → secret-spatial), so you never build a hard shape before its substrate exists. The Die is deliberately first-secret-adjacent because it's the smallest test of the whole referee loop; seats ride along in Phase 2 because the very next phase's owner-only reveal can't address a recipient without them.

---

## 8. Open questions / decisions deferred

1. ~~**Player identity vs. session id.**~~ **RESOLVED (§3.7):** seat-based identity backing both logged-in users and guests. Remaining *integration* detail (not an architectural fork): which auth provider/JWT scheme verifies the `user` proof, and the guest-secret rotation/expiry policy. Also: clearing `localStorage` loses a guest seat — acceptable, but the UI should warn before destructive actions.
2. **Verifiable fairness.** Commit-reveal RNG (§3.5) — worth it, or is referee-trust enough? Default: trust the referee for v1.
3. **One DO or two** (§3.1). Default: one DO, two internal classes.
4. **RPC transport** (§3.2). Default: single WebSocket, custom envelope.
5. **Card art / asset hosting.** Custom image URLs — proxy/cache through the worker, or trust client URLs? CORS and persistence implications.
6. **Spectators.** Falls out of §3.7 naturally: a spectator is a *session with no seat*. The referee never delivers any private reveal to an unseated session, so spectators see only the public/redacted store — no special role needed. Open sub-question: should spectators be allowed to *request* public actions (roll a shared die)? Default: no, observation only.
7. **Undo/redo across the referee boundary.** Native tldraw undo won't un-roll a die or un-shuffle. Decide which referee actions are undoable (probably none) and make that explicit in the UI.

---

## Appendix A — Verified v5 API surface (2026-06-24)

- `tldraw@5.1.1` is current `latest`; `5.2.0` in canary.
- Custom shapes: `ShapeUtil`, `BaseBoxShapeUtil`, `RecordProps`, `getDefaultProps`, `TLBaseShape`.
- Bindings: `BindingUtil`, `createBindingId` (used for Container↔contents, Tracker↔source).
- Tools: `StateNode` for custom tools (e.g. a "place token" tool).
- Sync: `useSync` (production), `useSyncDemo` (prototyping) from `@tldraw/sync`; `TLSocketRoom` from `@tldraw/sync-core` for the server.
- The bindings API (shipped in v5) is the right primitive for containment and tracker links — no need for fragile parenting hacks.
