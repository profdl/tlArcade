# CLAUDE.md

Guidance for working in this repo. Keep it short and true to the code — if a
fact here drifts from the source, fix the source of truth (the code / README)
and update this file.

## What this is

A switcher hosting several independent **tldraw v5** (`Vite + React +
TypeScript`) prototypes in one app. [src/App.tsx](src/App.tsx) is a router;
[src/Home.tsx](src/Home.tsx) lists the demos; each one lives fully
self-contained under `src/demos/<slug>/` and is lazy-loaded via
[src/demos/manifest.ts](src/demos/manifest.ts). See [README.md](README.md)
for the current demo list and routes.

**Each demo's own `CLAUDE.md` (where present, e.g.
[src/demos/toolkit/CLAUDE.md](src/demos/toolkit/CLAUDE.md)) is the real
architecture reference for that demo** — Claude Code picks it up
automatically when you're working inside that directory. This file only
covers the shell that holds them together.

Demos were folded in via `git subtree --squash`, one per branch; the branch
each came from is untouched and still has full unsquashed history.

## Commands

```bash
npm run dev    # vite dev server -> http://localhost:5173
npm run build  # tsc -b + vite build (type-check + build, incl. the Worker)
npm test       # vitest + Toolkit's framework-free *.test.mjs files
npm run lint   # eslint
```

## Structure that matters across every demo

- **One demo mounted at a time.** The router lazy-loads each demo's
  `App.tsx`; nothing about the shell assumes two demos are ever mounted
  simultaneously. Don't rely on that for isolation, though — a demo's CSS or
  module-level state can still leak if it isn't self-contained (see below).
- **CSS collisions are a real, seen-in-the-wild risk**, not theoretical: the
  three Line Rider demos all forked from the same base and kept the same
  `.lr-*` class prefix on since-diverged styles. They're now split into
  `.lr-*` / `.lrm-*` / `.lrs-*`. If you add a demo that shares lineage with
  an existing one, check for this before assuming Vite's lazy-chunk
  code-splitting isolates them — it doesn't reliably unload a previous
  route's stylesheet on navigation.
- **`persistenceKey` (or any other cross-demo-visible identifier) must be
  unique per demo.** The same three Line Rider demos originally all hardcoded
  `persistenceKey="line-rider"`, so they silently shared one localStorage
  document. Each now uses its own slug.
- **Custom tldraw shape/binding types are GLOBAL to the TypeScript program**,
  not scoped to the demo that registers them — `declare module 'tldraw' {
  interface TLGlobalShapePropsMap { ... } }` augments the union for every
  file `tsc` compiles together, even though each demo only passes its own
  `shapeUtils` to its own `<Tldraw>` at runtime. In practice this means: a
  demo that builds a `TLShapePartial` from a non-literal `type` field (e.g.
  `type: shape.type`) can stop type-checking once enough OTHER demos add
  their own custom shapes, purely because the union got bigger — TS's
  discriminated-union check isn't guaranteed to resolve at scale. Fix at the
  call site with an explicit cast (see `busytown/render/bridge.ts` or
  `face-mask/bindings/FaceFeatureBindingUtil.ts` for the pattern); it's a
  compile-time-only annotation, not a behavior change.
- **`shared/` is Worker + client code shared by the Toolkit demo**, aliased
  as a bare `shared/*` specifier (see `vite.config.ts`/`vitest.config.ts`
  resolve.alias and the `paths` entry in `tsconfig.app.json`) so nested demo
  files don't need `../../../shared` chains.
- **Vitest and the dev/build Vite config are deliberately separate files**
  (`vitest.config.ts` vs `vite.config.ts`) — the `@cloudflare/vite-plugin`
  used for the Toolkit demo's Worker isn't compatible with Vitest's own
  environment setup.
- Toolkit's `*.test.mjs` files are framework-free (`node:assert`, run via
  `node --experimental-strip-types`) and are excluded from Vitest's include
  glob for that reason — see `test:toolkit` in `package.json`.

## tldraw v5 reference

Offline copies of tldraw's LLM doc exports (pinned at download time) live in
[docs/tldraw/](docs/tldraw/):

- `llms.txt` — the index. **Start here** to find the right SDK feature, then
  read its section.
- `llms-docs.txt` — full SDK feature guides (shapes, geometry, camera,
  coordinates, components, `editor.run`, etc.).

When unsure about a tldraw API, consult these before guessing. They're a
snapshot — for anything version-sensitive, confirm against the installed
`tldraw` package version (`^5.1.1`).
