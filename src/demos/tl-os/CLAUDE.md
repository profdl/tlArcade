# CLAUDE.md — tl-os demo

Guidance for working in this demo. Keep it short and true to the code — if a
fact here drifts from the source, fix the code and update this file.

## What this is

A **spatial file workspace** on the **tldraw v5** canvas — *not* a windows-and-
dock desktop sim. Bind a real local folder and browse it in movable, resizable
**macOS-Finder column-view windows**, each a native tldraw shape drawn in a
hand-drawn Perfect-Freehand style. Files can still be dragged out of a window
onto the canvas to lay out, annotate, and relate spatially. Think "a canvas that
beats nested folders for organising a project," with a Finder you can *also*
scatter across the page.

## The one architectural rule

**The canvas is authoritative for *layout, annotations, relationships*; the disk
is authoritative for *bytes and directory structure*; they reconcile by `path`,
and only ever touch at explicit user actions.** This is what keeps the classic
file-manager "two sources of truth" problem tractable — respect it when adding
features. A file-shape is a *pointer* (`{ path, name, kind, ext }` + its canvas
position/meta); **no bytes live in the shape store**. `path` is root-relative,
POSIX-style, and is the join key back to disk.

## What's built

- [fs.ts](fs.ts) — the disk-binding layer. Grants a directory via the **File
  System Access API** (`showDirectoryPicker`), persists the handle in IndexedDB
  (via the already-present `idb` dep — a tiny inline keyval, no `idb-keyval`
  dep), re-authorises on reload, and reads directories into `DirEntry`
  pointers. Minimal FS-Access API types are declared inline (no
  `@types/wicg-file-system-access` dep).
- [BrowserShapeUtil.tsx](BrowserShapeUtil.tsx) — the **`tlos-browser` custom
  shape**: a movable/resizable macOS-Finder **column view**. Each open folder is
  one window; several can sit on the canvas at once. Props are a *pointer*:
  `rootPath` (the folder it opens) + `selection: Picked[]` (`{path,kind,ext}`
  per column, driving what the next column shows). **No bytes/handles in props** —
  directories are read on demand through a `BrowserServices` context (`readDir`
  + `openFile`) the App wires up, so this file never imports the disk layer.
  Selecting a folder extends the chain (opens the next column); selecting a
  **file** shows a trailing **preview pane** (image thumbnail via the shared
  `useThumbResolver`, else a file-info card). Chrome is fully Perfect-Freehand:
  rough window outline, wobbly column dividers, hand-drawn selection boxes, and
  freehand disclosure chevrons. All text uses `var(--tl-font-sans)`.
- [FileShapeUtil.tsx](FileShapeUtil.tsx) — the `tlos-file` custom shape (one
  util for files *and* folders; `props.kind` selects). A file dragged onto the
  page uses this. Renders a hand-drawn file/folder glyph (see
  [freehand.ts](freehand.ts) and "Looking & feeling"), name, extension badge,
  and lazy image thumbnails. Thumbnails load via a `ThumbProvider` context
  resolver (also exported as `useThumbResolver`, reused by the browser preview
  pane) so the util never imports the disk layer or root handle. Double-click →
  `setOpenHandler` module callback.
- [freehand.ts](freehand.ts) — a tiny perfect-freehand helper. `strokePath` /
  `poly` build the fixed 0–100 glyph outlines; `line` / `roughRect` / `chevron`
  stroke live-sized chrome (window frame, dividers, selection boxes, chevrons)
  from the shape's current w/h. All tldraw Draw-dash-style rough outlines.
- [App.tsx](App.tsx) — owns all bind/open/import state and effects. Binding a
  root (or re-binding a remembered one) opens a `tlos-browser` window via
  `openBrowser` (reconciles by `meta.tlosPath`, stacks with `avoidOverlap`).
  Provides the thumb resolver and `BrowserServices`, sets the open handler.
  A folder-icon double-click also opens a browser window at that folder; a file
  opens in a new tab (`openFilePath`, shared by icon + browser row). Shares
  state with the tldraw-native UI via `TlosUiProvider`.
- [ui.tsx](ui.tsx) — the **tldraw-native UI**. `BindPanel` is injected as
  tldraw's `SharePanel` (top-right) so the control reads as app chrome, not a
  floating overlay. It's a single **Finder View** button whose `onFinderView`
  action is routed by bind `status` in App: a bound folder just (re)opens its
  window, a lapsed one re-grants, and a fresh session opens the folder picker
  **rooted at Documents** (`showDirectoryPicker({ startIn: 'documents' })`) —
  the browser sandbox still requires the user to confirm the folder (it can't
  silently grant one), so this makes the common case a single confirming click.
  The import-vs-reference prompt is a real
  tldraw dialog (`useDialogs().addDialog` + `TldrawUiDialog*` + `TldrawUiButton`)
  — inherits the SDK's theming, dark mode, focus trap, and esc/backdrop close.

## Looking & feeling like tldraw

The demo deliberately leans on tldraw's own UI system instead of bespoke chrome:
- **Theme CSS vars, not hardcoded hex.** Surfaces/text use `--tl-color-panel` /
  `--tl-color-text` / `--tl-color-muted-*` and `--tl-font-sans`, so tl-os flips
  correctly in **dark mode**. File-family tints (`FAMILY_TINT`) are tldraw's own
  draw-palette hexes on purpose; the folder glyph strokes tldraw blue with a
  translucent fill (a solid light-blue glared in dark mode).
- **Native components, not overlays.** Bind controls live in `SharePanel`; the
  dialog is a `useDialogs` dialog; buttons are `TldrawUiButton`. Selection is
  tldraw's own indicator (`getIndicatorPath`); only *hover* is added, as a faint
  `--tl-color-muted-2` highlight on `.tlos-file`.
- **Hand-drawn glyphs *and* window chrome.** The file/folder glyphs and the
  `tlos-browser` window's whole chrome (outline, column dividers, header rule,
  selection boxes, disclosure chevrons) are drawn with perfect-freehand
  ([freehand.ts](freehand.ts)) using the same even-nib / no-pressure options
  busytown uses to match tldraw's geo "Dash: Draw" look — so they read as
  drawn-on-canvas, not like macOS icons. Glyph outlines are computed once at
  module load (fixed 0–100 art box); the chrome's `line`/`roughRect`/`chevron`
  are stroked from the shape's *live* w/h each render (cheap; a few short
  strokes) so the wobble tracks a resize. `line()` jitters its midpoints so a
  straight rule still visibly wobbles. Every freehand SVG uses `overflow:visible`
  so the wobble past the box edge isn't clipped. `freehand.ts` is a local copy on
  purpose (demos stay isolated — no cross-demo import).

**Browser reality: the directory picker is Chrome/Edge/Opera only** — Safari and
Firefox have no `showDirectoryPicker` (they ship only the Origin-Private FS). The
UI feature-detects and shows an "unsupported" note rather than breaking.

## Semantics locked (design decisions)

- **Browsing lives *inside* a window; the disk is never mutated by canvas
  moves.** Navigating columns, moving/resizing a window, and dragging a file out
  do *nothing* to disk. Real moves must be an *explicit* action (a "Move to
  folder…" menu + confirm), never a drag side effect — this keeps the canvas
  playful and lets it group files *across* real folders (something Finder can't
  do). Preserve this.
- **Opening a folder reconciles, it doesn't pile up.** A `tlos-browser` window is
  tagged `meta.tlosPath`; `openBrowser` deletes the prior window for that path
  before re-creating it, so re-opening a folder replaces (not duplicates) it. A
  window's own column navigation lives entirely in its `selection` prop — no new
  shapes are spawned per folder (that's the point of a column view).
- **Two gestures land a file on the canvas; both prompt import-vs-reference.**
  (1) *Dragging a file row **out of a browser window** onto the canvas.* The row
  arms a drag on pointer-down (`armDragOut` in `BrowserShapeUtil`): past a small
  threshold it lifts a floating "Add to canvas" ghost, and a release **outside
  the window's page bounds** calls `BrowserServices.onDropFile(entry, pagePoint)`.
  The App (`dropFile`) creates a fresh page-level `tlos-file` pointer centred at
  the drop point and opens the dialog. A press that never passes the threshold is
  a plain select (column navigation still works); folders don't arm the drag.
  (2) *Dragging an existing `tlos-file` icon out of a frame onto the page.* A
  `registerAfterChangeHandler('shape')` side-effect (in `handleMount`) detects
  the reparent (frame → page, `source === 'user'`) and opens the same dialog.
  Because gesture (1) creates the pointer *directly on the page* (no frame→page
  reparent), the two paths never double-fire — they're independent. Both share
  the one dialog: *Import into tldraw* → `putExternalContent({type:'files'})`
  runs tldraw's own file→asset→shape pipeline at the pointer's spot and deletes
  the pointer (content now lives in the doc, survives without the disk binding);
  *Keep as reference* → the `tlos-file` pointer just stays where it was dropped.

## Gotcha: blob: URLs crash the default bookmark handler

An image thumbnail is an `<img src="blob:…">`. A blob: `<img>` is **natively
draggable by the browser**; if it drags, the canvas receives a `url` drop of the
blob: URL, tldraw's default handler tries to make a **bookmark** shape from it,
and the bookmark `url` validator rejects the `blob:` protocol — a
`ValidationError` that takes down the whole canvas. Two guards, keep both:
`draggable={false}` + `pointerEvents:'none'` on the thumbnail img (removes the
vector), and a `registerExternalContentHandler('url', …)` that swallows
`blob:`/`file:` URLs (belt-and-braces). The url handler currently no-ops *all*
URLs — see the code comment; revisit if bookmark-from-URL is ever wanted.

## Not yet built (planned next)

Rescan/reconcile; notes/arrows/colour (mostly free — it's just tldraw); guarded
rename / move-to-folder / delete-to-trash; lazy materialisation for huge dirs
(render a counted frame, not N shapes); multiplayer (promote pointer+layout onto
the Toolkit Worker+DO, thumbnails as shared assets — handles are machine-local
and are NOT synced).

## Conventions for this demo

- **CSS classes are prefixed `.tlos-`** so a stale lazy-loaded stylesheet can't
  collide with another demo after a route change (see the repo `CLAUDE.md`).
- **`persistenceKey="tl-os"`** — unique per demo; never reuse another demo's key
  or the two silently share one localStorage document.
- Self-contained under `src/demos/tl-os/`. No root-level config lives here — the
  repo root owns `package.json`, `vite.config.ts`, `tsconfig*`, etc.

## Commands (run from repo root)

```bash
npm run dev    # http://localhost:5173  → /demos/tl-os
npm run build  # tsc -b + vite build (type-check)
npm run lint   # eslint
```

## tldraw v5 reference

Offline SDK docs live in the repo's [docs/tldraw/](../../../docs/tldraw/).
Start at `llms.txt` (the index), then read the relevant section. Confirm any
version-sensitive API against the installed `tldraw` (`^5.1.1`).
