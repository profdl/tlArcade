# Puppet — build plan

The most robust VTuber-style rig we can build on tldraw: everything VTube
Studio offers, plus the things a canvas engine makes uniquely easy.

## Guiding architecture

**One parameter set is the whole contract.** Every input writes into
`PuppetParams`; the art layer only ever reads params. This is the single most
important decision — it lets tracking, pointer, keyboard, sliders, physics,
and recorded/animated tracks all coexist and blend, exactly like VTube
Studio's "input → parameter → mesh deformer" pipeline.

```
inputs ──► param sources ──► blend/smooth ──► PuppetParams ──► rig art
 webcam      face→params        priority         (flat bag)      layered
 pointer     pointer→params     + easing                         tldraw shapes
 keyboard    hotkey presets     + physics
 timeline    keyframe eval
```

## Parameters (superset of VTube Studio)

Already stubbed in `rig/params.ts`; expand to the full list:

- **Head**: pitch, yaw, roll, plus head position X/Y/Z (lean toward/away).
- **Body**: lean, bob (breathing), sway, follow-lag from head.
- **Eyes**: openL/R, browL/R, gaze X/Y, pupil dilate, squint, wink.
- **Mouth**: open (jaw), smile/frown, wide (vowel), pucker, tongue.
- **Cheeks**: puff, blush intensity.
- **Extras VTube Studio has**: hair/physics-driven params (auto), accessory
  toggles, "hand" params (from optional hand tracking), and arbitrary
  user-defined params bound to any art layer.

## Core principle: bring your own art

**The rig is metadata, never art.** A puppet layer is *any* user-drawn tldraw
shape — a draw stroke, a geo rectangle, an arrow, an image, a group — tagged
with `meta: { puppetRole, puppetBindings, pivot }`. The driver transforms
whatever shapes carry that tag and is totally blind to what they are. So the
default puppet, a doodled potato with dot eyes, and an imported illustration
are the same code path. There is no built-in "eye shape" — an eye is
"whatever the user assigned the `eyeL` role to."

Consequences that shape the whole design:
- **No custom art shapes.** We use tldraw's native draw/geo/image/group shapes
  as-is; the puppet is a `meta` overlay on top of them, not a new shape type.
  (A thin `PuppetShapeUtil` container may still hold the group + pivot, but it
  never owns the art.)
- **Roles are a small open vocabulary** (`head`, `eyeL/R`, `eyelidL/R`,
  `browL/R`, `mouth`, `mouthSwap:<viseme>`, `hairFront`, `body`, `accessory`,
  or a free-form custom role) — a shape opts in by role, and unassigned art on
  the canvas is just ignored.
- **Redraw at any time.** Select a shape, delete it, draw a new one, re-assign
  the role — the rig picks it up next frame. Editing art never breaks the rig.

## Milestones

### M1 — Layered tldraw-shape rig (the "puppet"), art-agnostic
- A puppet is a **set of native tldraw shapes tagged via `meta`** and parented
  under one group/container. Roles as above; a shape's `meta.pivot` (local
  0..1) sets its rotation/scale origin so a hand-drawn ear pivots correctly.
- A **driver** (runs on each param update via `editor.run`, off the render
  loop) reads every `puppetRole`-tagged shape, evaluates its `puppetBindings`
  against `PuppetParams`, and `updateShapes` its x/y/rotation/scale/opacity.
  Draw art, geo art, and images all move identically — the driver only touches
  transform + opacity, which every shape supports.
- **Deform model, cheapest → richest**: (a) affine per-layer (translate /
  rotate / scale / swap by opacity) — covers ~80% of Live2D's look with zero
  mesh math and works on *any* shape; (b) skew + pivot offsets for parallax;
  (c) optional warp-mesh later (M7), which is the only tier that needs special
  art (an image + control grid) rather than arbitrary shapes.
- `rig/binding.ts`: a `role → { param → transform-term }` table
  (`headYaw` drives `head.x + hairFront.x*0.6 …`), seeded with sensible
  defaults per role and editable in-canvas (M6).

### M1.5 — Authoring: assign / re-draw / swap art (promoted from M6, it's core)
- **"Assign role" flow**: select any drawn shape(s) → pick a role from a
  StylePanel/context menu → it's written into `meta` and joins the rig live.
- **Viseme/expression swap-sets**: assign several shapes the same `mouth` role
  with different `mouthSwap:<viseme>` tags; the driver cross-fades opacity by
  `mouthOpen`/`mouthWide`. User draws as many mouth shapes as they like.
- **Re-draw safe**: deleting/redrawing a role's art just re-binds; a
  "wiggle this param" preview lets the user check a binding while drawing.
- Ship one **default puppet built entirely from native shapes** (so it's a
  worked example the user can take apart, not an opaque asset).

### M2 — Webcam tracking (done at scaffold level; harden it)
- Already: blendshapes + head-pose matrix live. Harden: calibration (capture a
  neutral frame, subtract baseline), dead-zones, per-param gain, lost-face
  hold + ease-back, and mirror handling. Add optional smoothing curve UI.

### M3 — Manual control modes (no camera needed)
- **Pointer**: cursor position → head look-at + gaze; drag on the puppet to
  pose directly. **Keyboard**: number keys → expression presets; hold-to-emote.
- These write the same params; a per-source priority/blend so tracking + manual
  compose (e.g. tracking for head, hotkey for a wink).

### M4 — Expressions & hotkeys
- Named expression presets = a partial-param snapshot + blend weight + attack/
  release envelope (VTube Studio "expressions"). Triggerable by key, on-canvas
  button, or timeline. Stack multiple with weights.

### M5 — Idle & physics motion
- Auto breathing (bodyBob sine), blink timer when eyes-open is untracked,
  micro-sway, and **hair/accessory secondary motion** driven by head velocity
  (spring-damper per pinned layer) — the signature Live2D "hair jiggle".
  Reuse the Verlet/spring patterns already in the repo's physics demos.

### M6 — Deeper authoring UX (builds on M1.5)
- Per-binding editor UI: a StylePanel that, for the selected role, exposes its
  `param → transform-term` terms with gain/curve sliders and a live "wiggle
  this param" preview. Save/load a rig (the `meta` bag + bindings) as JSON so
  users can share puppets. This is where Puppet beats a fixed-file Live2D
  model: the whole rig is editable canvas art + data, not an opaque asset.

### M7 — Stretch: import + warp mesh
- The one path that needs specific art rather than arbitrary shapes: import a
  PNG/PSD-ish character, lay a control-mesh grid, per-param vertex offsets →
  true Cubism-style warp (WebGL or a canvas mesh renderer). The params contract
  already supports it; roles map to mesh regions instead of whole shapes.

### M8 — Record & playback
- **Record**: capture the live `PuppetParams` stream to a timeline — an array
  of `{ t, params }` samples (or sparse keyframes) at, say, 30–60 Hz. Recording
  is just tapping the same param bus every source already writes to, so it
  captures webcam performance, hotkeys, idle physics — everything — uniformly.
- **Playback**: a "timeline" param source that evaluates the track at the
  current playhead and writes into the params (interpolating between samples),
  with scrub / loop / speed. Because playback is *just another param source*,
  you can record a base performance and then live-override a wink on top.
- Persist tracks in the tldraw doc (`meta` on a timeline shape) or as exported
  JSON so a recording is shareable/re-editable — never a flattened video only.
- Optional multiplayer later: sync params over the Toolkit Worker+DO so a
  puppet performs live for remote viewers.

### M9 — Export the recording to a real MP4
- Render the recorded track to actual video frames off-screen: step the
  playhead frame-by-frame, draw the deformed rig to a canvas (or rasterize the
  tldraw group per frame), and encode with `MediaRecorder` / `WebCodecs` (or
  stitch via the Worker). This MP4 is both a shareable clip *and* the input
  image/video for M10's generative pass. Also expose a "record the live canvas
  directly" fast path (`canvas.captureStream()` → `MediaRecorder`) for users
  who don't need frame-accurate re-render.

### M10 — Transform the recording via fal.ai (Seedance-2)
- **Goal**: user picks a recording, types a prompt ("anime idol on a neon
  stage, cinematic"), and gets back a new AI-generated video that follows the
  puppet performance.
- **Model**: fal.ai hosts Seedance (ByteDance) at `fal-ai/bytedance/seedance/*`
  — image-to-video (seed the first frame from a rendered puppet frame) and
  text-to-video variants, driven through fal's standard queue API (submit →
  poll `status` → fetch `result` URL). Confirm the exact endpoint id + params
  (duration, resolution, fps, seed image) against fal's docs at build time.
- **Architecture (non-negotiable)**: the **fal API key must never ship in the
  client bundle.** Proxy through the existing Cloudflare Worker
  (`worker/worker.ts`, itty-router, `run_worker_first = ["/api/*"]`):
  - `POST /api/puppet/generate` — client sends the rendered clip/first-frame
    (already storable via the existing R2 upload route + bucket) + prompt +
    options; Worker attaches `FAL_KEY` (Worker secret) and submits to fal's
    queue, returns a job id.
  - `GET /api/puppet/generate/:id` — Worker polls fal and relays status/result
    URL; client shows progress and, when done, drops the result video onto the
    canvas as a tldraw video/asset (reuse `assetUploads.ts` + R2).
  - Keep the M8 params JSON alongside the clip so a generation is reproducible
    and re-runnable with a tweaked prompt.
- No Seedance/fal MCP tool exists in this environment — this is a direct
  REST integration the demo owns, not a tool call.

## Non-obvious repo gotchas (from CLAUDE.md)
- Custom shape types are **global to the TS program** — if `PuppetShapeUtil`
  builds a `TLShapePartial` from a non-literal `type`, cast at the call site.
- Keep any global CSS under a unique prefix (`.pup-*`); a stale lazy stylesheet
  can outlive a route change.
- `persistenceKey="puppet"` is set — keep it unique.
- MediaPipe WASM/model load from a CDN (see `faceTracker.ts`); offline needs
  self-hosting them.
