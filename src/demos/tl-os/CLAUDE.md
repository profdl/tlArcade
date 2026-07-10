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
  util for files *and* folders; `props.kind` selects). Renders an icon, name,
  extension badge, and lazy image thumbnails. Thumbnails load via a
  `ThumbProvider` context resolver so the util never imports the disk layer or
  root handle. Double-click → `setOpenHandler` module callback (App wires it).
- [App.tsx](App.tsx) — grant/reconnect bar, reads the root into a titled frame
  on a starting grid, provides the thumb resolver, sets the open handler.
  Double-click opens files in a new tab and navigates folders into a new frame.

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
