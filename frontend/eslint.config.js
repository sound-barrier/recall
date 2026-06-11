import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'

export default tseslint.config(
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
)
