# Busytown

> Part of the [tlArcade](../../../README.md) prototyping platform — mounted
> at `/demos/busytown`. No `package.json`/build of its own; run everything
> from the repo root (`npm run dev`, then visit `/demos/busytown`).

A tldraw (v5) canvas that behaves like a living little town: drop characters,
props, and vehicles and watch a small ECS sim drive whims, greetings, and
deliveries between them.

See [CLAUDE.md](CLAUDE.md) for the architecture (the sim/content/render
split, the extension surface, verified "feel" numbers) and
[HANDOFF.md](HANDOFF.md) for the original design handoff notes.
