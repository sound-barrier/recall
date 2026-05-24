import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  test: {
    // Unit tests live as src/**/*.test.ts. Playwright e2e specs in
    // tests/e2e/*.spec.ts use a different runner and must not be picked
    // up here — without this scope Vitest tries to import them and
    // crashes on Playwright's test() being called outside a Playwright
    // runner.
    include: ['src/**/*.test.ts'],
    // Composable tests need a DOM + localStorage; all tests use happy-dom
    // so the same environment is available everywhere (pure-function tests
    // are unaffected since they don't use any browser APIs).
    environment: 'happy-dom',
    coverage: {
      provider: 'v8',
      // cobertura is the format the PR coverage-comment job in CI feeds
      // into irongut/CodeCoverageSummary; keeping it on the local
      // reporter list means `make cover-frontend` produces the same
      // artifact that CI does (one less drift risk).
      reporter: ['text', 'lcov', 'html', 'cobertura'],
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
