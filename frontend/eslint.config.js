import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'

export default tseslint.config(
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
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    // Tell vue-eslint-parser to hand <script lang="ts"> blocks to the TS parser.
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
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
