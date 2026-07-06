---
name: tldraw-v5-native-ui
description: The native-first UI rules for adding surfaces to the Engine demo (and any tldraw v5 UI in this repo). Use whenever you add or change UI around the tldraw canvas — a panel, button, tray entry, dialog, toolbar, HUD, or editor overlay. Keeps every surface in a documented tldraw component slot instead of bolted-on HTML.
---

# tldraw v5 native-first UI

The Engine demo will add ~20 capabilities. The failure mode is turning a clean
canvas into a control panel of floating HTML. These three rules (from PLAN.md
§7.5) keep every new surface native to tldraw. Confirm any version-sensitive API
against [docs/tldraw/llms.txt](../../../../docs/tldraw/llms.txt) and the installed
`tldraw@^5.1.1` before using it.

## The three rules

1. **Every surface maps to a named tldraw `components` slot** — never a floating
   HTML panel bolted onto `<Tldraw>`. The slot inventory (verified against the
   installed types):
   - **Editor slots:** `InFrontOfTheCanvas`, `OnTheCanvas`, `Background`
   - **UI slots:** `SharePanel` (top-right), `Toolbar`, `StylePanel`,
     `ContextMenu`, `MainMenu`, `HelperButtons` (bottom-left), `Toasts`,
     `Dialogs`, `KeyboardShortcutsDialog`
   The demo already uses `InFrontOfTheCanvas` (Tray + PlayerToolbar +
   PhysicsPanel) and `StylePanel`. **Everything new lands in an existing slot.**

2. **Nothing appears unless context calls for it.** The canvas at rest shows only
   the tray. New editing surfaces are **selection-driven** (the contextual-toolbar
   pattern) or **mode-driven** (an overlay shown only while a rig/paint edit mode
   is active). Generalize the existing `PlayerToolbar`; don't add always-on chrome.

3. **Follow the official tldraw example verbatim.** The Tray is tldraw's "Drag and
   drop tray" example; the toolbar is the "Contextual toolbar" example. Every new
   piece cites and follows a specific official example, so we never reinvent a
   pattern tldraw already ships.

## `components` is a module-level const — respect it

In `App.tsx`, `components` is a **module-level const** for stable identity, so the
tray/panels never remount. Consequences you must honor:
- **Components in slots can't take props.** They read shared state from atoms
  (`game/state.ts` → `playingAtom`, `tunablesAtom`), not from App. New play-time
  UI reads `playingAtom` to show/hide itself.
- **`InFrontOfTheCanvas` (`.tl-canvas__in-front`) is `pointer-events: none`** so
  panning works through it. Any interactive child must opt back in with
  `pointer-events: all` (see App.css) or it's dead to clicks.

## Where each kind of surface goes

| Surface | Slot / pattern |
|---|---|
| Play / Stop / Reset controls | `SharePanel` (top-right) — not a hand-rolled HTML bar |
| In-play HUD (score/health/timer) | `InFrontOfTheCanvas`, shown only while `playingAtom` |
| Live tuning panel | `InFrontOfTheCanvas`, play-only (exists) |
| Add elements (roles/props) | the existing **sectioned** Tray in `InFrontOfTheCanvas` |
| Per-element edit (rig/behavior/link) | role-aware buttons on the contextual toolbar |
| Full editors (rig / timeline / weight-paint) | a custom `StateNode` **tool**, entered via `editor.setCurrentTool('engine.rig')`, rendering handles through `InFrontOfTheCanvas` while active — NOT a floating overlay. This gets Escape-to-exit, pointer capture, and tool-scoped shortcuts for free. |
| AI generate | one **`HelperButtons`** entry ("✨ Generate") → a native **`Dialogs`** modal. One AI door, not one button per converter. |
| Game-flow screens (title/win/lose) | full-screen React over the canvas (canvas hidden), reusing the `eng-banner` pattern |
| New-from-template / global rules / mutators | `MainMenu` submenu items → `Dialogs` forms |

## Settled UX decisions (don't relitigate)

- **Full editors are true tldraw tools (`StateNode`), not overlays.** Lighter
  contextual-toolbar buttons stay plain React; only the full editors become tools.
- **Sectioned tray now; a searchable insert menu only past ~15 roles.** Group the
  tray (Terrain / Hazards / Enemies / Items / Props) before adding the 6th role.
- **One "✨ Generate" dialog with a target selector** (this level / this character
  / an enemy / the feel), inferring a default target from the selection — not one
  button per converter.

## Anti-patterns (reject these in review)

- A `position: fixed` HTML panel appended next to `<Tldraw>` instead of a slot.
- Always-on chrome that shows with nothing selected and no mode active.
- A second toolbar (generalize `PlayerToolbar` → role-aware `ElementToolbar`).
- A "Generate X" button per converter (clutter — use the one ✨ door).
- Re-implementing modal/escape/pointer-capture logic in an overlay instead of a
  `StateNode` tool.
