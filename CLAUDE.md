# CLAUDE.md

Guidance for working in this repo. Keep it short and true to the code — if a
fact here drifts from the source, fix the source of truth (the code / README)
and update this file.

## What this is

A bare **tldraw v5** scaffold (`Vite + React + TypeScript`) — just `<Tldraw />`
mounted full-screen in [src/App.tsx](src/App.tsx). No custom shapes, tools, or
game logic. A starting point for building new tldraw-based demos.

The full Line Rider game that used to live here now lives on the `line-rider`
branch, along with its own architecture notes.

## Commands

```bash
npm run dev    # vite dev server -> http://localhost:5173
npm run build  # tsc -b + vite build (run this to type-check)
npm test       # vitest run (no tests yet)
npm run lint   # eslint
```

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
