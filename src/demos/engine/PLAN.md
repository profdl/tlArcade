# Engine — Master Plan: a drawing-to-game toolkit powered by Claude

Design doc for turning the Engine demo into a **toolkit for authoring playable
platformers from drawings and prompts**. The organizing thesis is one sentence:

> **A user draws something (or describes it) → Claude interprets it → emits
> inspectable JSON data → the deterministic runtime plays that data → the user
> hand-edits the result with the same tools.**

Every capability in this plan — rigged characters, enemies, hazards, levels,
feel — is an instance of that one pipeline. **Rigging is not a separate track;
it is the first and hardest "converter" built on a shared substrate**, and it
proves the pattern that later converters (enemy, hazard, level, prop) reuse.

**Nothing in the AI/rig/multi-entity parts is built yet.** What *is* built and
shipping today: a native-shape platformer with color/marker-coded roles, real-
outline collision, contemporary game feel, and a live tuning panel. This plan is
grounded in that code ([engine.ts](game/engine.ts), [player.ts](game/player.ts),
[roles.ts](game/roles.ts), [collision.ts](game/collision.ts),
[physics.ts](game/physics.ts)), in real tldraw v5 APIs confirmed against the
installed `tldraw@^5.1.1` and [docs/tldraw/](../../../docs/tldraw/), and in a
primary-source synthesis of the four leading 2D skeletal systems (§C).

> **Bar:** professional-grade *concepts*, prototype-grade *scope*. We adopt the
> hard-won data models these systems share (strict rig, ordered constraints,
> layered timelines; ordered role/behavior data) but ship them tier by tier,
> each tier independently useful, none gated on the hardest piece.

---

## 0. Guiding principles (decided)

1. **AI authors data; the runtime plays data.** Claude calls take seconds; the
   sim runs at fixed-dt on rAF. Claude never touches the loop — it emits JSON
   (role/behavior, rig, skin weights, animation clips, level layout) that the
   deterministic runtime plays back. Consequence: **every AI output is
   inspectable, editable data**, so "generate OR hand-edit" falls out for free.
2. **Manual editing is the AI's safety net — manual tools ship before their AI
   counterpart.** For every converter, we build the data model + a hand-editor
   *first*; the AI then populates the same structures, and imperfect output is
   fixed with the same tools. No dead ends. (Confirmed direction.)
3. **One shared drawing-perception primitive (§1).** Every converter that reads
   a drawing uses the *same* bundle — PNG (what Claude sees) + leaf geometry
   keyed by shape ID (the ground truth it maps onto, so it returns real IDs) +
   SVG (precision tiebreaker). Auto-rig is its first consumer; auto-enemy,
   auto-hazard, auto-level reuse it verbatim.
4. **One generalized entity/behavior model (§2).** The runtime is refactored
   early to drive **N entities**, each carrying its own motion / collision /
   effect / (later) rig + AI, read from `meta`. New game elements become *data*,
   not new loop code. (Confirmed direction: foundational, early.)
5. **Setup pose ≠ animated pose; rig in `meta`, live pose in runtime state.**
   Universal across all four reference systems (§C): an immutable rig (rest
   transforms, bind matrices, weights) stored once; a *separate* live pose
   per-frame.
6. **Tiered rendering, not one big bet (§6).** Rigid-attachment posing on native
   shapes ships first and is genuinely useful; **weighted mesh skinning** is a
   later tier needing a custom shape. Each tier is shippable.
7. **Native-first stays the default.** No custom shape except the one documented,
   isolated exception for the skinned-player render (Tier C, §6).

### Decided architecture

| Decision | Choice |
|---|---|
| API transport | **Cloudflare Worker proxy** — `/api/engine/*`; key server-side |
| The toolkit spine | **shared perception bundle + generalized entity model**, then converters on top |
| First converter | **rigging** (manual editor first, then AI auto-rig) |
| Multi-entity sim | **foundational** — refactor `engine.ts` to N entities early |
| Rig depth | full pro skeleton — bone tree + IK + ordered constraints + skinning |
| Serialization | named JSON in `meta` (diffable, AI-friendly, fits tldraw's store) |
| UI approach | **native tldraw slots only** — full editors are custom `StateNode` tools, one sectioned Tray, one role-aware toolbar, one ✨ Generate dialog (§7.5) |
| How we build | **Claude skills first (§9), then multi-agent orchestration (§10)** — scout → parallel fan-out → adversarial verify → integrate |

---

## 1. The shared substrate (build first — every tool depends on it)

These three pieces are the foundation. PLAN-v1 buried the perception bundle in
"Phase 4" and the entity generalization in "Phase 7"; they are actually the
things every converter reuses, so they come first.

### 1.1 AI plumbing (`worker/engine.ts` + `game/ai/`)

`worker/engine.ts` mounted at `/api/engine/*` (the Worker's router already
matches `/api/*` first — see [worker/worker.ts](../../../worker/worker.ts)).
Proxies Anthropic; **the API key is a Worker secret, never in the browser**.

`game/ai/client.ts`: typed calls, **Zod-validate Claude's JSON against
`game/ai/schemas.ts`**, one **retry-on-invalid-JSON** loop feeding the parse
error back. One client; every converter is a thin wrapper over it.

### 1.2 The drawing-perception bundle (`game/ai/perceive.ts`)

The reusable "let Claude see a drawing" primitive. Given a set of shape IDs it
returns, in one bundle:

- **PNG** — `editor.toImageDataUrl(ids, { format: 'png', scale: 2 })` — what
  Claude visually perceives. *Verified:* `toImageDataUrl(shapes, opts)` exists on
  the editor and returns `Promise<{ url, width, height }>` — read `.url`, it is
  **not** a bare string (PLAN-v1 assumed it was; correct that in code).
- **Leaf geometry keyed by shape ID** — each leaf's `outlineSamples`/page bounds.
  The ground truth Claude maps onto, so it returns **real shape IDs** → exact
  snapping instead of guessed coordinates. Use `editor.getShapeAndDescendantIds`
  (*verified present*) to enumerate a group's leaves.
- **SVG** — `editor.getSvgString(ids, opts)` (*verified present*, returns
  `Promise<{ svg, width, height }>`) — precision tiebreaker.

Every AI converter (`autoRig`, `autoEnemy`, `autoHazard`, `autoLevel`) calls
`perceive()` and differs only in the prompt + the Zod schema of what comes back.
**This is the load-bearing generalization** that makes "rigging is the first of
many tools" true rather than aspirational.

### 1.3 The generalized entity / behavior model (`game/roles.ts`, `engine.ts`)

Today the sim moves **only the player**; the level is read once and is static
([engine.ts](game/engine.ts) `start()`; CLAUDE.md "Only the player moves").
Every future element with motion (enemy, moving platform, projectile, a hazard
that sweeps) needs the runtime to drive **non-player entities**. So refactor the
loop **early**, as substrate:

- Generalize today's three behavior axes into a per-entity record read from
  `meta`: **motion** (`static | platformer | patrol | sine | projectile | mover
  | …`), **collision** (`solid | trigger | oneWay`), **effect** (`none | collect
  | kill | win | bounce | teleport | checkpoint | …`), plus per-motion params.
- Promote `meta.role` from "player-only marker" to the **primary role
  mechanism** for all non-original roles (color stays the quick-draw path for the
  original five — distinct colors run out fast; see [roles.ts](game/roles.ts)
  `roleForColor` and [engine.ts](game/engine.ts) `roleOf`). AI writes `meta.role`
  + behavior params; it never has to pick a magic color.
- The sim steps **a list of entities**; the player is entity zero with
  `platformer` motion. Collision stays "solids captured once at start" for now
  (§ Known limits), but *movers re-read their tagged shapes per frame*.
- **Do this behind the existing behavior:** no `meta` role present + no rig →
  the current player-only path runs unchanged, every existing level keeps
  working. This is a behavior-preserving refactor (there's a repo skill for
  exactly this discipline).

**The concrete `Entity` interface (settle this BEFORE S3 starts).** The hard part
of the refactor is not the enums above — it's deciding which of the player's
special-cased fields generalize and which stay player-only. Pin it down first:

```ts
interface Entity {
  id: TLShapeId              // the shape (or group) record this entity drives
  role: Role                 // from meta.role, else roleForColor(color)
  motion: Motion             // static | platformer | patrol | sine | projectile | mover
  collision: Collision       // solid | trigger | oneWay
  effect: Effect             // none | collect | kill | win | bounce | teleport | checkpoint
  params: MotionParams       // per-motion tuning (patrol bounds, sine amp/freq, …)
  // live sim state (mutated each step; NOT persisted):
  x: number; y: number; vx: number; vy: number
  offsetX: number; offsetY: number   // bounds→record offset captured at start (draw-shape support)
  samples: Vec[]             // outline collected at start(), page-space, entity-local
  rig?: Rig                  // §3 — present only on rigged entities
}
```

**Player = entity 0, explicitly.** It is the entity with `motion: 'platformer'`,
and it is the *only* entity that reads input, runs the full jump/coyote/buffer
feel pipeline, and owns the win/respawn logic. Everything else about it —
bounds-derived sizing, the `offsetX/Y` capture, `writePlayer` moving the group
record, merged-outline `samples` — becomes the **generic** entity-0 path that any
future mover reuses. Decide in the scout step which of `engine.ts`'s current
player-specific branches (`start`/`writePlayer`/trigger tests) collapse into the
shared entity loop vs. stay gated on `motion === 'platformer'`; do not discover
that mid-refactor.

**Why early, not incremental:** enemies, moving platforms, springs, and
projectiles *all* need N-entity stepping. Doing it once as substrate turns each
of them into "add a motion kind + its data," versus repeatedly patching the loop.

---

## 2. The converter pattern (how every tool is built)

Once §1 exists, each new "drawing/prompt → game element" tool follows the **same
five steps**, in this order (principle 2 — manual before AI):

1. **Data model** — a typed, Zod-schema'd JSON shape stored in `meta` (e.g. a
   `Rig`, an `EnemyBehavior`, a `LevelLayout`).
2. **Runtime plays it** — the sim/evaluator reads that data and acts on it. Pure,
   editor-free, unit-tested (mirrors how [physics.ts](game/physics.ts) is kept
   editor-free).
3. **Manual editor** — an `InFrontOfTheCanvas` overlay (same layer as
   [Tray](render/Tray.tsx) / [PlayerToolbar](render/PlayerToolbar.tsx)) to
   hand-author the data. **Ships before the AI.**
4. **AI converter** — `perceive()` (§1.2) + a prompt + the Zod schema → the same
   data. Validate (IDs exist, structure sound) → **open the manual editor** to
   tweak. The editor is the safety net.
5. **Document it** — a section in Engine's [CLAUDE.md](CLAUDE.md).

The plan below documents the converters in **depth order** (deepest first, §3
rigging), but that is NOT the build order. Build order is **cheapest-first**
(§5): the level-gen (G4) and feel (G5) converters ship first because they reuse a
runtime that already exists, so they prove the whole AI spine — Worker proxy →
`perceive()` → Zod → runtime-plays-data — end-to-end on a low-stakes target for
near-zero cost. Rigging is the flagship *proof of depth*, and it is documented
next because it exercises every part of the substrate (perception → complex
nested data → per-frame runtime → editor) — but it is **v2**, sequenced only once
the cheap converters have validated the pipeline. See §5 for the committed order
and the v1/v2/v3 line.

---

## 3. The flagship converter — Rigging & animation (v2, deepest — not built first)

The deepest tool; it justifies the substrate. It is the **flagship**, not the
first thing built: the cheap converters (G4/G5) ship first to validate the AI
spine, and rigging follows as v2 (see §5's v1/v2/v3 line). Full rationale and the
reference-architecture synthesis are in §C. Data model summary:

### 3.1 Rig data model (`game/rig/types.ts`)

Stored in `meta.rig` on the player/character group. All transforms are 2D affine
(`Mat2D`: a,b,c,d,tx,ty). Coordinates are **entity-local** (relative to the
group's bind-time bounds top-left), so the rig is translation-invariant — the
runtime adds the entity's live `(x,y)` exactly like it does `playerSamples`
today.

```ts
// ---- SETUP POSE (immutable rig) ----
interface Bone {
  id: string; parentId: string | null    // strict tree, single root
  x: number; y: number; rotation: number  // rest local transform (radians)
  scaleX: number; scaleY: number; shearX: number; shearY: number  // shear ⇒ squash/stretch
  length: number                          // places child origin at the tip; used by IK/skinning
  inherit: InheritMode                    // Normal | OnlyTranslation | NoRotation | NoScale (Spine enum)
}
interface Slot { id: string; boneId: string; drawOrder: number; attachment: string }
type Attachment =
  | { kind: 'rigid'; leafId: TLShapeId }                            // Tier A: one tldraw shape on one bone
  | { kind: 'skinnedPath'; verts: SkinVertex[]; closed: boolean }   // Tier C: weighted mesh
interface SkinVertex {
  x: number; y: number
  influences: { boneIndex: number; weight: number }[]   // ≤4, weights normalized to 1
  handleOf?: number                                      // Bézier handle → index of its anchor
}
interface Rig {
  version: 1; root: string
  bones: Bone[]; slots: Slot[]
  skins: Record<string, Record<string /*slotId*/, Attachment>>
  constraints: Constraint[]                              // ORDERED (§3.2)
  bindInverse: Record<string /*boneId*/, Mat2D>          // inverse bind matrix per bone
}
```

### 3.2 Constraints (ordered — evaluated in `order`; §C5)

```ts
type Constraint =
  | { kind: 'ik'; order: number; bones: string[]; target: string;
      mix: number; bendDirection: 1 | -1; softness: number }        // analytic 2-bone (law of cosines)
  | { kind: 'transform'; order: number; bones: string[]; target: string;
      mixRotate: number; mixTranslate: number; mixScale: number }
  | { kind: 'path'; order: number; bones: string[]; targetSlot: string;
      positionMode: 'fixed' | 'percent'; rotateMode: 'tangent' | 'chain' }
  | { kind: 'physics'; order: number; bones: string[];
      inertia: number; strength: number; damping: number;
      mass: number; gravity: number; wind: number; mix: number }    // spring/jiggle (Spine 4.2)
```

**IK is analytic two-bone** (law of cosines); chains >2 iterate the two-bone
solve up the chain (Rive) — no CCD/FABRIK. **Physics constraint** gives
tails/hair/capes life without keyframing (Spine 4.2 is the reference; the one
feature Rive/DragonBones lack — do not skip it).

### 3.3 Animation model (`game/anim/types.ts`)

```ts
interface Keyframe { t: number; value: number; interp: Interp } // stepped | linear | {cubic:[cx1,cy1,cx2,cy2]}
interface Timeline { target: BoneChannel; keys: Keyframe[] }
interface Clip { name: string; duration: number; loop: boolean; timelines: Timeline[] }
interface Track { clip: string; alpha: number; mixBlend: 'replace' | 'add'; boneMask?: string[] }
```

**State machine (Rive-style):** layers, states (single clip / 1D-blend /
additive), input-gated transitions with exit-time + cross-mix. Maps directly onto
the sim state already tracked in [engine.ts](game/engine.ts) `step()`:
`grounded`, `|vx|` (idle→walk→run 1D blend), `vy` sign (jump/fall), later
`climbing`. Standard clip set: `idle, walk, run, jump, fall, land, climb`.
**De-risk:** ship a minimal sim-state→clip *selector* first; grow into the full
state machine later (§7 open question).

### 3.4 Runtime evaluation pipeline (`game/rig/evaluate.ts`; §C6)

Pure, editor-free, unit-testable. Per frame, per rigged entity:

1. Advance state machine → per-layer weights.
2. Sample + blend timelines → local bone transforms (setup/replace/add under the
   layer's bone mask).
3. Walk **one dependency-sorted cache** (bones + constraints interleaved): bone →
   world = parentWorld × local (**FK**, respecting `inherit`); constraint (in
   `order`) → IK / physics / transform / path solve, writing back locals.
4. Build skin matrices `S_i = boneWorld_i × bindInverse_i`.
5. Deform — Tier A/B: apply the bone's world transform to its rigid leaf. Tier C:
   LBS each control point `p' = Σ wᵢ·(Sᵢ·p)` → new path `d`.
6. Write to canvas — Tier A/B: `updateShape` x/y/rotation per leaf. Tier C:
   `updateShape` the custom shape's path prop.

No rig present → the current rigid whole-body path runs unchanged.

### 3.5 Rigging phases (each shippable)

- **R1 — Rig model + manual editor, Tier A (rigid).** `game/rig/` types +
  `evaluate.ts` (FK + rigid deform) + tests. Rig-edit overlay: draggable joint
  handles, bones as lines, assign leaf shapes to slots, scrub-preview. Write to
  `meta.rig` (normal, undoable history — like `markAsPlayer`). **Keystone; no AI.**
- **R2 — Manual animation, Tier A.** `game/anim/` timelines + evaluator +
  state→clip selector wired to the sim. Timeline UI reuses the R1 overlay with a
  time axis. Ship: hand-authored walk/idle/jump auto-selected from sim state.
- **R3 — IK + physics constraints (Tier B).** Analytic two-bone IK (foot-plant,
  reach) + spring/physics constraint (tail/hair/cape). Slots into the §3.4
  dependency cache. Constraint-editing UI. Still native shapes.
- **R4 — Auto-rig via Claude vision.** First AI converter. `perceive()` (§1.2) →
  Claude returns a `Rig` (bones, slots, rigid attachments by leaf ID, suggested
  IK/physics). Zod-validate (leaf IDs exist, tree acyclic, root resolves) →
  **opens the R1 editor** to tweak. General graph → any character, any limb count.
- **R5 — Auto-animate via Claude.** Rig + labeled rest-pose PNG + target action →
  Claude returns `Clip`s in the exact §3.3 format (keyframed bone angles, cubic
  ease). Batch the whole clip set in one call. Lands in the R2 timeline editor.
- **R6 — Tier C (weighted skinning).** Custom `SkinnedPlayerShape`
  (`getSvgPathData()` = per-frame CPU-skinned path). Weight-painting UI (≤4
  influences, normalized). Auto-weight via Claude vision, or a distance-to-bone
  heuristic (Pose Animator) as a non-AI fallback. The pro tier: smooth bending,
  no tearing. Isolated, opt-in per entity.

---

## 4. Gameplay systems (the other half of the toolkit)

Rigging (§3) makes characters *look* alive; these systems make the game *play*.
They are the full accounting of `engine-ideas.md` — every feature in that doc is
placed below into one of five systems (G1–G5), each with its data model, where it
lives in the runtime, and its phase. Nothing from the ideas doc is dropped
silently; a **Cut / deferred** subsection at the end says why the few excluded
items are out.

Two of these systems are *converters* in the §2 sense (they have an AI "draw/
prompt → data" step): **level generation** (G4) and **feel/mechanic tuning**
(G5). The other three (movement G1, entity behavior G2, environment G3) are
mostly **runtime + data + tray/editor** — the AI reaches them indirectly by
emitting their data as part of a level or an enemy.

All of this rests on the **N-entity + `meta` behavior model (§1.3)** — that
refactor is what turns each feature below into *data on a shape* rather than new
loop code.

### G1 — Movement & player abilities (`game/physics.ts`, extends `PhysicsTunables`)

The current [physics.ts](game/physics.ts) already implements the whole "Core
Physics & Platformer Metrics" table from ideas §Phase 1: accel/decel
(`groundAccel`/`groundFriction`), max speed (`moveSpeed`), jump force
(`jumpSpeed`), asymmetric + apex gravity (`fallGravityMult`/`apexGravityMult`/
`apexThreshold`), variable-jump cut (`jumpCut`), coyote (`coyoteTime`), jump
buffer (`jumpBuffer`), corner correction (`cornerCorrect`), plus a slope-jump the
ideas doc didn't have. **So Phase-1 of the ideas doc is essentially done** — the
new work is the *abilities* it lists under later phases.

Each ability is a new field on `PhysicsTunables` + a small piece of `step()`
logic + one entry in `TUNABLE_GROUPS` so it shows in the live panel and is
AI-tunable for free (G5). Grouped by dependency:

| Ability (ideas source) | New tunables | Runtime notes | Phase |
|---|---|---|---|
| **Air brake** (P1) | `airBrake` | decel applied when all move keys released mid-air | G1a |
| **Squash & stretch** (P1) | `squashStretchIntensity` | *visual only* — scale the player leaves on land/jump; overlaps Tier-A rig squash (§3), so gate behind "no rig" | G1a |
| **Turn snappiness** (P1) | `turnMult` | multiply decel when input opposes `vx` sign | G1a |
| **Dash** (P3) | `dashSpeed`, `dashDuration`, `dashCooldown` | new sim sub-state; horizontal (or 8-dir) velocity override + cooldown timer; a new `dash` clip in the rig | G1b |
| **Wall slide + wall jump** (P3) | `wallSlideFriction`, `wallJumpX`, `wallJumpY`, `wallJumpTolerance` | *reuses the existing `touchingWall`/`wallNx` machinery* — slope-jump already proves the contact detection; wall-slide clamps fall speed while `touchingWall`, wall-jump kicks along `wallNx` | G1b |
| **Ledge grab** (P3) | `ledgeGrabOffsetY` | probe for a top-edge near the head; snap + hang state | G1c |
| **Pogo bounce** (P3) | `pogoBounceVelocity` | downward attack hitting an enemy (needs G2) → upward impulse | G1c (needs G2) |
| **Flutter / floaty jump** (P3) | `flutterGravityScale` | reduce gravity while jump held at apex (Yoshi) — a variant of the apex logic already present | G1b |
| **Grapple** (P3) | `grappleLength`, `grappleSwingForce` | pendulum constraint to an anchor shape; the heaviest ability | G1d |
| **Swim** (P3) | `swimBuoyancy`, `swimMaxSpeed` | inside a fluid volume (a `role: water` region), replace gravity with buoyancy + clamp speed | G1c (needs G3 regions) |

**Approach:** ship G1a (cheap knobs) with the tuning converter (G5); G1b (dash,
wall-jump, flutter) as the first "real ability" pack; G1c/G1d behind the systems
they need. Each ability is opt-in per level via a flag set (`enabledAbilities`),
so AI can turn on "Celeste kit = dash + wall-jump" as data.

### G2 — Entity behavior: enemies & AI (`game/entities/`, `game/ai/`)

The ideas doc's Phase-2 combat table and Phase-4 AI table. All of it hangs off
the **N-entity sim (§1.3)** — an enemy is just an entity with an `EnemyBehavior`
in `meta`.

```ts
interface EnemyBehavior {
  archetype: 'patroller' | 'stalker' | 'ambusher' | 'flyingSwarmer' | 'shooter'
  detectionRadius: number            // raycast/distance to player (ideas: detection_radius)
  turnOnEdge: boolean                // patrollers flip at ledges (ideas: turn_on_edge)
  projectileInterval?: number        // shooter cadence (ideas: projectile_interval)
  sine?: { amplitude: number; frequency: number }   // flying path (ideas: sine_wave_*)
  gazeReactive?: boolean             // Boo-style: acts only when unobserved (ideas: gazing_trigger_state)
  directionalArmorArc?: number       // damage-immune arc (ideas: directional_armor_arc)
  shieldGate?: boolean               // invuln until it attacks (ideas: shield_gate_active)
  spawnRate?: number                 // spawner nodes (ideas: spawn_rate_seconds)
}
interface Vitality {                 // ideas Phase-2 combat table — opt-in, on player and/or enemies
  maxHealth: number; iFrames: number         // invincibility_duration
  attackCooldown: number
  knockback: { x: number; y: number }        // knockback_vector_*
  collisionMask: number                       // bitmask layers (ideas: collision_layer_mask)
  parry?: boolean
}
```

- **Motion archetypes** slot into the §1.3 `motion` union (`patrol`, `sine`,
  `chase`, `projectile`, `spawner`) — pure functions of `(entity, playerPos, dt)`.
- **Detection / gaze / armor** are perception fields read each step; `gazeReactive`
  needs the player facing vector (`vx` sign), which the sim has.
- **Combat/vitality** (health, i-frames, knockback, parry, collision-mask layers)
  is **opt-in** — a game with no combat carries none of it. Ships only when a
  target game needs it; it's not on the critical path to the core promise.
- **AI converter:** an enemy is the richest single-drawing target — Claude
  returns **a rig (§3) *and* an `EnemyBehavior`** from one drawing via `perceive()`.
  Manual editor first (assign archetype + params in an overlay), then AI.

Phases: **G2a** motion archetypes (patrol/sine/chase) on the N-entity sim; **G2b**
projectiles + spawners; **G2c** combat/vitality (health/damage/knockback);
**G2d** perception niceties (gaze, directional armor, shield gate); **G2e** the
auto-enemy AI converter.

### G3 — Environment, hazards & interactive props (`game/entities/`, `roles.ts`)

The ideas doc's Phase-2 environment table and Phase-3 reactive-hazards table.
Each is a **role** (tray entry + `meta.role`) with a motion/collision/effect from
the §1.3 model. Grouped by what they need:

| Element (ideas source) | Model | Phase |
|---|---|---|
| **One-way platform** (P2 `one_way_pass_through`) | `collision: 'oneWay'` — resolve top-down landing only | G3a |
| **Slopes** (P2 `slope_angle`) | *collision already rides real outlines*; formalize walk-up + the existing slope-jump | G3a |
| **Spring / launch pad** (P2 `spring_launch_velocity`) | `effect: 'bounce'` with an impulse param | G3a |
| **Instakill hazard** (P2 `is_instakill_hazard`) | `effect: 'kill'` (have it) + an instant variant | G3a |
| **Checkpoint** | `effect: 'checkpoint'` — moves `spawn` | G3a |
| **Ladder / climb** | `role: 'ladder'`; overlap + up/down disables gravity, drives `vy`; new `climb` sim-state + clip. *Open Q: gravity-only vs. also disable solids (lean gravity-only)* | G3b |
| **Portal** | paired `effect: 'teleport'` triggers (channel-linked) | G3b |
| **Moving platform** | `motion: 'mover'` — the first non-player mover; **re-read per frame** (breaks the "solids captured once" rule deliberately, for tagged movers only) | G3b |
| **Switch / toggle network** (P2 `switch_network_channel`) | `channel: number` linking plates ↔ toggled blocks | G3c |
| **Conveyor / current** (P3 `surface_velocity_vector`) | adds a surface velocity to bodies resting on it | G3c |
| **Synchronized toggles** (P3 `global_sync_cycle_id`) | a global clock; hazards listen on a `syncCycle` id | G3c |
| **Crusher / Thwomp** (P3 `hazard_drop_gravity_scale`) | a mover that raycasts for the player then drops fast | G3c |
| **Water / fluid volume** | `role: 'water'` region enabling swim (G1c) | G3b |

Phases: **G3a** static-ish additions that need no new motion (one-way, spring,
checkpoint, slopes) — cheap, ship early; **G3b** the first movers + regions
(ladder, portal, moving platform, water); **G3c** the networked/synchronized set
(switches, conveyors, sync'd hazards, crushers).

### G4 — Level generation & camera (converter; `game/ai/autoLevel.ts`)

- **Level generator** — Data: `LevelLayout = Array<{ role, x, y, w, h, meta? }>`
  where `meta` carries any G2/G3 behavior params. Runtime already exists
  (`createShape` from role data — [engine.ts](game/engine.ts) reads roles at
  `start()`). Manual editor: the **tray + canvas already are** the editor. AI:
  `perceive()` optional — prompt-only ("a 3-screen level with a dash gap and two
  enemies"), or "extend/replace this sketch." **Cheapest, highest-wow converter;
  regenerate freely.** Ships early (see build order).
- **Camera** (ideas P2 `parallax_factor`, `camera_deadzone_width`,
  `camera_look_ahead_scale`) — a small camera module that drives tldraw's camera
  during play: a deadzone box, velocity look-ahead, and parallax for tagged
  background shapes. Currently the demo uses tldraw's camera as-is. Phase **G4-cam**,
  independent of level-gen; nice polish, not blocking.

### G5 — Feel & global mutators (converter; `game/ai/autoTune.ts`)

- **Feel / mechanic tuning** — Data: `PhysicsTunables` (exists) + `enabledAbilities`
  (G1). Runtime + manual: the live [PhysicsPanel](render/PhysicsPanel.tsx) already
  reads `tunablesAtom` each substep and has Copy/Reset. AI: prompt → tunables JSON
  ("floaty like Celeste with a dash"). **Nearly free** — a flat JSON knob set with
  a live panel already built. Ships early alongside level-gen.
- **Global architecture knobs** (ideas P5) — `target_framerate` maps to the
  existing `SIM.FIXED_DT`; **the rest (`spatial_hash_cell_size`, `networking_mode`,
  `rollback_input_buffer`, `chunk_buffer_distance`) are Cut — see below.**
- **Disruptive mutators** (ideas P5 indie-inspiration table) — the *creative*
  payoff, but **stretch goals** gated on the entity + rule-data model maturing:
  gravity inversion (VVVVVV) = a global gravity-sign flag; time dilation (Superhot)
  = a global `dt` scale; dimension/layer swap (FEZ) = an active-layer index on
  shapes; color-channel solidity (Hue) = a `colorMask` making matching shapes
  non-solid; magnet (`magnet_attraction_force`); rhythm-gated input (Necrodancer);
  rule-lookup (Baba) = per-entity mutable rules. Each is a global engine flag or a
  `meta` rule — powerful for "creative games," explicitly **Phase G5-mut, last**,
  because they need N-entity + a rule-data model that G2/G3 build up to.

### Cut / deferred (from `engine-ideas.md`, with reasons)

- **`spatial_hash_cell_size`** — a broad-phase collision optimization. The current
  sim brute-forces player-vs-solids and is fine at prototype scale; add only if
  entity counts make it bite. *Deferred, not planned.*
- **`networking_mode` / `rollback_input_buffer` / `NET_ROLLBACK` / `GHOST_SYNC`**
  — multiplayer/netcode. Out of scope: this is a single-player, single-canvas
  builder. (The repo *has* a sync Worker for tldraw collaboration, but that's
  document collab, not game netcode.) *Cut.*
- **`chunk_buffer_distance` / tilemap streaming** — the engine is not tile-based;
  levels are native shapes read once at `start()`. Streaming off-screen chunks is
  a different architecture. *Cut* (revisit only if levels get huge).
- **`tile_id`** — same reason; there's no tilesheet, elements are shapes. *Cut.*
- **The `[cite: …]` markers** throughout the ideas doc are template artifacts, not
  features. *Ignored.*

---

## 4.5 Game-completeness gap analysis (can we build *any* platformer?)

Stress-tested the plan against a spread of landmark pro/indie platformers to find
what's missing. **Verdict: §§1–4 cover the *mechanical/physics* layer of nearly
every platformer, but not the *game-structure* layer** — the systems that turn a
set of mechanics into a finished game. Below: what each iconic title needs that
the plan didn't yet have, distilled into eight missing systems (M1–M8).

**What the plan already handles well** (no gap): run/jump/dash/wall-jump feel
(Mario, Celeste, Meat Boy) via G1; enemies + hazards + projectiles (Mario, Cuphead
basics) via G2/G3; gravity flip / time dilation / layer-swap (VVVVVV, Braid,
FEZ) via G5-mut; the level-*building* loop itself (Mario Maker, LittleBigPlanet) —
that's the demo's native shape; character look & animation via §3.

**The gaps — new systems to add:**

- **M1 — Game state, goals & flow (`game/session/`).** The plan can start/win/
  respawn one screen, but has no notion of **multiple levels, a win/lose
  *sequence*, score, lives, timer, or a title/level-select/game-over flow.** Every
  finished game needs this. Data: a `GameDef { levels: LevelRef[]; rules: {lives?,
  timer?, scoreToWin?, ...}; flow }`. This is the outermost container the AI should
  also be able to author ("a 5-level game where…"). *Highest-priority gap — without
  it you have levels, not games.*

- **M2 — Collectibles, inventory & power-ups (`game/items/`).** Tokens exist, but
  not **items that change the player** (Mario mushroom/fire-flower, Metroidvania
  ability pickups, Hollow Knight charms, Downwell upgrades) or a **carried
  inventory** (keys, Spelunky items, Neon White cards). Data: `Item { effect:
  grantAbility | grow | heal | key | ammo | custom; persistent? }` + a player
  inventory/ability set the run mutates. Unlocks power-up games and ability-gated
  Metroidvanias. *Ties to G1's `enabledAbilities` — a pickup flips one on.*

- **M3 — Persistent world / room graph & save (`game/world/`).** Single-screen
  today. **Metroidvanias (Hollow Knight, Metroid, Ori) need interconnected rooms,
  camera transitions between them, persistent state (opened doors, defeated
  bosses, collected upgrades), and save/load.** Data: a graph of rooms + edges
  (transitions), a persistent flags store. Big; needed only for the
  explore-a-connected-world subgenre. *Scope decision — see below.*

- **M4 — Bosses & scripted sequences (`game/script/`).** G2 gives enemy *archetypes*
  but not **multi-phase bosses, bullet-hell patterns, or scripted encounters**
  (Cuphead, Hollow Knight bosses, most game finales). Data: a small
  phase/pattern/trigger DSL (`when hp<50% → pattern B`; timed spawn waves). An
  excellent AI-authoring target ("a 3-phase boss that…"). *Distinct from per-frame
  AI; it's choreography.*

- **M5 — Camera system (`game/camera/`).** Listed in G4 as "polish," but it's
  **load-bearing** for whole subgenres: auto-scroll (forced-scroll levels, shmup-
  platformers), screen-lock arenas (boss rooms), snap-per-screen (Zelda II / early
  Metroid), and smooth follow with deadzone/look-ahead (everything modern).
  Promote from polish to a real system: `CameraMode { follow | autoScroll |
  locked | perScreen; deadzone; lookAhead; bounds }`. *Auto-scroll especially
  gates a real class of levels.*

- **M6 — Momentum & advanced surface physics (`game/physics.ts` deepening).** The
  resolver rides slopes, but **Sonic-style loops/ramps, momentum preservation on
  curves, and momentum-through-portals** need velocity to follow surface tangents
  and survive teleports. Also: **moving-platform velocity inheritance** (stand on a
  mover, inherit its velocity on jump) — subtle but expected. *Needed for
  momentum-physics games; niche but a hard "no" without it.*

- **M7 — Audio (`game/audio/`).** No game ships silent. **SFX on events (jump,
  land, collect, hurt, die) and music per level/state** are table-stakes. The repo
  already has `tone`/`@tonejs/piano` deps — the hooks exist. Data: an event→sound
  map + per-level track. Also an **AI surface** (prompt → which sounds/mood), and a
  natural fit for procedural/synth SFX so no asset pipeline is needed. *Cheap,
  high-impact; currently entirely absent.*

- **M8 — UI / HUD & juice (`game/hud/`, effects).** Games need an **on-screen HUD**
  (health, score, timer, collected count — the demo shows a bare counter) and
  **"juice"**: hit-stop, screen shake, particles, flash-on-hit, coin-pop. This is
  much of what makes a platformer *feel* finished (the ideas doc's
  `squash_stretch` is one atom of it). Data: a HUD layout + an effects trigger map.
  *Polish, but the difference between "tech demo" and "game."*

**Honest scope call.** M1, M2, M5, M7 are **required for the great majority of
platformers** and should be in the plan proper. M4, M6, M8 make specific subgenres
(boss-driven, momentum, high-juice) — add when a target game needs them. **M3
(persistent Metroidvania world) is the one genuinely large system**; treat it as a
*stretch subgenre* — the plan can honestly claim "any *single-flow* pro/indie
platformer" without it, and "Metroidvania too" is a later, deliberate investment.

With M1–M8 folded in, the honest claim becomes: **the engine can build the great
majority of pro/indie platformers**; the remaining hard cases are (a) deeply
interconnected Metroidvanias (M3, planned-but-large) and (b) genre *hybrids* that
stop being platformers (rhythm-first, card-battler, full RPG) — out of scope by
definition.

---

## 5. Build order

Three streams run through the work: **substrate** (S), the **rigging** vertical
(R, §3), **gameplay** systems (G, §4), and **game-structure** systems (M, §4.5).
The diagram below reads **top-to-bottom = the order to build in**, bucketed by the
v1/v2/v3 line (§ below); the letter (S/G/R/M) on each row is just which stream it
belongs to, not its timing. Within a bucket, rows are largely parallel — the
streams touch different files (R: `rig/`+`anim/`; G: `physics.ts`+`entities/`;
M: `session/`/`camera/`/`audio/`…) and meet only at the sim — except where an
arrow (`→`) or a "needs" note forces an order.

```
┌─ FOUNDATION ──────────────────── build first; everything blocks on it ─────────┐
  S0  Claude skills (§9)           guardrails every later phase/sub-agent reuses
  S1  AI plumbing                  Worker proxy + Zod + retry     → unblocks all AI
  S2  perceive() bundle            PNG + geometry-by-ID + SVG     → unblocks vision AI
  S3  N-entity refactor            meta.role/behavior; SOLO + adversarial verify
                                   (behavior-preserving; old levels unchanged)
      order: S0 → (S1 ∥ S2) → S3
└────────────────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ v1 · THE MINIMUM LOVABLE GAME ── ship this WHOLE before starting v2 ───────────┐
  G4  level generator      runtime already exists; prompt → shapes  ── quick win
  G5  feel/mechanic tuning live panel already exists; prompt → tunables ── quick win
  G3a static props         one-way / spring / checkpoint / slopes    ── needs S3
  G2a enemy (patrol/stomp) the ONE enemy a Mario-like needs; N-entity sim ── needs S3
  M1  game state/flow      levels, lives, score, timer, title/win/lose ── makes it a GAME
  M5-follow  follow camera deadzone + look-ahead (NOT autoScroll/locked yet) ── frames the game
  M7  audio                event SFX + per-level music (tone deps present) ── not-silent
  M8-HUD  on-screen HUD    health / score / timer / collected count
      → an AI-generated, tuned, multi-level, audible platformer. NO rigging.
      TEMPLATE EXIT TEST: can build a Mario-1-1-like + an auto-runner (see §5.5).
└────────────────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ v2 · DEPTH & CHARACTER ───────── the flagship + genre widening; parallel streams ┐
  R (rigging §3 — deepest, riskiest; the flagship proof of depth)
    R1 rig model + manual editor (Tier A rigid) ── keystone, no AI
    R2 manual animation + state→clip selector
    R3 IK + physics constraints (Tier B) ─┐
    R4 auto-rig via Claude vision        ─┘ (R3 ∥ R4)
    R5 auto-animate via Claude
    R6 Tier C weighted skinning (custom shape, opt-in)
      order within R: R1 → R2 → (R3 ∥ R4) → R5 → R6
  G (gameplay §4 — need S3; run parallel to R)
    G1  abilities   G1b dash/wall-jump/flutter → G1c ledge/swim → G1d grapple
    G3  props       G3b movers (ladder/portal/platform/water) → G3c networked (switch/conveyor/crusher)
    G2  enemies     (G2a shipped in v1) → G2b projectiles/spawners → G2c combat → G2d perception → G2e auto-enemy
  M (structure §4.5 — parallel to R and G)
    M5  camera modes (G5-follow shipped in v1) → autoScroll, locked, perScreen ── gates subgenres
    M8-juice  shake / hit-stop / particles / flash-on-hit
    M2  items/inventory/power-ups (pickups flip a G1 ability; keys)
      TEMPLATE EXIT TEST: can build a Celeste-like (dash + wall-jump) (see §5.5).
└────────────────────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ v3 · BACKLOG · target-driven ─── build only when a concrete game demands it ───┐
  G5-mut  disruptive global mutators (gravity flip, time dilation, layer/color/rule)
  M4      bosses & scripted sequences (phase/pattern DSL)   ── boss-driven games
  M6      momentum & advanced surfaces (loops, portal/mover momentum) ── momentum games
  M3      persistent world / room graph / save (Metroidvania) ── STRETCH: the one large system
      TEMPLATE EXIT TEST: G5-mut earns a VVVVVV-like (gravity-flip) (see §5.5).
└────────────────────────────────────────────────────────────────────────────────┘
```

**Recommended sequencing** (each phase orchestrated per §10 — scout → parallel
fan-out → verify → integrate):
0. `S0` — author the §9 skills (one agent per skill, parallel). These are the
   guardrails every later fan-out depends on.
1. `S1 → S2 → S3` — foundation. S1/S2 parallel; **S3 solo + adversarial verify**.
2. `G4` + `G5` + `G3a` + **`G2a`** + **`M1`** + **`M5`-follow** + **`M7`** +
   **`M8`-lite (HUD only)** — an AI-generated, multi-level, *audible* game with
   feel tuning, basic props, a stompable patrol enemy, a follow camera, and an
   on-screen HUD. **`M1` is what makes it a game, not a screen; `M7` is what makes
   it not-silent; `G2a` + `M5`-follow are what let v1 honestly build a
   Mario-1-1-like** (§5.5). This is the true first playable game — and it ships
   with **no rigging** (the player stays the rigid whole-body body it is today).
   **Cap v1 with its template exit test (§5.5): a Mario-1-1-like + an auto-runner.**
3. **v2 — the rigging vertical:** `R1 → R2` (an animated cut-out player), then
   `R3…R6`. Deferred until v1 is a complete small game, because it's the single
   largest, riskiest track and v1 must not be gated on it.
4. **`M5` (autoScroll/locked/perScreen) + juice half of `M8`** — the remaining
   camera modes + shake/hit-stop/particles: the jump from "works" to "feels
   finished." Deepen the gameplay streams in parallel: `G1b` (dash/wall-jump →
   the Celeste-like template), `G3b`, `G2b…`, `M2`.
5. Target-driven depth: `M4` (bosses), `M6` (momentum) when a specific game needs
   them; `G5-mut` for the creative-sandbox payoff.
6. `M3` (persistent Metroidvania world) — a deliberate, later, large investment;
   the plan claims "any *single-flow* platformer" without it.

### The hard v1 / v2 / v3 line

This plan is ~40 shippable units. To keep it honest — "professional-grade
*concepts*, prototype-grade *scope*" — commit to a line and treat everything below
it as backlog, not roadmap:

| Tier | Contents | The claim it earns — and its **template exit test** (§5.5) |
|---|---|---|
| **v1 — the minimum lovable *game*** | `S1–S3` (substrate) + `G4` (level-gen) + `G5` (feel) + `G3a` (static props) + **`G2a` (patrol/stomp enemy)** + `M1` (game flow) + **`M5`-follow (follow camera)** + `M7` (audio) + `M8`-HUD | An AI-generated, tuned, multi-level, audible platformer with a real game loop — a *game*, not a tech demo. **No rigging; rigid whole-body player.** **Exit test: builds a Mario-1-1-like + an auto-runner.** |
| **v2 — depth & character** | the rigging vertical `R1–R6`; ability packs `G1b–G1d`; movers/props `G3b–G3c`; enemies `G2b–G2e`; camera/juice `M5` (autoScroll/locked/perScreen) + `M8`-juice; items `M2` | The player comes alive and the genre coverage widens: dashes, wall-jumps, more enemies, animated cut-out characters. **Exit test: builds a Celeste-like (dash + wall-jump).** |
| **v3 — backlog / target-driven** | `G5-mut` (disruptive mutators); `M4` (bosses); `M6` (momentum/loops); `M3` (persistent Metroidvania world) | The creative-sandbox payoff and specific subgenres — built only when a concrete target game demands them. `M3` is the one genuinely large system and is explicitly a stretch. **Exit test: `G5-mut` earns a VVVVVV-like.** |

**Ship v1 whole before starting v2.** The rigging vertical is the flagship *proof
of depth* (§3), but it is the biggest single risk in the plan; gating v1 on it
would sink the whole thing. v1 already delivers the core promise — draw/describe →
Claude → data → deterministic runtime → hand-edit — end to end.

**Why `G2a` + `M5`-follow moved into v1.** They were v2, but the template exit
test (§5.5) exposes that a v1 with *no enemy* and *no game-framing camera* can't
honestly build even Mario 1-1 — the canonical platformer. A stompable patrol
Goomba and a deadzone/look-ahead follow camera are the minimum that turns "a
level you walk through" into "a game you play." The rest of `G2`/`M5` (projectiles,
combat, autoScroll, locked arenas) stays v2 — v1 pulls forward only the two
pieces the flagship template *requires*, nothing more.

---

## 5.5 Template games (the acceptance test for every tier)

Templates are **pre-authored data, not new engine code** — a `GameDef` (§M1) +
its levels (`LevelLayout`, §G4) + tuned `PhysicsTunables` + `enabledAbilities`
(§G1/G5) + roles/behaviors stamped in `meta` (§1.3), composed entirely from
primitives the plan already builds. They ship as bundled starter documents the
user opens, plays, and hand-edits with the same tools — the clearest possible
demonstration of "AI authors data; the runtime plays data" (§0), because a
template is just *frozen* AI-shaped data with no AI in the loop.

**Templates are not a build phase; they are each tier's exit criterion.** "Can we
actually build Mario 1-1?" is a far sharper completeness check than any feature
checklist — it forces the mechanics, level-gen, camera, audio, and game-flow to
work *together*, end to end, on a target every reader already knows. So each tier
(§5) closes only when it can produce its named template. That's what pulled `G2a`
and `M5`-follow into v1: the flagship template demanded them.

Each template doubles as a demo asset (a "New game from template" entry) and as a
regression fixture (load it, auto-play the intro, assert win-reachable).

### The template set (mapped to the tier that unlocks it)

| Template | What it exercises | Tier | Why this one |
|---|---|---|---|
| **Auto-runner / Flappy** | tuned feel (`G5`) with a constant forward `vx` (a `G5` tunable, *not* the v2 `autoScroll` camera) tracked by the v1 follow camera (`M5`-follow) + one hazard (`G3a`) + score/flow (`M1`) — almost no other machinery | **v1** | The *cheapest* real game — proves the AI spine (level-gen → feel → flow → audio) with minimal parts. A v1 warm-up template that stays inside v1's camera scope (forced-scroll is v2). |
| **Mario 1-1-like** | run/jump feel (`G1`) + patrol/stomp enemy (`G2a`) + pipes/blocks/coins (`G3a`) + flag goal + follow camera (`M5`-follow) + flow/HUD (`M1`/`M8`) | **v1** | **The flagship exit test.** The canonical platformer; if v1 can't build it, v1 isn't a platformer engine. It's why `G2a`+`M5`-follow are v1. |
| **Celeste-like** | tight feel + **dash + wall-jump** (`G1b`) + spike hazards (`G3`) + single-screen rooms + checkpoints (`G3a`) | **v2** | Exercises the first "real ability" pack — the natural flagship for v2's genre-widening claim. |
| **VVVVVV-like** | **gravity-flip** (`G5-mut`) instead of jump + spike hazards (`G3a`) + per-screen camera (`M5`) | **v3** | Proves the disruptive-mutator system: a global gravity-sign flag turns the *same* runtime into a different genre with no new physics. |

**Ordering within a tier:** build the template *last* in its tier, as the
integration gate — it consumes finished primitives and surfaces any that don't
compose. A template that can't be authored means a primitive is missing or wrong;
that's the signal to fix the primitive, not to special-case the template.

**Authoring path (dogfoods the converters).** Each template is authored the way a
user would: draw/prompt the level (`autoLevel`, §G4), prompt the feel
(`autoTune`, §G5), then hand-edit — then **freeze the resulting data** as the
bundled template. So building the templates is itself the end-to-end test of the
AI spine, and the shipped artifact is real user-authored data, not a hand-coded
level format that bypasses the runtime.

**Not in the first set (and why):** a Metroid-room template waits on `M3`
(persistent world, v3 stretch); a Sonic-loop template waits on `M6` (momentum,
v3); a Cuphead-boss template waits on `M4` (boss DSL, v3). Each becomes that
system's own exit test when its tier is built — the pattern generalizes, we just
don't pre-build templates for unbuilt systems.

---

## 6. Rendering tiers (the honest fork for a vector host; §C9)

Only **WebGL** has a vertex shader; in SVG/DOM & Canvas 2D, weighted skinning is
**CPU skinning** (transform points each frame, re-emit geometry). tldraw renders
vector shapes, so pro-grade smooth joint bending means CPU-skinning Bézier
control points and rewriting path `d` (what Pose Animator and Rive do). Native
tldraw shapes can't do per-vertex weighting — a `<g transform>` per part is a
rigid cut-out puppet (joints tear). So:

| Tier | Render | Deformation | tldraw fit | When |
|---|---|---|---|---|
| **A. Rigid** | native leaf shapes, transformed per frame | parts translate/rotate rigidly about their joint | **native-first, no custom shape** | ships first; good for cut-out/paper-puppet characters |
| **B. Rigid + secondary** | native shapes | + physics/spring & IK move whole parts | native-first | adds life (tail swing, foot-plant) without mesh skinning |
| **C. Skinned** | **custom shape** whose `getSvgPathData()` returns a per-frame CPU-skinned path | true weighted LBS on Bézier control points + handles (≤4 bones/vertex) | **custom shape, player render only** (documented exception) | the pro tier: smooth bending, no tearing |

**Tier C is a deliberate, isolated exception** to native-first — for the
character's on-screen render only, not the level. The custom shape holds the
skinned path in props; **collision still uses the rest outline** (§ below). Cost
is real (Spine: "each vertex computed by the CPU each frame"; rewriting `d`
re-parses) — Tier C caps vertex/bone counts and prunes weights, as Spine advises.

**Collision stays rigid in every tier.** `playerSamples` remains the merged rest
outline collected at `start()`. Limbs animate visually; the collision body does
not deform — the standard platformer choice (stable outline + cosmetic
animation), keeping the sim cheap and matching the demo's existing "solids
captured once" honesty.

---

## 7. File layout (new, under `src/demos/engine/`)

```
game/
  ai/
    client.ts       # Worker-proxied Anthropic client + Zod validation + retry
    perceive.ts     # THE shared perception bundle (PNG + geometry-by-ID + SVG)
    schemas.ts      # Zod: Rig, Clip[], LevelLayout, EnemyBehavior, Tunables, GameDef (shared client/worker)
    autoRig.ts autoAnimate.ts autoLevel.ts autoEnemy.ts autoWeight.ts autoTune.ts autoBoss.ts
  entities/
    types.ts        # Entity, Motion, Collision, Effect, per-motion params (§1.3)
    step.ts         # N-entity stepping (player = entity 0); pure where possible
    step.test.ts
  rig/
    types.ts evaluate.ts ik.ts physics.ts skin.ts + *.test.ts   # §3
  anim/
    types.ts sample.ts machine.ts + *.test.ts                   # §3
  session/          # M1 — game state & flow
    game.ts         # GameDef (levels, rules, flow), level progression, win/lose
  items/            # M2 — collectibles, inventory, power-ups
    types.ts inventory.ts
  world/            # M3 — persistent room graph + save (STRETCH)
    graph.ts save.ts
  script/           # M4 — bosses & scripted sequences (phase/pattern DSL)
    boss.ts
  camera/           # M5 — camera modes (follow/deadzone/autoScroll/locked)
    camera.ts
  audio/            # M7 — event SFX + music (uses existing tone deps)
    sfx.ts music.ts
  hud/              # M8 — HUD layout + juice (shake, hit-stop, particles)
    hud.ts effects.ts
  templates/        # §5.5 — bundled starter games (frozen GameDef + level data)
    index.ts        # registry: name → GameDef; feeds "New game from template"
    autoRunner.ts marioLike.ts celesteLike.ts vvvvvvLike.ts   # per-tier exit tests
render/
  RigEditor.tsx     # InFrontOfTheCanvas overlay: joints/bones/slots/constraints/scrub
  Timeline.tsx      # clip keyframe timeline
  WeightPaint.tsx   # Tier C weight painting
  GameFlowUI.tsx    # M1 — title / level-select / win / game-over screens
  Hud.tsx           # M8 — in-play HUD overlay
shapes/
  SkinnedPlayerShape.tsx   # Tier C custom ShapeUtil (getSvgPathData per frame)
worker/
  engine.ts         # /api/engine/* Anthropic proxy (key server-side)
```

Engine's [CLAUDE.md](CLAUDE.md) gains a section per shipped piece: the substrate
(AI boundary, perceive bundle, entity model), then per converter and per
game-structure system.

---

## 7.5 UI / UX design (minimal, native, selection-driven)

The engine adds ~20 capabilities across §§1–4.5. The risk is turning a clean
canvas into a control panel. **Three rules keep it minimal and keep it tldraw:**

1. **Every surface maps to a native tldraw component slot** (`components`
   override) — never a floating HTML panel bolted onto `<Tldraw>`. tldraw exposes
   named slots (verified against the installed types): editor slots
   `InFrontOfTheCanvas`, `OnTheCanvas`, `Background`; UI slots `SharePanel`,
   `Toolbar`, `StylePanel`, `ContextMenu`, `MainMenu`, `HelperButtons`, `Toasts`,
   `Dialogs`, `KeyboardShortcutsDialog`, etc. We already use `InFrontOfTheCanvas`
   (Tray + PlayerToolbar + PhysicsPanel) and `StylePanel`. **Everything new lands
   in an existing slot.**
2. **Nothing appears unless context calls for it.** The canvas at rest shows only
   the tray. Editing surfaces are **selection-driven** (the contextual toolbar
   pattern you already have) or **mode-driven** (an overlay while in a rig/paint
   edit mode). This is exactly how `PlayerToolbar` already works — generalize it.
3. **Follow the official examples verbatim** (as the current code does). The Tray
   is the "Drag and drop tray" example; the toolbar is the "Contextual toolbar"
   example. New pieces cite and follow a specific tldraw example, so we never
   invent UI patterns tldraw already has.

### The two anchors you like — kept and generalized

- **Left Tray** stays the single "add stuff" surface. As roles grow (enemy,
  spring, ladder, portal, checkpoint, item…), **do not grow a flat wall of
  icons** — group it. Tldraw's tray example supports sections; the Tray becomes
  categorized (Terrain / Hazards / Enemies / Items / Props), collapsed by default,
  matching tldraw's own toolbar overflow behavior. The five original color-coded
  roles stay top-level; everything else is `meta.role`-based (§1.3) and lives in a
  section. **One tray, sectioned — not many panels.**
- **Contextual toolbar** becomes the primary **per-element editor**, replacing
  most would-be panels. Today it shows one action ("Set as Player") for a
  selection. Generalize it to be **role-aware**: the buttons shown depend on the
  selected shape's role. Select an enemy → "Edit Behavior" + "Rig"; select a
  player → "Rig" + "Animate"; select a portal → "Link" (pick its pair); select
  anything → "Set as Player". This is the *one* editing entry point — minimal,
  discoverable, and 100% native (`TldrawUiContextualToolbar` +
  `TldrawUiToolbarButton`, both already imported).

### Where each system's UI lives (native slot per feature)

| System | Surface | Native slot / pattern |
|---|---|---|
| **Play / Stop / Reset / Restart** (exists) | top-right buttons | **Move off the hand-rolled `eng-topbar` HTML into the `SharePanel` slot** — tldraw's own top-right home. More native, less bespoke CSS. |
| **In-play HUD** (M8) — score/health/timer | small overlay, play-only | `InFrontOfTheCanvas` (with the sim), shown only while `playingAtom` |
| **Live physics panel** (exists) | play-time tuning | already `InFrontOfTheCanvas`, play-only — keep |
| **Add elements** (roles, items, props) | left tray, sectioned | `InFrontOfTheCanvas` (existing Tray) |
| **Per-element edit** (rig / behavior / link / tune) | contextual toolbar buttons | `TldrawUiContextualToolbar` (existing, generalized) |
| **Rig / Timeline / Weight-paint editors** (§3) | full-canvas edit mode | `InFrontOfTheCanvas` overlay entered from the contextual toolbar; a "Done" exits back to select — like tldraw's own tool modes |
| **AI generate** (level / rig / enemy / feel / boss) | one prompt affordance | a single **`HelperButtons`** entry (bottom-left native slot) — "✨ Generate" — opening a native **`Dialogs`** prompt. One AI door, not one-per-converter. |
| **Game flow** (M1) — title / level-select / win/lose | between-level screens | full-screen React over the canvas (canvas hidden during flow); reuse the existing `eng-banner` win-screen pattern |
| **New game from template** (§5.5) | occasional, on an empty/new canvas | a **`MainMenu`** submenu item ("New from template →") listing the bundled games (§5.5); loads the frozen `GameDef` + level data onto the canvas |
| **Global game rules** (M1 lives/timer/score) | occasional config | a **`MainMenu`** submenu item → `Dialogs` form; not on the canvas |
| **Global mutators** (G5-mut) | rare toggles | `MainMenu` submenu — they're per-game settings, not per-shape |
| **Keyboard controls hint** (exists) | play-time text | keep the tiny `eng-controls` line; or fold into tldraw's `KeyboardShortcutsDialog` |

### The AI affordance — one door, native dialog

Rather than a "Generate X" button per converter (five buttons = clutter), a
**single ✨ Generate** in the native `HelperButtons` slot opens a native `Dialogs`
modal with a text prompt and a target ("this level / this character / an enemy /
the feel"). Claude's result **lands as editable data on the canvas and opens the
relevant editor** (rig result → rig overlay; level result → just appears as
shapes). This keeps the AI a *thin, single, native* surface — consistent with
principle 1 of §0 ("AI authors data; the runtime plays data") reflected in the UI.

### What to change now (cheap, high-consistency)

- **Retire `eng-topbar` → `SharePanel`.** The current HTML button bar is the one
  piece straying from native. Moving Play/Reset/Restart into `SharePanel` removes
  bespoke positioning CSS and puts the controls in tldraw's real top-right zone.
  *(Small, self-contained; good first UX PR.)*
- **Generalize `PlayerToolbar` → `ElementToolbar`** (role-aware buttons) before
  the second per-element action exists, so we never grow a second toolbar.
- **Section the Tray** before adding the 6th+ role, so it never becomes an icon
  wall.

**Net:** the canvas at rest looks almost exactly like today (tray + top-right
controls). Depth appears only on selection or on entering an edit mode — and every
pixel of it is a documented tldraw slot, so we stay close to the native codebase.

### UX decisions (settled)

1. **Editors are true tldraw tools/states, not floating overlays.** Rig, Timeline,
   and Weight-paint are entered via `editor.setCurrentTool('engine.rig')` and
   render their handles through `InFrontOfTheCanvas` *while that tool is active*.
   Rationale: a custom `StateNode` gives us Escape-to-exit, pointer capture, and
   tool-scoped keyboard shortcuts **for free and natively**, instead of
   re-implementing modal behavior in an overlay. It's more machinery up front but
   the most native modal feel, and it's the same mechanism tldraw's own tools use.
   (The lighter contextual-toolbar buttons stay plain React — only the full
   editors become tools.)
2. **Sectioned tray now; upgrade to a searchable insert menu only past ~15 roles.**
   Sections cost almost nothing and defer the decision. A search menu is a later,
   separate change if the role count ever demands it — not built preemptively.
3. **One "✨ Generate" dialog with a target selector** (this level / this character
   / an enemy / the feel), not per-converter buttons. It infers a sensible default
   target from the current selection, so it's one door with smart context — minimal
   surface, still fast.

---

## 8. Open questions to settle before starting

- **Entity-model migration risk.** The §1.3 refactor touches the load-bearing
  `engine.ts`. Do it as a **behavior-preserving refactor** (repo has a skill for
  this) with the existing tests green before/after; keep the player-only path as
  the zero-entity-metadata default. Confirm collision stays "captured once" for
  now (movers are the documented exception).
- **Rig storage size.** A skinned rig in `meta` grows the localStorage doc. Fine
  for a prototype; if it bloats, use a compact typed-array encoding (DragonBones/
  Rive pool numeric arrays) or move rigs to the Worker/R2.
- **State machine vs. simple selector.** R2 can ship a minimal sim-state→clip
  selector and grow into the full Rive-style state machine later, to de-risk R2.
- **Ladder collision on climb.** Disable only gravity (still stand on platforms
  mid-climb) vs. also disable solids. Leaning: gravity only.
- **Tier C collision divergence.** Keep collision on the *rest* outline even when
  the visual mesh deforms (yes — §6); document the visual/collision divergence as
  intentional.
- **AI cost/latency budget.** Batch where possible (whole clip set in one call);
  cache `perceive()` bundles per unchanged drawing; decide sync-vs-streaming for
  the editor "generating…" state.
- **Schema versioning & migration.** Every `meta`-stored model (`rig` is already
  `version: 1`; also `Rig`, `Clip[]`, `EnemyBehavior`, `LevelLayout`, `GameDef`)
  will change shape as the plan evolves — but levels persist in localStorage
  (`persistenceKey="tlArcade-engine-native"`), so old docs *will* carry old
  schemas. Decide the policy **before** the first schema ships: each model carries
  a `version`, and the loader runs a migration ladder (or, for a prototype,
  Zod-parses and drops/defaults anything that fails, logging what it dropped —
  never a silent crash on an old doc). This is the same "persistence is
  load-bearing" lesson the shell CLAUDE.md was written around.
- **AI output is non-deterministic; the runtime is not.** Claude regenerating a
  level/rig/clip gives *different* data each call — that's correct (it's
  authoring, not the loop), but it means "deterministic sim" only holds *once the
  data is fixed*. Consequence: never cache or diff on the assumption that the same
  prompt reproduces the same JSON; treat every generation as a fresh editable
  artifact the user then owns. (Reinforces principle 1 of §0.)
- **`perceive()` caching policy (decide, don't hand-wave).** Pin down the cache
  key and invalidation, not just "cache per unchanged drawing": is a bundle keyed
  per **shape-set** (the ids passed in) or per **canvas**? What invalidates it —
  any edit to a member shape's geometry/color, or a coarser "canvas version"? A
  `scale: 2` PNG + SVG + geometry for a multi-entity level is large, so this is a
  real cost/latency knob, not an afterthought. Leaning: key on the set of member
  shape ids + each member's `props`/`meta` hash; invalidate on any member change.
- **Rig vs. `writePlayer` — who owns the player's child transforms during play?**
  Today `writePlayer` moves the group *record* and the parts ride along via
  tldraw parenting (the group is a rigid body — CLAUDE.md "A group player is a
  rigid body"). The rig (§3) instead rewrites each *child's* local transform every
  frame. Both cannot own the children. Resolve explicitly: when a rig is present,
  `writePlayer` writes **only** the group record's `x/y` (translation), and the
  rig evaluator owns every child transform (rotation/scale/skin); collision still
  uses the merged rest outline (§6). When no rig is present, today's rigid path is
  unchanged. State this ownership split in the R1 CLAUDE.md section.

---

## 9. Claude skills to author before starting

This repo currently has **no `.claude/skills` or `.claude/agents`** of its own
(neighbor repos do — same `SKILL.md` = `name` + `description` frontmatter + body
convention we'll follow). A handful of skills authored *up front* pay for
themselves immediately, because every phase and every sub-agent (§10) reuses them.
Skills encode the repo's hard-won, non-obvious rules so each agent doesn't
rediscover them (or violate them). Author these first, in
`src/demos/engine/.claude/skills/` (demo-scoped) or repo-root `.claude/skills/`:

1. **`engine-runtime-conventions`** — the load-bearing invariants an agent MUST
   not break when touching the sim: all canvas writes go through
   `editor.run(fn, { history: 'ignore', ignoreShapeLock: true })`; **never**
   `isReadonly` (blocks the sim's own writes); pure sim math lives in `physics.ts`/
   evaluators (editor-free, unit-tested); feel knobs go in `PhysicsTunables` +
   `PHYSICS_DEFAULTS` + `TUNABLE_GROUPS`, never inline literals; `persistenceKey`
   is unique per demo. *Source: engine/CLAUDE.md — this skill makes those rules
   executable guidance for every sub-agent.*
2. **`tldraw-v5-native-ui`** — the UX rules from §7.5 as a checklist: prefer a
   named `components` slot over bolted-on HTML; the slot inventory (`SharePanel`,
   `HelperButtons`, `Dialogs`, `InFrontOfTheCanvas`, `OnTheCanvas`, `MainMenu`,
   `Toasts`…); full editors = custom `StateNode` tools, not overlays; cite the
   official tldraw example each piece follows. Points at `docs/tldraw/llms.txt`
   for API confirmation. *Keeps every UI PR native-first.*
3. **`engine-data-converter`** — the §2 converter pattern as a repeatable recipe:
   (1) Zod-schema'd data in `meta`; (2) pure runtime that plays it + colocated
   `*.test.ts`; (3) manual editor first; (4) AI via `perceive()` + schema + retry;
   (5) CLAUDE.md section. Any new "drawing/prompt → element" tool invokes this so
   they come out structurally identical.
4. **`engine-verify`** — the self-check gate every implementation agent runs before
   reporting done: `npm run build` (tsc + vite, incl. Worker), `npm test`
   (vitest + toolkit `.mjs`), `npm run lint`; plus "drive the actual flow" per the
   repo's `verify` skill. Encodes exactly which commands prove a change works here.
5. **`behavior-preserving-refactor`** *(already exists repo-wide)* — reused as-is
   for the S3 N-entity refactor (the one change that touches load-bearing
   `engine.ts`). No new authoring; just wire it into that phase.

Optional, later: **`engine-rig-authoring`** (the §3/§C data model + evaluation
order, so rig/anim agents share one mental model) and **`engine-ai-schemas`** (the
Zod schemas as the single contract shared by client, Worker, and every converter).

**Skill-authoring is itself Phase S0** — do it before writing engine code, because
§10's agents are only as good as the guardrails these skills give them.

---

## 10. Implementation via agent orchestration

The plan decomposes into many **independent, well-scoped units** that verify
against tests and types — an ideal fit for multi-agent orchestration. Strategy:

### 10.1 What makes this orchestratable

- **Pure, testable cores.** `rig/evaluate.ts`, `ik.ts`, `physics.ts`, `anim/
  sample.ts`, `entities/step.ts` are editor-free with colocated tests — an agent
  can build one and *prove it green* without touching UI or the sim wiring.
- **The converter pattern (§2) is uniform.** Once one converter exists, the rest
  are the same five steps with a different schema — parallel fan-out with a shared
  recipe (the `engine-data-converter` skill).
- **Systems touch different files** (§5): R lives in `rig/`+`anim/`, G in
  `physics.ts`+`entities/`, M in `session/`/`camera/`/`audio/`… — low collision
  surface, so parallel agents rarely fight over the same file.

### 10.2 Orchestration shape (per phase)

Use a **scout → fan-out → verify → integrate** loop, not one mega-agent:

1. **Scout (inline or 1 agent).** Read the relevant files, produce the exact
   work-list + interfaces the parallel agents will implement against. (Cheap;
   prevents the fan-out from diverging on shared types.)
2. **Fan-out (parallel sub-agents).** One agent per independent unit —
   e.g. `ik.ts`, `physics.ts` (spring), `anim/sample.ts` can be three concurrent
   agents, each writing its module **+ its tests**, each running
   `engine-verify` on just its slice. Agents that mutate files in parallel run in
   **worktree isolation** to avoid conflicts.
3. **Adversarial verify (parallel).** For anything subtle (collision, the S3
   refactor, IK math), a **separate** clean-room agent that only tries to *break*
   the result — the repo already ships `behavior-verifier`, `verify-codex`,
   `verify-gemini` for exactly this. A refactor isn't "done" until an independent
   agent that fails differently confirms it preserves behavior.
4. **Integrate (inline).** You/the main loop wire the verified modules into the
   sim and UI, run the full `npm run build && npm test && npm run lint`, and drive
   the app. Integration stays single-threaded — it's where cross-module decisions
   live.

### 10.3 Concrete agent assignments per phase

| Phase | Scout | Parallel fan-out agents | Verify |
|---|---|---|---|
| **S0 skills** | — | 1 agent per skill (independent files) | human read |
| **S1/S2 substrate** | 1 | Worker proxy · `perceive()` bundle · Zod schemas (3 agents) | build + a live AI call |
| **S3 N-entity refactor** | 1 | *single agent* (load-bearing; not parallelized) | **`behavior-verifier` + `verify-codex`** — mandatory |
| **R1 rig core** | 1 | `types.ts` · `evaluate.ts`+tests · rig `StateNode`+handles UI (3) | tests + drive editor |
| **R3 IK+physics** | 1 | `ik.ts`+tests · `physics.ts`(spring)+tests (2, pure, parallel) | adversarial math agent |
| **R4/R5/G2e/G4 converters** | 1 | one agent per converter, all following `engine-data-converter` | schema-validation agent |
| **G1 abilities** | 1 | one agent per ability pack (dash · wall-jump · flutter…) | play-test each |
| **G3 props** | 1 | one agent per prop (ladder · portal · mover…) — different roles | play-test each |
| **M1/M5/M7/M8** | 1 | one agent per system (`session` · `camera` · `audio` · `hud`) | integrate + drive |

**Rules for the orchestration (encode in the skills):**
- Every fan-out agent **must** end on a green `engine-verify` for its slice, and
  return *what it changed + test output*, not a narrative.
- **Never parallelize edits to `engine.ts`** — it's the one hot file; serialize
  anything touching the loop, and gate the S3 refactor behind adversarial verify.
- Pure modules (`ik`, `physics`, `sample`, `step`) are the **safest** to
  parallelize — no shared state, tests prove correctness. Start fan-out there.
- UI agents follow `tldraw-v5-native-ui`; runtime agents follow
  `engine-runtime-conventions` — so parallel work stays consistent without a
  human re-checking each PR against the same rules.

### 10.4 Sequencing with orchestration

`S0 (skills, parallel) → S1/S2 (parallel) → S3 (solo + adversarial) →` then the
three streams (R, G, M) run as **parallel per-phase fan-outs**, each gated by its
verify column, integrated single-threaded between phases. The main loop stays the
integrator and decision-maker; sub-agents do the bounded, verifiable building.

---

## C. Reference architecture (primary-source synthesis)

*(Unchanged from the prior plan — the rigging research. Synthesized from Spine
`spine-runtimes@4.2`, DragonBones, Live2D Cubism, Rive `rive-runtime`, with glTF
2.0 as the neutral skinning reference. Three load-bearing patterns appear
independently in multiple systems, which is why they anchor §3: (a) analytic
law-of-cosines two-bone IK; (b) one dependency-sorted update cache interleaving
bones + constraints; (c) CPU linear-blend skinning via `worldTransform ×
inverseBind`.)*

### C1. Two paradigms
- **Bone-skinning** (Spine, DragonBones, Rive): bone tree + local transforms; art
  attaches rigidly or via per-vertex multi-bone weights; animation drives bones;
  IK solves chains. **← what §3 builds.**
- **Parameter-deformer** (Live2D): named float params drive deformers; no bones,
  no per-vertex weights, no IK. Noted for completeness; not our model.
- **Rive is the closest match to a tldraw host** — it skins *vector path control
  points*, not bitmaps.

### C2. Bone model
Strict tree, single root; per-bone local translate/rotate/scale + **shear**
(squash & stretch); `length` places the child origin at the tip. World = 2D
affine, child = parentWorld × local. **Setup pose immutable; animated pose
separate.** Per-component inheritance masking (Spine `Inherit` enum).

### C3. Skinning
Both **rigid attachment** (one shape/one bone — cheap, no tearing) and **weighted
mesh/path skinning** (each vertex ≤4 `(boneIndex, weight)`, normalized, stored in
each bone's bind space, each bone carrying an inverse bind matrix). Rive's model
— weighting **Bézier control points *and* handles** (handles share weights when
collinear) — is the one to copy for a vector host. Slots decouple "which art
shows" from the bone.

### C4. IK
**Analytic**: one-bone (rotate-toward) + **two-bone via law of cosines**; chains
>2 iterate the two-bone solve up an FK chain (Rive). Fields: FK↔IK mix/strength,
bendDirection, softness (anti-snap near full extension). IK writes *local*
transforms; FK re-derives world. Need **both** FK (intuitive authoring) and IK
(foot-plant, reaching).

### C5. Constraints beyond IK
Ordered list, single global `order`, evaluated after bones read / before children
written. **Transform** (copy target channels, per-channel mix). **Path** (bones
along a path). **Physics/spring** (Spine 4.2 — inertia sim for hair/cloth/jiggle;
the one feature DragonBones & Rive lack — do not skip for secondary motion).

### C6. Runtime evaluation order
A **single dependency-sorted update cache**, not fixed phases (Spine
`_updateCache`, Rive `DependencySorter`). Canonical: (1) sample → local TRS;
(2) blend/layer/additive; (3) IK + constraints modify locals; (4) world top-down
= FK; (5) skin matrices `S = world × inverseBind`; (6) deform. IK writes locals
before/within the world pass; world-reading constraints sit within the walk.

### C7. Animation / timeline model
Per-property keyframe timelines; interp stepped / linear / cubic-Bézier
(universal). Mixing: numbered tracks (lower applies first, higher overrides),
per-track alpha, additive, per-layer bone masks. Crossfade via per-clip fade
durations. **Rive's state machine** is the modern orchestration layer, adopted.

### C8. Serialization
Spine/DragonBones = named nested JSON + compact binary. Rive = flat binary Core
objects. **For this plan: named JSON in `meta`** (diffable, AI-friendly, fits
tldraw's reactive store); pool bulk numeric arrays if size bites.

### C9. Browser skinning reality (the crux)
Only **WebGL** has a vertex shader; **SVG/DOM & Canvas 2D → CPU skinning**. For a
vector host: SVG rigid `<g transform>` = cut-out puppet (tears); real skinning =
CPU-skin path points + rewrite `d` each frame (Pose Animator: LBS on SVG anchors,
handles skinned separately). Canvas 2D — CPU-transform then draw; faster for many
points, loses retained-mode hit-testing. WebGL — vertex-shader skinning; reserve
for when CPU/DOM limits are hit. **Rive & Spine both CPU-skin control points** and
advise pruning weights / capping bones-per-vertex / preferring rigid attachments.
**→ Tier A/B (rigid, native) first; Tier C (custom-shape `getSvgPathData` rewrite)
for true skinning, weight-capped.**

*Research caveats: Spine's public JSON doc lags its 4.2 runtime; Live2D `.moc3`
byte layout isn't publicly specified; Rive's exact `advanceInternal` body was
reconstructed from the confirmed `DependencySorter`/`ComponentDirt` architecture;
glTF formulas from the Khronos tutorial/reference guide.*
