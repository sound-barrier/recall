// Minimal ESLint flat config for the complexity sweep ONLY.
//
// This is a SEPARATE config from the project's main `eslint.config.js`
// because we want to run a single rule (`complexity`) at "warn" level
// without inheriting the project's hundreds of other rules — those
// would drown out the complexity findings under unrelated noise.
//
// Consumed by `scripts/check-complexity.sh` (which is wired into
// `make complexity-frontend`, the `pre-push.complexity` lefthook
// hook, and the CI `complexity` job).
//
// Threshold: 10 (McCabe's original recommendation in his 1976 paper).
// Tune in one place: the rule value below.

import tseslint from 'typescript-eslint'
import vueParser from 'vue-eslint-parser'

export default [
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    rules: {
      complexity: ['warn', 10],
    },
  },
  {
    files: ['src/**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    rules: {
      complexity: ['warn', 10],
    },
  },
]
