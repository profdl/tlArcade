import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cloudflare } from '@cloudflare/vite-plugin'

// https://vite.dev/config/
export default defineConfig({
  // cloudflare() wires the Worker (worker/worker.ts, per wrangler.toml) into
  // Vite's own dev server/build — the Toolkit demo's multiplayer sync API
  // needs it, everything else is a plain static SPA and ignores it. Vitest
  // uses its own vitest.config.ts instead: the Cloudflare plugin's Worker
  // environment isn't compatible with Vitest's test environment setup.
  plugins: [react(), cloudflare()],
  resolve: {
    alias: {
      // @tonejs/piano's MIDI input imports Node's built-in `events`, which Vite
      // externalizes for the browser (leaving EventEmitter undefined and crashing
      // the module on import). Alias it to the `events` browser polyfill so the
      // package loads even though we never use its MIDI features.
      events: 'events',
      // Code shared between the Toolkit demo's client and worker (schemas,
      // wire protocol) — avoids '../../../shared' chains from deeply nested
      // demo files.
      shared: path.resolve(__dirname, 'shared'),
    },
  },
})
