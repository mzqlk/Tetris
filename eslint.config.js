import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  // `.superpowers/sdd/` is per-task SDD scratch, gitignored by its own
  // `.gitignore`. Without this, `eslint .` reports errors in files that are
  // not in the repository and are absent from a fresh clone.
  globalIgnores(['dist', '.superpowers/**']),
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ['training/**/*.ts', '*.config.{js,mjs,cjs,ts}', 'eslint.config.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
]);
