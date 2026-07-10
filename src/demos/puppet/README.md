# Puppet

A VTuber-style character rig on the tldraw canvas — the tlArcade take on
VTube Studio / Live2D Cubism.

Live webcam **face tracking** (MediaPipe FaceLandmarker with blendshapes +
head-pose matrix) drives a layered puppet through a single normalized
parameter set (`rig/params.ts`). Manual controls (pointer, keyboard,
on-canvas sliders) write into the same params, so tracking and hand-authoring
share one contract and the renderer never talks to a tracker directly.

**Bring your own art.** The rig is metadata, not art: any shape you draw —
draw strokes, geo shapes, arrows, images — becomes a puppet feature by being
tagged with a role (`eyeL`, `mouth`, `hairFront`, …) in its `meta`. There is
no built-in eye or mouth shape; a feature is whatever you assigned that role
to. Redraw or swap a feature's art any time and the rig picks it up next
frame. See [PLAN.md](./PLAN.md) → "Core principle: bring your own art".

## Status

Scaffold. The webcam → tracker → params → render loop works end-to-end against
a placeholder SVG face (`PuppetStage.tsx`). See [PLAN.md](./PLAN.md) for the
full build (layered tldraw-shape rig, parameter binding, expressions,
physics/idle motion, manual control modes, record/playback, and export to a
generative video model via fal.ai / Seedance-2).

## Files

- `tracking/faceTracker.ts` — video-mode FaceLandmarker with `outputFaceBlendshapes`
  and `outputFacialTransformationMatrixes` on; returns 52 ARKit blendshapes + decomposed head pose.
- `rig/params.ts` — `PuppetParams` (the control surface), `paramsFromFace`, and per-field smoothing.
- `PuppetStage.tsx` — placeholder puppet + the live tracking loop.
- `App.tsx` — mounts tldraw + the puppet overlay.
