---
name: engine-data-converter
description: The repeatable five-step recipe for building any "drawing/prompt → game element" converter in the Engine demo (auto-rig, auto-enemy, auto-level, auto-tune, etc). Use whenever you add a new AI-authored or hand-authored game-data tool. Guarantees every converter comes out structurally identical — data model, pure runtime, manual editor first, then AI.
---

# Engine data converter recipe

Every "draw/describe → game element" tool in the Engine (PLAN.md §2) follows the
**same five steps, in this order**. The organizing thesis: **AI authors data; the
deterministic runtime plays data.** Claude emits inspectable JSON; the sim plays
it; the user hand-edits it with the same tools. Follow these steps in order — the
ordering is the point, not an accident.

## The five steps (in order)

### 1. Data model — Zod-schema'd JSON stored in `meta`
Define the typed shape (`Rig`, `EnemyBehavior`, `LevelLayout`, `PhysicsTunables`,
`GameDef`, …) as a **Zod schema in `game/ai/schemas.ts`** and store instances in
a shape's `meta` (diffable, AI-friendly, fits tldraw's store). **Carry a
`version` field on every persisted model** — levels persist in localStorage, so
old docs will carry old schemas; the loader Zod-parses and migrates/defaults
rather than crashing. `schemas.ts` is the single contract shared by the client,
the Worker, and every converter.

### 2. Runtime plays it — pure, editor-free, unit-tested
The sim/evaluator reads that data and acts on it. Keep it **editor-free** and put
it in `game/entities/`, `game/rig/`, `game/anim/`, etc., with a colocated
`*.test.ts` — exactly as `physics.ts` is kept editor-free and tested by
`physics.test.ts`. This is what lets an agent build and prove the core green
without touching UI. (See the `engine-runtime-conventions` skill.)

### 3. Manual editor — ships BEFORE the AI
Build a hand-authoring surface for the data *first*: a sectioned Tray entry, a
contextual-toolbar action, or a `StateNode`-tool overlay (see the
`tldraw-v5-native-ui` skill). This is the AI's **safety net** — imperfect AI
output is fixed with the same tools, so there are no dead ends. **Do not build the
AI converter before its manual editor exists.**

### 4. AI converter — `perceive()` + prompt + schema + retry
Add `game/ai/auto<Thing>.ts`: a thin wrapper over `game/ai/client.ts`. It calls
`perceive()` (§1.2 — the shared PNG + geometry-by-ID + SVG bundle) when the tool
reads a drawing, adds a prompt and the step-1 Zod schema, and gets back validated
data. Then:
- **Validate structurally** beyond Zod: referenced shape/leaf IDs actually exist,
  trees are acyclic, roots resolve.
- **Open the manual editor** on the result so the user tweaks it. The editor is
  the safety net; the AI never writes final data the user can't reach.
- Reach the AI through the **one ✨ Generate door** (`HelperButtons` → `Dialogs`),
  not a per-converter button.

### 5. Document it — a section in engine/CLAUDE.md
Add a short section to [engine/CLAUDE.md](../../CLAUDE.md) describing the data
model, where the runtime plays it, and the editor entry point — same density as
the existing sections.

## Non-negotiables

- **Manual before AI** (step 3 before step 4). Always.
- **The schema is the contract** — client, Worker, and converter all import from
  `game/ai/schemas.ts`. Don't redefine a shape inline.
- **AI output is non-deterministic; the runtime is not.** The same prompt yields
  different JSON each call — that's correct (it's authoring). Never cache or diff
  on the assumption a prompt reproduces its JSON; treat every generation as a
  fresh editable artifact the user then owns.
- **Every generation is editable data**, so "generate OR hand-edit" falls out for
  free — that's the whole design. If a converter produces something the user can't
  open in an editor, it's built wrong.

## What "done" looks like

A converter is done when: (1) its schema is in `schemas.ts` with a `version`;
(2) a pure, tested runtime plays its data; (3) a user can author the data by hand;
(4) the AI produces the same data, validates it, and opens the editor; (5)
CLAUDE.md documents it; and (6) `engine-verify` is green. Anything less is a
partial converter — say so explicitly rather than claiming done.
