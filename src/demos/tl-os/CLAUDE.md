# CLAUDE.md — tl-os demo

Guidance for working in this demo. Keep it short and true to the code — if a
fact here drifts from the source, fix the code and update this file.

## What this is

A blank **tldraw v5** scaffold for a desktop / operating-system metaphor on the
canvas (windows, a dock/taskbar, icons, etc. — to be built). Right now it is
just a plain `<Tldraw>` with a unique `persistenceKey="tl-os"`.

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
