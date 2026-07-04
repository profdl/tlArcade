# CLAUDE.md — Face Mask

> **This is one prototype in the [tlArcade](../../../CLAUDE.md) platform**,
> mounted at `/demos/face-mask`. It has no `package.json`/build of its own —
> `npm run dev`/`build`/`test`/`lint` all run from the **repo root**.

## What this is

A custom `face-video` shape streams the webcam and runs
[MediaPipe FaceLandmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker)
on it (`faceTracking/faceLandmarker.ts`). Other native tldraw shapes (a
draw stroke, an arrow, any shape) can be **pinned to a named landmark**
(eye, nose, mouth corner, etc.) via a custom `FaceFeatureBinding`
(`bindings/`), so the shape tracks that point frame-to-frame — following
position, head-roll rotation, and (for mouth landmarks) how open/wide the
mouth is.

## Architecture

- `shapes/FaceVideoShapeUtil.tsx` — the `face-video` shape: owns the
  `<video>` element and getUserMedia lifecycle, runs the landmarker loop,
  and exposes each frame's resolved landmark positions for bindings to read.
- `faceTracking/faceLandmarker.ts` + `faceTracking/landmarks.ts` — lazily
  loads a single shared `FaceLandmarker` instance (video-mode, GPU delegate);
  `landmarks.ts` resolves MediaPipe's raw index-based points into named
  landmarks and derives expression ratios (`mouthOpenRatio`,
  `mouthWidthRatio`).
- `bindings/FaceFeatureBindingUtil.ts` + `faceFeatureBinding.ts` — the
  binding type. At bind time it captures the shape's offset from the
  landmark, its rotation, and (for mouth landmarks) its base size, all as
  fractions/deltas — so later frames scale/rotate/reposition the shape
  *relative* to that captured state rather than to the tracker's absolute
  calibration. See the comment on `FaceFeatureBindingProps` for the exact
  fields.
- `snapToFace.ts` + `dragSnapPreview.ts` — the drop-to-pin UX: while
  dragging a shape near a landmark, `dragSnapCandidateAtom` drives a live
  preview; releasing near one creates the binding (`trySnapSelectedShapesToFace`).
  `setupDrawShapeSnapping` does the same for freshly-drawn shapes.
  `shapes/ArrowFaceFeatureShapeUtil.ts` is a small arrow variant used for
  the preview affordance.
- `addDefaultFaceFeatures.ts` — seeds a starter set of pinned shapes when a
  `face-video` shape is first created (see `App.tsx`'s `addFaceVideo`).

## Gotchas

- The webcam and MediaPipe model both require a real camera + network
  access to fetch the WASM runtime/model (`faceTracking/faceLandmarker.ts`'s
  `WASM_BASE`/`MODEL_URL`, both CDN-hosted) — this can't be exercised in a
  headless/no-camera preview environment.
- `App.tsx`'s mount guard (`every((s) => s.type !== 'face-video')`) exists
  specifically to survive React StrictMode's double-invoked mount effect
  without creating two face-video shapes.
