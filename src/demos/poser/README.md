# Poser

An articulated stick-figure poser built entirely from native tldraw v5 shapes.
Drag any bone to pose the figure; child limbs follow their parent joint (forward
kinematics), so bending the elbow keeps the forearm attached to the upper arm
while letting it swing independently.

## How it works

- **`poser-bone` shape** ([shapes/](shapes/)) — one limb segment. Its origin
  `(x, y)` is the *head* (proximal joint); the bone runs `length` px along its
  local +x axis, so the *tail* (distal joint) sits at local `(length, 0)`. The
  native `rotation` prop is the bone's angle, and because the head is the origin,
  rotating swings the tail around the head — the pivot a joint needs. Rendered as
  a rounded capsule with hub dots at each joint; resize/rotate handles are hidden
  (you pose by dragging, not by handles).

- **`bone-joint` binding** ([bindings/](bindings/)) — pins a child bone's head to
  its parent bone's tail. It repositions the child only when the *parent* changes,
  never when the child does, so grabbing a bone to pose it isn't fought by the
  rig; a drag propagates parent→child down the chain one hop at a time.

- **Rig builder** ([rig/buildFigure.ts](rig/buildFigure.ts)) — a small humanoid
  template (pelvis → spine → neck → head, two arms, two legs). Bones are created
  top-down so each parent exists before its children pin to it, and each child's
  starting position is computed from its parent's tail so the figure spawns
  already assembled.

## Posing tools

- **Pose library** ([poses/](poses/)) — a bundled catalog of named poses derived
  offline from the HumanML3D motion dataset (see
  [scripts/buildPoseCatalog.mjs](scripts/buildPoseCatalog.mjs) for the
  263-dim-motion → 22-joint → per-bone-angle decode). A pose stores each posable
  bone's page-space angle plus a `pelvis: {drop, lean}`; applying it rotates the
  bones top-down and **lowers/leans the pelvis** so grounded poses (sitting,
  kneeling) read — the data encodes a sit as a root-height drop, not articulated
  hips. `applyPose(editor, figureId, pose)` targets one figure.

- **Multiple figures** — "Add figure" spawns more. Every bone carries
  `meta.figureId` (its pelvis id), so pose application, IK discovery, and the
  toolbar all group/filter by figure. Bone `name`s repeat across figures; the
  figureId keeps them apart.

- **Context toolbar** ([pose/PoseToolbar.tsx](pose/PoseToolbar.tsx)) — built on
  tldraw's `TldrawUiContextualToolbar`. Select any bone of a figure and a floating
  toolbar appears **above that figure's head** with: a per-figure pose picker, a
  **Move** handle (drags the whole figure by its pelvis root), **Apply rig**, and
  **Show/Hide rig**.

- **Rig a drawing** — draw a figure with the normal tldraw tools, then two ways to
  fit a rig to it:
  - **Rig mode** ([rig/jointMarkers.ts](rig/jointMarkers.ts),
    [pose/RigModeOverlay.tsx](pose/RigModeOverlay.tsx),
    [rig/buildFigureFromJoints.ts](rig/buildFigureFromJoints.ts)) — Mixamo-style.
    "Rig a drawing" drops draggable joint markers with a live preview skeleton,
    **auto-aligned to the drawing** (the default skeleton is fitted to the combined
    bounds of the free shapes, so markers start on the figure rather than at canvas
    center). **Snap to drawing** refines the markers toward the ink (extremity
    anchoring + a radius-limited snap-to-nearest-point, no fragile body-part
    detection). Place the markers, then:
  - **Apply rig** (rig mode) — one click: **builds** a figure whose bone lengths and
    shoulder/hip widths come from the markers (so short drawn legs → short leg bones,
    no distortion), **and attaches** the drawing to it
    ([poses/attachDrawing.ts](poses/attachDrawing.ts),
    [poses/cutStrokeAtJoints.ts](poses/cutStrokeAtJoints.ts), [bindings/](bindings/)).
    A **draw stroke** is **cut at the joints** into per-bone pieces (so a limb drawn
    as one line folds at the elbow/knee when posed); any **other shape** (geo, image…)
    is attached rigidly to its nearest bone. Attachments are `bone-attachment`
    bindings storing each piece's offset in its bone's local frame. (An **Apply rig**
    on the per-figure context toolbar also attaches loose shapes to an existing rig.)
  - **Hide rig** then shows just the posed artwork (bones still exist and pose; only
    their rendering + IK handles are hidden). A "Show rig" button restores them.

## Notes

- Uses a unique `persistenceKey="poser"` and a `.poser-*` CSS prefix so it can't
  collide with other demos in the switcher (see the repo `CLAUDE.md`).
- Everything is native tldraw — no physics, no runtime ML. The pose catalog is a
  bundled JSON (built offline); poses persist in local storage under `poser`.

## Ideas / next steps

- Smarter rig-to-drawing: attach by overlap area rather than centerline distance;
  let the user re-tag a mis-attached shape.
- Save/load named poses; an onion-skin of a reference pose.
- Per-figure color tinting for comparison.
