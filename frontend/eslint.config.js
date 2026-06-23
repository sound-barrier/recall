import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'

export default tseslint.config(
  {
    // Flag any `// eslint-disable` directive that suppresses nothing — the
    // nolintlint twin of the Go side (allow-unused: false). Keeps suppressions
    // honest and prevents stale ones rotting in the tree.
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  {
    // The ONLY files exempt from linting are generated artifacts we do
    // not author. Everything else — tests, e2e specs, config files, and
    // build scripts — is linted (lint:js runs `eslint .`, not `eslint src`).
    ignores: [
      'dist/',
      'coverage/',
      'wailsjs/',           // Wails-generated Go↔JS bindings
      'src/api.gen.d.ts',   // openapi-typescript output (make gen-types)
      'test-results/',      // Playwright run output
      'playwright-report/', // Playwright HTML report
      '**/*-snapshots/',    // Playwright snapshot fixtures
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    // vue-eslint-parser handles the template and hands <script lang="ts"> to the
    // TS parser. projectService + extraFileExtensions make src SFCs type-aware so
    // the bug-catcher rules below can read types through <script setup>.
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.vue'],
      },
    },
  },
  {
    // .ts under src — the typed program for the type-aware rules below.
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname, extraFileExtensions: ['.vue'] },
    },
  },
  {
    // Type-aware rules — the Go-side errcheck/staticcheck analog — scoped to the
    // typed src program (`src/**`, exactly what tsconfig.json includes). We enable
    // only the genuine bug-catchers: an unhandled promise is a swallowed error
    // (no-floating-promises ≈ errcheck for async). Two families are left off:
    //   - no-unsafe-* : investigated (≈235 src hits) and left off — they're
    //     typescript-eslint FALSE POSITIVES, not real `any`. Almost every hit is
    //     "type that could not be resolved" on a Pinia store access
    //     (matchesStore.x); vue-tsc resolves those store types fully (a probe
    //     showed matchesStore.records typed correctly), but typescript-eslint
    //     can't resolve the large setup-store type under projectService. Ruled
    //     out: the markRaw bundles (already explicitly typed, e.g. MatchAnchorApi),
    //     a circular store import (breaking it didn't help), and project-vs-
    //     projectService (both fail). Enabling would mean suppressing false
    //     positives, not catching bugs. Genuine boundary `any` (an api/SSE edge)
    //     is rare — type it case-by-case if it appears.
    //   - require-await : style, not bugs (an async fn with no await just returns
    //     an already-resolved promise); ~93 of 94 hits are test helpers.
    // Config files / e2e specs / .cjs stay on the syntactic `recommended` tier.
    files: ['src/**/*.{ts,vue}'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
    },
  },
  {
    languageOptions: {
      globals: { ...globals.browser },
    },
    rules: {
      'vue/multi-word-component-names': 'off',
      'vue/max-attributes-per-line': 'off',
      'eol-last': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        varsIgnorePattern: '^_',
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
    },
  },
  {
    // vue/one-component-per-file enforces one SFC per .vue file — it
    // misfires on .test.ts files that mount several ad-hoc
    // `defineComponent` host wrappers, which is the canonical
    // @vue/test-utils pattern. The rule has no bearing on test helpers.
    files: ['**/*.test.ts'],
    rules: {
      'vue/one-component-per-file': 'off',
    },
  },
  {
    // CommonJS modules (.cjs) — `require` IS the module system here, so
    // the ESM-only no-require-imports rule doesn't apply. The file is
    // still linted by every other rule; this just teaches ESLint the
    // module system + Node globals it runs under.
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
)
