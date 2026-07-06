# Engine — Professional Rigging, Animation & AI Generation Plan

Design doc for a **state-of-the-art 2D skeletal rig + animation system** with AI
authoring, built on tldraw v5. **Nothing here is built yet.** It is grounded in
the demo's current code ([engine.ts](game/engine.ts), [player.ts](game/player.ts),
[roles.ts](game/roles.ts), [collision.ts](game/collision.ts)), real tldraw v5
APIs (confirmed against [docs/tldraw/](../../../docs/tldraw/)), and a synthesized
reference architecture from the four leading production 2D skeletal systems —
**Esoteric Spine, DragonBones, Live2D Cubism, and Rive** (see §A "Reference
architecture" for the primary-source synthesis).

> **Bar:** not "a bigger toy." The target is the professional-grade concept set
> and evaluation pipeline these systems share — strict bone tree with rest/pose
> separation, weighted skinning, analytic IK, ordered constraints (incl.
> physics/spring), layered timeline mixing / state machine — adapted honestly to
> a vector-shape host and to AI authoring.

---

## 0. Guiding principles (decided)

1. **AI authors data; the runtime plays data.** Claude calls take seconds; the
   sim runs at fixed-dt on rAF. Claude never touches the loop — it emits JSON
   (rig, skin weights, animation clips, level layout) the deterministic runtime
   plays back. Consequence: **every AI output is inspectable, editable data**,
   so "generate OR hand-edit" falls out for free.
2. **Manual editing is the AI's safety net.** Manual rig/skin/clip editors ship
   *before* their AI counterparts. AI populates the same structures; imperfect
   output is fixed with the same tools. No dead ends.
3. **Tiered rendering, not one big bet (§2).** Rigid-attachment posing on native
   shapes ships first and is genuinely useful; **weighted mesh skinning** (the
   truly pro part) is a later tier that requires a custom shape. Each tier is
   shippable; we don't gate the whole system on the hardest piece.
4. **Setup pose ≠ animated pose.** Universal across all four reference systems:
   an immutable rig (rest transforms, bind matrices, weights) is stored once;
   per-frame the runtime holds a *separate* live pose. We mirror this split —
   rig in `meta`, live pose in runtime state.
5. **One dependency-sorted evaluation cache, not fixed phases (§A6).** Bones and
   constraints are interleaved in a single dependency order (Spine `_updateCache`,
   Rive `DependencySorter`) so a constraint runs after the bones it reads and
   before the children of bones it writes.

### Decided architecture (from brainstorm)

| Decision | Choice |
|---|---|
| API transport | **Cloudflare Worker proxy** — `/api/engine/*`; key server-side |
| Rig depth | **Full pro skeleton** — bone tree + IK + ordered constraints + skinning |
| First milestone | **Manual rig editor first** (rigid tier), AI layered on after |
| Auto-rig inputs | **PNG (perception) + leaf geometry by shape ID (mapping) + SVG (precision)** |

---

## 1. The rig data model (`game/rig/` — new)

Mirrors the **synthesized reference data types** (§A "reference architecture"),
trimmed to what a 2D platformer character needs. Stored in `meta.rig` on the
player group as JSON — serializes to localStorage for free, survives undo as an
authoring edit, never widens the global `TLGlobalShapePropsMap` union.

```ts
// All transforms are 2D affine (Mat2D: a,b,c,d,tx,ty) — Spine/Rive model a bone's
// world transform as a 2×2 basis + translation, NOT a 4×4. Coordinates are
// PLAYER-LOCAL (relative to the player group's bounds top-left at bind time), so
// the rig is translation-invariant — the runtime adds (px,py) at play time exactly
// like it does for playerSamples today.

// ---- SETUP POSE (immutable rig) ----
interface Bone {
  id: string
  parentId: string | null            // strict tree, single root
  // rest local transform
  x: number; y: number
  rotation: number                    // radians
  scaleX: number; scaleY: number
  shearX: number; shearY: number      // shear enables squash & stretch (Spine/DragonBones)
  length: number                      // places child origin at the tip; used by IK/skinning
  inherit: InheritMode                // Normal | OnlyTranslation | NoRotation | NoScale (Spine enum)
}

interface Slot {                       // decouples "which art shows" from the bone
  id: string
  boneId: string
  drawOrder: number
  attachment: string                   // active attachment name in the current skin
}

// Art attaches to a slot as ONE of:
type Attachment =
  | { kind: 'rigid'; leafId: TLShapeId }                 // Tier A: one tldraw shape on one bone
  | { kind: 'skinnedPath'; verts: SkinVertex[]; closed: boolean }  // Tier C: weighted mesh

interface SkinVertex {                 // a Bézier control point or handle, weight-skinned
  x: number; y: number                 // position in mesh/bind space
  influences: { boneIndex: number; weight: number }[]   // ≤4, weights normalized to 1
  handleOf?: number                    // if this is a Bézier handle, index of its anchor
}

interface Rig {
  version: 1
  root: string
  bones: Bone[]
  slots: Slot[]
  skins: Record<string, Record<string /*slotId*/, Attachment>>  // 'default' + swappable skins
  constraints: Constraint[]            // ORDERED list (see §1.1)
  bindInverse: Record<string /*boneId*/, Mat2D>  // inverse bind matrix per bone (for skinning)
}
```

### 1.1 Constraints (ordered — evaluated in `order`)

Verified across Spine/DragonBones/Rive: constraints are **ordered data**,
evaluated after the bones they read, before the children of bones they write.

```ts
type Constraint =
  | { kind: 'ik'; order: number; bones: string[]; target: string;
      mix: number; bendDirection: 1 | -1; softness: number }        // analytic 2-bone (law of cosines)
  | { kind: 'transform'; order: number; bones: string[]; target: string;
      mixRotate: number; mixTranslate: number; mixScale: number }   // copy target channels
  | { kind: 'path'; order: number; bones: string[]; targetSlot: string;
      positionMode: 'fixed' | 'percent'; rotateMode: 'tangent' | 'chain' }
  | { kind: 'physics'; order: number; bones: string[];
      inertia: number; strength: number; damping: number;
      mass: number; gravity: number; wind: number; mix: number }    // spring/jiggle (Spine 4.2)
```

**IK is analytic two-bone** (law of cosines) for limbs; chains >2 iterate the
two-bone solve up the chain (Rive's approach) — no CCD/FABRIK needed at 2D
platformer scale. **Physics constraint** is what makes tails/hair/capes feel
alive without keyframing — the one feature Rive/DragonBones lack; Spine 4.2 is
the reference. Both are runtime-only pose modifiers layered *on top* of sampled
clips.

---

## 2. Rendering tiers (the honest fork for a vector host)

The core finding: **only WebGL has a vertex shader; in SVG/DOM & Canvas 2D,
weighted skinning is CPU skinning** — you transform points each frame and
re-emit geometry. tldraw renders vector shapes, so pro-grade smooth joint
bending means CPU-skinning Bézier control points and rewriting path `d` (exactly
what Google's **Pose Animator** and **Rive** do). Native tldraw shapes can't do
per-vertex weighting — a `<g transform>` per part is a rigid cut-out puppet
(joints tear). So we tier it:

| Tier | Render | Deformation | tldraw fit | When |
|---|---|---|---|---|
| **A. Rigid** | native leaf shapes, transformed per frame | none — parts translate/rotate rigidly about their bone joint | **native-first, no custom shape** | ships first; genuinely good for cut-out/paper-puppet characters |
| **B. Rigid + secondary** | native shapes | + physics/spring constraints & IK move whole parts | native-first | adds life (tail swing, foot-plant) without mesh skinning |
| **C. Skinned** | **custom shape** whose `getSvgPathData()` returns a per-frame CPU-skinned path | true weighted LBS on Bézier control points + handles (≤4 bones/vertex) | **custom shape for the player render only** (documented exception to native-first) | the pro tier: smooth bending limbs, no tearing |

**Tier C is a deliberate, isolated exception** to the demo's native-first rule —
and only for the *player's on-screen render*, not the level. The custom shape
holds the skinned path in props; collision still uses the rest outline (below).
Confirmed viable: a custom `ShapeUtil` with `getSvgPathData()` renders an
arbitrary per-frame path ([docs/tldraw](../../../docs/tldraw/) → "Custom shape
geometry"). Cost model is real (Spine: "each vertex computed by the CPU each
frame"; rewriting SVG `d` re-parses the path) — so Tier C caps vertex/bone
counts and prunes weights, exactly as Spine advises.

**Collision stays rigid in every tier.** `playerSamples` remains the merged rest
outline collected at `start()`. Limbs animate visually; the collision body does
not deform per-frame — the standard platformer choice (stable capsule/outline +
cosmetic animation), keeping the sim cheap and matching the demo's existing
"solids captured once" honesty.

---

## 3. Runtime evaluation pipeline (`game/rig/evaluate.ts`)

The canonical per-frame order, synthesized from Spine/Rive/glTF (§A6). Pure,
editor-free, unit-testable (mirrors how [physics.ts](game/physics.ts) is kept
editor-free). The existing `writePlayer()` calls this and writes results to
shapes.

1. **Advance the animation state / state machine** (§4) — inputs → transitions →
   per-layer weights.
2. **Sample + blend timelines → local bone transforms** — per track, blend
   `setup/replace/add` under the layer's bone mask.
3. **Walk the single dependency-sorted cache** (bones + constraints interleaved):
   - bone → world = parentWorld × local (**FK**), respecting `inherit`;
   - constraint (in `order`) → **IK / physics / transform / path** solve here,
     writing back locals; downstream children recompute.
4. **Build skin matrices** `S_i = boneWorld_i × bindInverse_i` (a Mat2D palette).
5. **Deform** — Tier A/B: apply the bone's world transform to its rigid leaf.
   Tier C: LBS each control point `p' = Σ wᵢ·(Sᵢ·p)` (anchors + handles, handles
   sharing weights when collinear) → new path `d`.
6. **Write to canvas** — Tier A/B: `updateShape` x/y/rotation per leaf. Tier C:
   `updateShape` the custom shape's path prop.

No rig present → the current rigid whole-body path runs unchanged (every
existing level keeps working).

---

## 4. Animation model (`game/anim/` — new)

Per-property keyframe timelines with per-keyframe interpolation
(**stepped / linear / cubic-Bézier** — universal across all four systems), plus
a **layered mixing** model and an optional **state machine** (Rive's signature).

```ts
interface Keyframe { t: number; value: number; interp: Interp } // Interp: stepped|linear|{cubic:[cx1,cy1,cx2,cy2]}
interface Timeline { target: BoneChannel; keys: Keyframe[] }    // e.g. bone 'arm' rotation
interface Clip { name: string; duration: number; loop: boolean; timelines: Timeline[] }

interface Track {                    // numbered; lower applies first, higher overrides
  clip: string; alpha: number; mixBlend: 'replace' | 'add'
  boneMask?: string[]                // upper-body layer over a walk, etc.
}
```

**State machine (adopted from Rive):** layers (mix simultaneously), states
(single clip / 1D-blend / additive-blend), transitions gated by input conditions
with exit-time + cross-mix duration, inputs (bool / number / trigger). It maps
**directly onto the existing sim state**: `grounded`, `|vx|` (idle→walk→run 1D
blend), `vy` sign (jump/fall), later `climbing` (§7) — all already tracked in
[engine.ts](game/engine.ts) `step()`. The state machine picks/blends clips; §3
evaluates them.

Standard clip set: `idle, walk, run, jump, fall, land, climb`.

---

## 5. Phase plan (each phase shippable)

**Phase 0 — API plumbing.** `worker/engine.ts` at `/api/engine/*` (Worker
already routes `/api/*` first). Proxies Anthropic; **key is a Worker secret,
never in the browser**. `game/ai/client.ts`: typed calls, **Zod-validate
Claude's JSON**, one **retry-on-invalid-JSON** loop. Unblocks every AI feature.

**Phase 1 — Rig model + manual editor, Tier A (rigid).** `game/rig/` types +
`evaluate.ts` (FK + rigid deform) + tests. Rig-edit mode as an
`InFrontOfTheCanvas` overlay (same layer as the [Tray](render/Tray.tsx) and
[PlayerToolbar](render/PlayerToolbar.tsx)): draggable joint handles, bones as
lines, assign leaf shapes to slots, scrub-preview. Write-through to `meta.rig`
(normal history — undoable, like `markAsPlayer`). **The keystone; no AI.**

**Phase 2 — Manual animation, Tier A.** `game/anim/` timelines + evaluator +
state machine + state→clip selection wired to the sim. Timeline UI reuses the
Phase-1 overlay with a time axis. Ship: hand-authored walk/idle/jump auto-
selected from sim state.

**Phase 3 — IK + physics constraints (Tier B).** Analytic two-bone IK
(foot-plant, reach) + spring/physics constraint (tail/hair/cape). Slots into the
§3 dependency cache. Constraint-editing UI in the overlay. Still native shapes.

**Phase 4 — Auto-rig via Claude vision.** `exportRigContext` bundle: **PNG**
(`editor.toImageDataUrl([playerId], {format:'png', scale:2})` — what Claude
sees) + **leaf geometry keyed by shape ID** (`outlineSamples`/bounds — the
ground truth Claude maps onto, returning real IDs → exact snapping) + **SVG**
(`getSvgString` — precision tiebreaker). Claude returns a `Rig` (bones, slots,
rigid attachments by leaf ID, suggested IK/physics). Zod-validate (leaf IDs
exist, tree acyclic, root resolves) → **opens the Phase-1 editor** to tweak. The
editor is the safety net. General graph → handles any character / any limb count.

**Phase 5 — Auto-animate via Claude.** Given a rig + labeled rest-pose PNG +
target action, Claude returns `Clip`s in the exact §4 format (keyframed bone
angles, cubic ease). Batch the whole set in one call. Lands in the Phase-2
timeline editor — generate → tweak → ship.

**Phase 6 — Tier C (weighted skinning).** Custom `SkinnedPlayerShape`
(`getSvgPathData()` = per-frame CPU-skinned path). Weight-painting UI (assign
control points/handles to bones, ≤4 influences, normalized). Auto-weight via
Claude vision (or a distance-to-bone heuristic à la Pose Animator as a non-AI
fallback). The pro tier: smooth bending, no tearing. Isolated, opt-in per player.

**Phase 7 — New elements + AI level-gen** (largely parallel — touches
[roles.ts](game/roles.ts), not the rig). Ladders (new `climb` sim state:
overlap + up/down disables gravity, drives vy; new `climb` clip), portals
(paired teleport triggers), moving platforms (re-read tagged movers per frame),
springs, checkpoints, enemies. Generalize the player's existing "`meta.role`
marker wins over color" escape hatch ([engine.ts](game/engine.ts) → `roleOf`)
into the primary role mechanism for new roles (color stays the quick-draw path
for the original five — distinct colors run out). AI level-gen: Claude →
`Array<{role,x,y,w,h,meta?}>` → `createShape`. Editable immediately.

**Build order:** 0 → 1 → 2 → (3 ∥ 4) → 5 → 6, with 7 parallel to 1–6.
Phases 1–2 give a working animated cut-out player with zero AI. Phases 4–5 add
the "wow." Phase 6 reaches true professional skinning. Phase 3 & 7 deepen.

---

## 6. File layout (all new, under `src/demos/engine/`)

```
game/
  rig/
    types.ts        # Bone, Slot, Attachment, SkinVertex, Rig, Constraint, Mat2D
    evaluate.ts     # dependency-sorted cache + FK + constraint solve + skinning (pure)
    ik.ts           # analytic two-bone (law of cosines) + chain iteration
    physics.ts      # spring/jiggle constraint solver
    skin.ts         # CPU LBS of control points + handles (Tier C)
    evaluate.test.ts, ik.test.ts, physics.test.ts, skin.test.ts
  anim/
    types.ts        # Keyframe, Timeline, Clip, Track, StateMachine
    sample.ts       # keyframe interpolation + track blending (pure)
    machine.ts      # state machine advance + sim-state → clip selection
    sample.test.ts, machine.test.ts
  ai/
    client.ts       # Worker-proxied Anthropic client + Zod validation + retry
    schemas.ts      # Zod: Rig, Clip[], LevelLayout (shared client/worker)
    autoRig.ts autoAnimate.ts autoWeight.ts levelGen.ts
  export.ts         # exportRigContext (PNG + leaf geometry + SVG) — shared by auto-rig/animate/weight
shapes/
  SkinnedPlayerShape.tsx   # Tier C custom ShapeUtil (getSvgPathData per frame)
render/
  RigEditor.tsx     # InFrontOfTheCanvas overlay: joints/bones/slots/constraints/scrub
  Timeline.tsx      # clip keyframe timeline
  WeightPaint.tsx   # Tier C weight painting
worker/
  engine.ts         # /api/engine/* Anthropic proxy (key server-side)
```

Engine's [CLAUDE.md](CLAUDE.md) gets a section per shipped phase (rig model, the
rendering tiers & the Tier-C native-first exception, the rigid-collision-vs-
posed-visual split, the AI-authors-data boundary, the evaluation order).

---

## 7. Open questions to settle before Phase 1

- **Rig storage size.** A skinned rig (weights per control point) in `meta` grows
  the localStorage doc. Fine for a prototype; note as a limit. If it bloats,
  consider a compact typed-array encoding (DragonBones/Rive both pool numeric
  arrays) or move rigs to the Worker/R2.
- **Ladder collision on climb.** Disable only gravity (player can still stand on
  platforms mid-climb) vs. disable solid collision too. Leaning: gravity only.
- **Tier C collision.** Confirm we keep collision on the *rest* outline even when
  the visual mesh deforms (yes — per §2), and document the visual/collision
  divergence as intentional.
- **State machine vs. simple selector.** Phase 2 can ship with a minimal
  sim-state→clip selector and grow into the full Rive-style state machine in a
  later pass, to de-risk Phase 2.

---

## A. Reference architecture (primary-source synthesis)

Synthesized from **Spine** (esotericsoftware.com + `spine-runtimes@4.2`),
**DragonBones** (format spec + runtimes), **Live2D Cubism** (docs.live2d.com +
CubismSpecs), **Rive** (`rive-app/rive-runtime` C++ + help.rive.app), with glTF
2.0 as the neutral skinning reference. Three load-bearing patterns appear
*independently* in multiple systems' source, which is why they anchor this plan:
(a) **analytic law-of-cosines two-bone IK** (Spine, DragonBones, Rive — none
ship generic CCD/FABRIK); (b) **one dependency-sorted update cache** interleaving
bones + constraints (Spine `_updateCache`, Rive `DependencySorter`/`m_GraphOrder`);
(c) **CPU linear-blend skinning** via `worldTransform × inverseBind` (Spine,
Rive, glTF, Pose Animator).

### A1. Two paradigms (framing)
- **Bone-skinning** (Spine, DragonBones, Rive): bone tree + local transforms; art
  attaches rigidly or via per-vertex multi-bone weights; animation drives bone
  transforms; IK solves chains. **← what this plan builds.**
- **Parameter-deformer** (Live2D): named float parameters drive a hierarchy of
  deformers (rotation = rigid, warp = FFD Bézier cage); no bones, no per-vertex
  weights, no IK; each parameter keyform stores full deformed geometry and blends
  snapshots. (Noted for completeness; not our model — a bone rig suits a
  platformer and AI generation better.)
- **Rive is the closest match to a tldraw host** — it skins *vector path control
  points*, not bitmaps.

### A2. Bone model
Strict tree, single root; per-bone local transform of translate/rotate/scale +
**shear** (Spine/DragonBones — enables squash & stretch); `length` places the
child origin at the tip (Rive: a non-root bone is *just* length + rotation).
World transform = a **2D affine** (2×2 basis + translation), child = parentWorld
× local. **Setup pose is immutable; the animated pose is separate runtime state**
(Spine also keeps an *applied* transform because constraints mutate world after
FK). Per-component **inheritance masking** (Spine's `Inherit` enum: Normal /
OnlyTranslation / NoRotation / NoScale…).

### A3. Skinning
Support both **rigid attachment** (one shape on one bone — cheap, no tearing) and
**weighted mesh/path skinning** (each vertex ≤4 `(boneIndex, weight)` influences,
weights normalized to 1, vertex stored in each influencing bone's *bind space*,
each bone carrying an **inverse bind matrix**). Rive's model — weighting **Bézier
control points *and their handles*** (handles share weights when collinear for
smooth curves) — is the one to copy for a vector host. Slots decouple "which art
shows" from the bone (skin swapping, draw-order animation).

### A4. IK
**Analytic**, not iterative-generic: one-bone (rotate-toward) + **two-bone via
law of cosines**; chains >2 iterate the two-bone solve up an FK chain (Rive).
Shared fields: FK↔IK **mix/strength**, **bendDirection**, **softness** (anti-snap
near full extension), optional compress/stretch (Spine). IK writes *local*
transforms; FK then re-derives world. **Need both FK and IK:** FK is intuitive
top-down authoring; IK is "put the hand/foot *here*" (foot-planting, reaching).

### A5. Constraints beyond IK
Ordered list, single global `order`, evaluated after bones read / before children
written. **Transform** (copy target rotate/translate/scale/shear, per-channel
mix). **Path** (bones distributed along a path, position/spacing/rotate modes).
**Physics/spring** (Spine 4.2 — runtime inertia sim for hair/cloth/jiggle:
inertia/strength/damping/mass/wind/gravity/mix; **the one feature DragonBones &
Rive lack** — do not skip it for secondary motion). Live2D's alternative is a
param→param pendulum system.

### A6. Runtime evaluation order
A **single dependency-sorted update cache**, not fixed phases (Spine
`_updateCache`, Rive dirt-flag `DependencySorter`). Engine-agnostic canonical
order: (1) sample animation → local TRS per joint; (2) blend/layer/additive
(still local); (3) **IK + constraints modify locals**; (4) **compute world
transforms top-down = FK**; (5) build skin matrices `S = world × inverseBind`;
(6) deform vertices. IK sits *before/within* the world pass (writes locals);
world-reading constraints sit *within* the sorted walk.

### A7. Animation / timeline model
Per-property keyframe timelines; per-keyframe interp **stepped / linear /
cubic-Bézier** (universal). Mixing: **numbered tracks/layers** (lower applies
first, higher overrides), per-track alpha, **additive** blend mode, per-layer
**bone masks** (upper-body aim over a walk). Crossfade via per-clip fade
durations. **Rive's state machine** (layers, single/1D-blend/additive states,
condition-gated transitions with exit-time + cross-mix, bool/number/trigger
inputs) is the modern orchestration layer over raw crossfade — adopted here.

### A8. Serialization
Spine/DragonBones = **named nested JSON** (diffable, authoring-friendly) + a
compact binary variant with pooled numeric arrays. Rive = **flat binary Core
objects** (reflection: numeric type/property keys, ToC for forward-compat, tree
from integer parent indices) — schema-agnostic, version-tolerant, not
human-readable. **For this plan: named JSON in `meta`** (diffable, AI-friendly,
fits tldraw's reactive store); pool bulk numeric arrays (weights/keys) if size
bites (see §7).

### A9. Browser skinning reality (the crux)
Only **WebGL** has a vertex shader; **SVG/DOM & Canvas 2D → CPU skinning** (CPU-
transform points each frame, re-emit geometry). For a vector host:
- **SVG** — rigid `<g transform>` = cut-out puppet (tears). Real skinning =
  CPU-skin path points + **rewrite `d` each frame** (Pose Animator: LBS on SVG
  anchors, handles skinned separately, ~90 keypoints/78 bones). Cost: DOM
  re-parse/re-tessellate per frame; fine for tens–low-hundreds of anchors.
- **Canvas 2D** — CPU-transform then draw; faster than SVG for many points (no
  DOM re-parse), loses retained-mode hit-testing.
- **WebGL** — vertex-shader skinning, bone matrices as a uniform palette (2×3 for
  2D), joint indices/weights as attributes; requires tessellating paths to
  triangles each frame. Reserve for when CPU/DOM limits are hit.
- **Rive & Spine both CPU-skin control points**; Spine states the cost model
  ("each vertex computed by the CPU each frame", ×bones/vertex) and advises
  pruning weights, capping bones/vertex, preferring rigid attachments where no
  deformation is needed. **→ Our Tier A/B (rigid, native shapes) first; Tier C
  (custom-shape `getSvgPathData` rewrite) for true skinning, weight-capped.**

*Research caveats: Spine's public JSON doc lags its 4.2 runtime (4.2 source field
names treated as authoritative); Live2D `.moc3` byte layout isn't publicly
specified; Rive's exact `Artboard::advanceInternal` body was reconstructed from
the confirmed `DependencySorter`/`ComponentDirt` architecture after GitHub
rate-limited raw fetches; glTF formulas came from the Khronos tutorial/reference
guide (spec registry 403).*
