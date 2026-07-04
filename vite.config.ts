import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // @tonejs/piano's MIDI input imports Node's built-in `events`, which Vite
      // externalizes for the browser (leaving EventEmitter undefined and crashing
      // the module on import). Alias it to the `events` browser polyfill so the
      // package loads even though we never use its MIDI features.
      events: 'events',
    },
  },
  // Vitest — jsdom because some demos (busytown, face-mask) mount a real
  // tldraw <Editor> in tests, which needs browser globals (mocked in
  // src/test/setup.ts). Doesn't affect the Line Rider demos' pure-function
  // tests, which don't touch the DOM either way.
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
