# tlArcade

A prototyping platform for [tldraw](https://tldraw.dev) v5 experiments. One
app, one deployment, many independent prototypes — each lives fully
self-contained under `src/demos/<slug>/`, and a switcher at `/` lists whatever
prototypes currently exist. The point is to make starting the *next*
prototype cheap: no new repo, no new deploy target, no new tooling decisions —
just a folder and one manifest entry.

## Current prototypes

| Prototype | Route | What it is | Origin branch |
|---|---|---|---|
| Line Rider: Classic | `/demos/line-rider-classic` | Draw a track, hit play, ride it — hand-rolled Verlet physics, flags, portals | [`line-rider`](../../tree/line-rider) |
| Line Rider: Machines | `/demos/line-rider-machines` | Classic + a drag-and-drop tray for portal/multiplier pieces | [`machines`](../../tree/machines) |
| Line Rider: Side Mode | `/demos/line-rider-side` | Diverged variant: draw ramps live while riding | [`side-rider-mode`](../../tree/side-rider-mode) |
| Busytown | `/demos/busytown` | An ambient ECS town sim — characters, jobs, whims | [`simtown-busytown`](../../tree/simtown-busytown)\* |
| Face Mask | `/demos/face-mask` | Pin native tldraw shapes to webcam-tracked face landmarks | [`simtown-face-mask`](../../tree/simtown-face-mask)\* |
| Toolkit | `/demos/toolkit/*` | Multiplayer tabletop toolkit — synced tokens/dice/cards/creatures, server-authoritative referee | [`toolkit-master`](../../tree/toolkit-master)\* |
| Scale Portals | `/demos/scale-portals` | Top-down WFC room maps nested by scale — walk into a portal room and the camera dives into a whole smaller map inside it | — |

\* Local-only branch (not pushed to `origin`) — kept for history/reference.

These six were folded in from pre-existing standalone repos via `git
subtree`, so each one's original commit history is still importable/
browsable on the branch it came from (untouched). **New prototypes don't need
an origin branch at all** — see below.

## Stack

- **Vite + React + TypeScript**, one SPA (`react-router-dom`) for every prototype
- **tldraw v5** as the canvas / editor engine in each one
- **Cloudflare Workers** for deployment — the Toolkit prototype needs a live
  Worker + Durable Object for multiplayer sync (`worker/`, `shared/`,
  `wrangler.toml`); everything else is static and rides along for free
  (`[assets]` in `wrangler.toml` serves the built SPA; only `/api/*` hits
  the Worker)
- `src/DemoLayout.tsx` wraps every prototype route with a small nav bar
  ("← All demos" + the current name) so you're never stuck once inside one

## Adding a new prototype

Starting fresh (the common case going forward):

1. Create `src/demos/<slug>/App.tsx` exporting a default component. Mount
   whatever tldraw canvas/UI you want inside it — treat it like any other
   small Vite app, just without its own `package.json`/`vite.config.ts`/
   `index.html` (there's one of each at the repo root, shared by everyone).
2. Add one entry to `src/demos/manifest.ts` (`slug`, `title`, `blurb`,
   `Component: lazy(() => import('./<slug>/App'))`).
3. If it needs dependencies no other prototype already has, add them to the
   root `package.json`.
4. If it uses global CSS classes, give them a prefix unique to this
   prototype (see the Line Rider trio's `.lr-*`/`.lrm-*`/`.lrs-*` split for
   why — only one prototype is mounted at a time, but a stale lazy-loaded
   stylesheet can outlive a route change).
5. If it uses a Tldraw `persistenceKey`, give it a unique value — don't reuse
   another prototype's.

Importing an existing standalone repo instead (what the six above did):

1. `git subtree add --prefix=src/demos/<slug> <branch-or-remote> --squash`
2. Strip the config it brought with it that's now redundant (its own
   `package.json`, `vite.config.ts`, `tsconfig*`, `index.html`, eslint/oxlint
   config, `docs/tldraw/` SDK snapshot).
3. Move `public/*` assets it needs into `public/demos/<slug>/` (every
   standalone repo tends to ship its own `favicon.svg`, which collide by
   filename otherwise).
4. Then steps 3–5 above (deps, CSS prefixing, `persistenceKey`, manifest entry).

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # tsc -b + vite build (type-check + build, incl. the Worker)
npm test             # vitest + Toolkit's framework-free *.test.mjs files
npm run lint         # eslint
```

All commands run from the repo root — no prototype has its own dev
server/build/test setup anymore.

> See [docs/tldraw/](docs/tldraw/) for offline tldraw v5 SDK docs.
