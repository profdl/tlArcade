---
name: engine-verify
description: The self-check gate every Engine implementation agent runs before reporting a change done. Use after editing anything under src/demos/engine/ or worker/engine.ts. Encodes exactly which commands prove a change works in THIS repo, plus the "drive the actual flow" step, so "done" means verified, not "it compiles".
---

# Engine verify gate

Run this before reporting any Engine change done. "It type-checks" is not done;
these commands + a real play-through are. Run them from the repo root.

## The commands (all must pass)

```bash
npm run build   # tsc -b + vite build — type-checks the WHOLE program (incl. the Worker)
npm test        # vitest run + the toolkit framework-free *.mjs tests
npm run lint     # eslint
```

Notes specific to this repo:
- `npm run build` runs `tsc -b` first — it type-checks **every** demo together, so
  a change can break type-checking in a file you didn't touch (custom shape/binding
  types are global to the TS program — see the shell CLAUDE.md). If `tsc` errors in
  another demo after your change, that's your change's fault to fix or work around
  (usually an explicit cast at a `TLShapePartial` call site).
- `npm test` runs Vitest **and** the toolkit `.mjs` tests. Engine unit tests
  (`physics.test.ts`, `collision.test.ts`, and any new `*.test.ts`) run under
  Vitest. Keep new pure-module tests as Vitest `*.test.ts` colocated with the code.
- Worker changes (`worker/engine.ts`) are type-checked by `npm run build` via the
  Cloudflare Vite plugin. There's no separate worker build command.

## Then drive the actual flow (don't skip this)

Green tests don't prove the game plays. After the commands pass, exercise the
change in the running app (the repo's `verify`/`run` skills launch it — `npm run
dev` → http://localhost:5173, navigate to the Engine demo):

- **Runtime/sim change:** Play → move (A/D or arrows) → jump (W/Space/Up) → touch
  a token (collects), a hazard (respawns), the goal (wins only after all tokens) →
  **Stop → confirm the scene restored to the authored positions/opacity.** A sim
  change that softlocks the player, floods undo, or leaves a mutation after Stop is
  NOT done even if tests pass.
- **UI change:** the surface appears in its intended tldraw slot, only when context
  calls for it, and doesn't break canvas panning (pointer-events).
- **Converter change:** author the data by hand through the editor, then (if wired)
  generate it via the ✨ door, confirm it validates and opens the editor.

## Screenshot policy

Capturing a screenshot to verify is fine, but per this user's standing preference,
**do not Read/view the screenshot image without explicit approval** — describe what
you'd check and ask first.

## Reporting

A fan-out agent must end on a green run of this gate for its slice and report
**what it changed + the actual command output**, not a narrative. If a command
fails, report the failure and its output — never claim done over red tests.
