import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Honor an externally assigned port (e.g. the preview harness's PORT env) so
  // multiple dev servers can coexist; falls back to Vite's default otherwise.
  server: process.env.PORT ? { port: Number(process.env.PORT) } : undefined,
  // Vitest — tldraw v5's own runner. jsdom, since tests that mount a real
  // tldraw <Editor> need browser globals (mocked in src/test/setup.ts).
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    css: false,
  },
})
