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

## Notes

- Uses a unique `persistenceKey="poser"` and a `.poser-*` CSS prefix so it can't
  collide with other demos in the switcher (see the repo `CLAUDE.md`).
- Everything is native tldraw — no physics, no external tracking. Poses persist
  in local storage under the `poser` key.

## Ideas / next steps

- Pin-to-target IK (drag a hand and solve the arm chain), vs. the current FK.
- Save/load named poses; an onion-skin of a reference pose.
- A second figure and per-figure color tinting for comparison.
