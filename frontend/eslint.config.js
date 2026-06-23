import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import pluginVitest from '@vitest/eslint-plugin'
import pluginPlaywright from 'eslint-plugin-playwright'
import pluginA11y from 'eslint-plugin-vuejs-accessibility'
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
  // Vue-template accessibility (alt text, aria, label-has-for, …) — catches a11y
  // regressions at lint time, before they reach the axe-core e2e pass. Applies to
  // .vue files (the plugin scopes itself).
  ...pluginA11y.configs['flat/recommended'],
  {
    // The interaction trio flags the deliberate pattern a11y.md documents — a
    // clickable container (plain <div>/<li>, no role/tabindex) with a dedicated
    // keyboard-reachable <button> inside (nesting interactives under role=button
    // is invalid ARIA, see the .leaf-row). axe-core in the e2e suite is the real
    // backstop for keyboard reach, so these static-template heuristics are noise
    // against this design.
    files: ['**/*.vue'],
    rules: {
      'vuejs-accessibility/no-static-element-interactions': 'off',
      'vuejs-accessibility/click-events-have-key-events': 'off',
      'vuejs-accessibility/mouse-events-have-key-events': 'off',
      // WCAG accepts EITHER label nesting OR for/id association; the rule's
      // default demands both. Accept either (the codebase uses both forms).
      'vuejs-accessibility/label-has-for': ['error', { required: { some: ['nesting', 'id'] } }],
      // role="list" on a list-style:none <ul> is intentional, not redundant —
      // Safari/VoiceOver drops the implicit list role when bullets are removed.
      'vuejs-accessibility/no-redundant-roles': 'off',
      // Roving-tabindex ARIA patterns (tablist / grid / listbox-option) put focus
      // on the active child, not the role-bearing container — the correct
      // WAI-ARIA shape (see useTabKeyboardNav). The rule wrongly wants the
      // container focusable.
      'vuejs-accessibility/interactive-supports-focus': 'off',
    },
  },
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
    // Vitest unit tests — enforces the documented "no .only / .skip" rule at lint
    // time (no-focused-tests / no-disabled-tests as errors, not a CI grep) plus
    // expect-expect / valid-expect / no-identical-title hygiene.
    files: ['src/**/*.test.ts'],
    plugins: { vitest: pluginVitest },
    rules: {
      ...pluginVitest.configs.recommended.rules,
      'vitest/no-focused-tests': 'error',
      'vitest/no-disabled-tests': 'error',
      // Conditional assertions are a legit, clean test pattern here (e.g. a loop
      // asserting the active item one way and the rest another). Opinion, not a
      // bug-catcher — off.
      'vitest/no-conditional-expect': 'off',
    },
  },
  {
    // Playwright e2e specs — enforces the documented e2e conventions: no .only
    // (no-focused-test), no .skip (no-skipped-test), and no waitForTimeout
    // (no-wait-for-timeout), plus the flat/recommended hygiene set.
    ...pluginPlaywright.configs['flat/recommended'],
    files: ['tests/e2e/**/*.spec.ts'],
    rules: {
      ...pluginPlaywright.configs['flat/recommended'].rules,
      'playwright/no-focused-test': 'error',
      'playwright/no-skipped-test': 'error',
      // no-wait-for-timeout: OFF. The suite uses fixed waits deliberately (~36
      // sites — animation/debounce settles) and runs with retries: 0, so flakes
      // surface immediately. Rewriting each to a web-first wait is a separate,
      // risky pass, not a blocker for adopting the plugin.
      'playwright/no-wait-for-timeout': 'off',
      // Conditionals in e2e are sometimes the cleanest way to branch on queried
      // DOM state; {force:true} is occasionally needed to click through a known
      // overlay. Opinion rules, not bug-catchers — off.
      'playwright/no-conditional-in-test': 'off',
      'playwright/no-conditional-expect': 'off',
      'playwright/no-force-option': 'off',
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
