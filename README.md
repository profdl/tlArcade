# tldraw app

A bare [tldraw](https://tldraw.dev) v5 canvas — a starting point for future
demos. The full Line Rider game that used to live on `main` now lives on the
[`line-rider`](../../tree/line-rider) branch.

## Stack

- **Vite + React + TypeScript**
- **tldraw v5** as the canvas / editor engine

> See [docs/tldraw/](docs/tldraw/) for offline tldraw v5 SDK docs.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc -b + vite build (type-check)
npm test         # vitest run
npm run lint     # eslint
```
