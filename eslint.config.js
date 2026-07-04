import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // Matches tsconfig's verbatimModuleSyntax, which requires explicit
      // `import type` — this also gives us an autofix for it.
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // Busytown and Face Mask were migrated in from repos linted with oxlint,
    // which doesn't enforce these rules. Relax them here rather than rewrite
    // working, tested game/hook logic during the migration.
    files: ['src/demos/busytown/**/*.{ts,tsx}', 'src/demos/face-mask/**/*.{ts,tsx}'],
    rules: {
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-refresh/only-export-components': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // Toolkit (client + worker) was migrated in from a repo with no lint
    // config at all. Relax the same categories as above, rather than rewrite
    // working, tested shape/hook logic during the migration. `react-hooks/refs`
    // is off specifically for CreatureShape.tsx's chain renderer, which reads
    // a ref intentionally to skip React reconciliation on a hot animation path
    // (documented in the code comment right above it) — a measured perf
    // tradeoff, not an oversight.
    files: ['src/demos/toolkit/**/*.{ts,tsx}', 'worker/**/*.ts', 'shared/**/*.ts'],
    rules: {
      'react-refresh/only-export-components': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'react-hooks/refs': 'off',
    },
  },
])
