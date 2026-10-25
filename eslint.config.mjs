import js from '@eslint/js'
import { defineConfig } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

// core and rt-js must run unchanged in a Web Worker, in Node and in Vitest (CLAUDE.md, Purity),
// so their sources may not reach for a platform. Defaults that need one (a clock, entropy) go
// through `globalThis` behind an injectable option.
const platformGlobals = [
  'window',
  'document',
  'navigator',
  'self',
  'process',
  'require',
  'module',
  'global',
  'Buffer',
  '__dirname',
  '__filename',
  'localStorage',
  'sessionStorage',
  'fetch',
  'XMLHttpRequest',
  'setTimeout',
  'setInterval',
  'setImmediate',
  'queueMicrotask',
  'postMessage',
]

export default defineConfig([
  { ignores: ['**/node_modules/', '.superpowers/', 'coverage/'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['packages/core/src/**/*.ts', 'packages/rt-js/src/**/*.ts'],
    rules: {
      'no-console': 'error',
      'no-restricted-globals': ['error', ...platformGlobals],
      'no-restricted-imports': [
        'error',
        {
          patterns: [{ group: ['node:*'], message: 'core and rt-js must not depend on Node.' }],
          paths: ['fs', 'path', 'os', 'url', 'util', 'crypto', 'process', 'child_process'],
        },
      ],
    },
  },
  {
    files: ['tools/**/*.ts', '*.config.ts', '*.config.mjs'],
    languageOptions: { globals: globals.node },
  },
])
