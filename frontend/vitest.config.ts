import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  test: {
    // Composable tests need a DOM + localStorage; all tests use happy-dom
    // so the same environment is available everywhere (pure-function tests
    // are unaffected since they don't use any browser APIs).
    environment: 'happy-dom',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts', 'src/**/*.vue'],
      exclude: ['src/**/*.d.ts', 'src/**/*.test.ts'],
      // Project-wide floors. When `npm run test:coverage` (or
      // `make cover-frontend`) runs, vitest exits non-zero if any of
      // these aren't met. Tuned a few points below the current state
      // (74.7 / 72.2 / 65.7 / 77.5 at the time of writing) so a real
      // regression trips the gate, while routine refactors don't.
      // Update these floors deliberately — a PR that ratchets them
      // upward is the safest way to lock in new coverage.
      thresholds: {
        statements: 70,
        branches:   60,
        functions:  55,
        lines:      70,
      },
    },
  },
})
