import path from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Separate from vite.config.ts: the Cloudflare Worker plugin used there for
// dev/build isn't compatible with Vitest's own environment setup. Mirrors
// the aliases from vite.config.ts (minus cloudflare()) so demo code resolves
// identically under test.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      events: 'events',
      shared: path.resolve(__dirname, 'shared'),
    },
  },
  // jsdom because some demos (busytown, face-mask) mount a real tldraw
  // <Editor> in tests, which needs browser globals (mocked in
  // src/test/setup.ts). Doesn't affect the Line Rider demos' pure-function
  // tests, which don't touch the DOM either way.
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Toolkit's *.test.mjs files are framework-free (plain node:assert, run
    // via `node --experimental-strip-types` — see the test:toolkit script),
    // not Vitest suites; Vitest's default include glob would otherwise catch
    // them and report a misleading "no test suite found" per file.
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{vite,vitest}.config.*',
      '**/*.test.mjs',
    ],
  },
})
