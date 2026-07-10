# CLAUDE.md — tl-os demo

Guidance for working in this demo. Keep it short and true to the code — if a
fact here drifts from the source, fix the code and update this file.

## What this is

A **spatial file workspace** on the **tldraw v5** canvas — *not* a windows-and-
dock desktop sim. Bind a real local folder and read it in as icon-shapes you can
lay out, annotate, and relate spatially. Think "a canvas that beats nested
folders for organising a project," not "Finder reimplemented."

## The one architectural rule

**The canvas is authoritative for *layout, annotations, relationships*; the disk
is authoritative for *bytes and directory structure*; they reconcile by `path`,
and only ever touch at explicit user actions.** This is what keeps the classic
file-manager "two sources of truth" problem tractable — respect it when adding
features. A file-shape is a *pointer* (`{ path, name, kind, ext }` + its canvas
position/meta); **no bytes live in the shape store**. `path` is root-relative,
POSIX-style, and is the join key back to disk.

## What's built (steps 1–4 of the plan)

- [fs.ts](fs.ts) — the disk-binding layer. Grants a directory via the **File
  System Access API** (`showDirectoryPicker`), persists the handle in IndexedDB
  (via the already-present `idb` dep — a tiny inline keyval, no `idb-keyval`
  dep), re-authorises on reload, and reads directories into `DirEntry`
  pointers. Minimal FS-Access API types are declared inline (no
  `@types/wicg-file-system-access` dep).
- [FileShapeUtil.tsx](FileShapeUtil.tsx) — the `tlos-file` custom shape (one
  util for files *and* folders; `props.kind` selects). Renders a hand-drawn
  file/folder glyph (see [freehand.ts](freehand.ts) and the "Looking & feeling"
  section), name, extension badge, and lazy image thumbnails. Thumbnails load
  via a `ThumbProvider` context resolver so the util never imports the disk
  layer or root handle. Double-click → `setOpenHandler` module callback.
- [freehand.ts](freehand.ts) — a tiny perfect-freehand helper (`strokePath`,
  `poly`) producing tldraw Draw-dash-style rough outlines for the glyphs.
- [App.tsx](App.tsx) — owns all bind/open/import state and effects; reads the
  root into a titled frame on a starting grid, provides the thumb resolver, sets
  the open handler. Double-click opens files in a new tab and navigates folders
  into a new frame. Shares state with the tldraw-native UI via `TlosUiProvider`.
- [ui.tsx](ui.tsx) — the **tldraw-native UI**. `BindPanel` is injected as
  tldraw's `SharePanel` (top-right) so the folder-bind control reads as app
  chrome, not a floating overlay. The import-vs-reference prompt is a real
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
- **Hand-drawn glyphs.** The file & folder icons are drawn with perfect-freehand
  ([freehand.ts](freehand.ts)) using the same even-nib / no-pressure options
  busytown uses to match tldraw's geo "Dash: Draw" look — so they read as
  drawn-on-canvas, not like macOS icons. Outline paths are computed once at
  module load (fixed 0–100 art box) and filled; the SVG uses `overflow:visible`
  so the freehand wobble past the box edge isn't clipped. `freehand.ts` is a
  local copy on purpose (demos stay isolated — no cross-demo import).

**Browser reality: the directory picker is Chrome/Edge/Opera only** — Safari and
Firefox have no `showDirectoryPicker` (they ship only the Origin-Private FS). The
UI feature-detects and shows an "unsupported" note rather than breaking.

## Semantics locked (design decisions)

- **Frames = canvas-only grouping, never disk folders.** Dragging a file-shape
  into a frame does *nothing* to disk. Real moves must be an *explicit* action
  (a "Move to folder…" menu item + confirm), never a side effect of a drag —
  this keeps dragging playful and non-destructive, and lets the canvas group
  files *across* real folders (something Finder can't do). Preserve this when
  building step 6.
- **Re-reading a directory reconciles, it doesn't pile up.** A frame is tagged
  `meta.tlosPath`; `dumpDirectory` deletes the prior frame for that path before
  re-creating it. The planned full "rescan" (new / missing / matched by path)
  extends this — and must *never* delete a user's annotated layout for a
  missing file; gray it out instead.
- **Dragging a file-shape OUT of its frame onto the page prompts import-vs-
  reference.** A `registerAfterChangeHandler('shape')` side-effect (in
  `handleMount`) detects the reparent (frame → page, `source === 'user'`) and
  opens a dialog. *Import into tldraw* → `putExternalContent({type:'files'})`
  runs tldraw's own file→asset→shape pipeline at the icon's spot and deletes the
  pointer (content now lives in the doc, survives without the disk binding).
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
