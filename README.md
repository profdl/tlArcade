# tlArcade

A switcher for a handful of [tldraw](https://tldraw.dev) v5 prototypes, all
running out of one app. `/` lists them; each one lazy-loads at its own route.

| Demo | Route | What it is | Origin branch |
|---|---|---|---|
| Line Rider: Classic | `/demos/line-rider-classic` | Draw a track, hit play, ride it — hand-rolled Verlet physics, flags, portals | [`line-rider`](../../tree/line-rider) |
| Line Rider: Machines | `/demos/line-rider-machines` | Classic + a drag-and-drop tray for portal/multiplier pieces | [`machines`](../../tree/machines) |
| Line Rider: Side Mode | `/demos/line-rider-side` | Diverged variant: draw ramps live while riding | [`side-rider-mode`](../../tree/side-rider-mode) |
| Busytown | `/demos/busytown` | An ambient ECS town sim — characters, jobs, whims | [`simtown-busytown`](../../tree/simtown-busytown)\* |
| Face Mask | `/demos/face-mask` | Pin native tldraw shapes to webcam-tracked face landmarks | [`simtown-face-mask`](../../tree/simtown-face-mask)\* |
| Toolkit | `/demos/toolkit/*` | Multiplayer tabletop toolkit — synced tokens/dice/cards/creatures, server-authoritative referee | [`toolkit-master`](../../tree/toolkit-master)\* |
| Rig Play | `/demos/rig-play` | Rig playground: drop/draw a figure, draw bones, then drive it with WASD (walk/jump/crouch/wave) via a procedural state machine — the Engine rig without the platformer | authored in-repo |

\* Local-only branch (not pushed to `origin`) — kept for history/reference.

Each demo was folded in via `git subtree`, so its original commit history is
still importable/browsable; the branch it came from is left untouched.

## Stack

- **Vite + React + TypeScript**, one SPA (`react-router-dom`) for every demo
- **tldraw v5** as the canvas / editor engine in each demo
- **Cloudflare Workers** for deployment — the Toolkit demo needs a live
  Worker + Durable Object for multiplayer sync (`worker/`, `shared/`,
  `wrangler.toml`); everything else is static and rides along for free
  (`[assets]` in `wrangler.toml` serves the built SPA; only `/api/*` hits
  the Worker)

## Adding a demo

1. `git subtree add --prefix=src/demos/<slug> <branch> --squash`
2. Strip the demo's own root-level config it brought with it
   (package.json, vite.config.ts, tsconfig\*, index.html, eslint/oxlint
   config, its own `docs/tldraw/` SDK snapshot) — one copy of each lives at
   the repo root already.
3. Move `public/*` assets it needs into `public/demos/<slug>/` (every demo
   tends to ship its own `favicon.svg`, which collide by filename otherwise).
4. If it uses global CSS classes, check for prefix collisions against
   existing demos (see the Line Rider trio's `.lr-*`/`.lrm-*`/`.lrs-*` split)
   — only one demo is mounted at a time, but a stale lazy-loaded stylesheet
   can outlive a route change.
5. Add one entry to `src/demos/manifest.ts`.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # tsc -b + vite build (type-check + build, incl. the Worker)
npm test             # vitest + Toolkit's framework-free *.test.mjs files
npm run lint         # eslint
```

> See [docs/tldraw/](docs/tldraw/) for offline tldraw v5 SDK docs.
