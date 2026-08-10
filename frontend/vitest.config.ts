import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // The real Wails runtime schedules a module-level setTimeout on
      // import (dist/drag.js) that can fire after happy-dom tears the
      // environment down — an uncaught "window is not defined" that
      // fails the whole run even with every test green. Unit tests
      // never exercise Wails IPC (IS_WAILS is false), so the module
      // resolves to an inert stub. See wails-runtime-stub.ts.
      '@wailsio/runtime': fileURLToPath(new URL('./src/test-utils/wails-runtime-stub.ts', import.meta.url)),
    },
  },
  test: {
    // Unit tests live as src/**/*.test.ts. Playwright e2e specs in
    // tests/e2e/*.spec.ts use a different runner and must not be picked
    // up here — without this scope Vitest tries to import them and
    // crashes on Playwright's test() being called outside a Playwright
    // runner.
    include: ['src/**/*.test.ts'],
    setupFiles: ['./src/test-utils/vitest.setup.ts'],
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
      // json-summary is the machine-readable per-file table a coverage push
      // works from (which files still carry uncovered branches, and how many).
      reporter: ['text', 'lcov', 'html', 'cobertura', 'json-summary'],
      include: ['src/**/*.ts', 'src/**/*.vue'],
      // src/client is generated (@hey-api/openapi-ts) — excluded so the
      // coverage floors measure authored code only.
      exclude: ['src/**/*.d.ts', 'src/**/*.test.ts', 'src/client/**'],
      // Project-wide floors. When `npm run test:coverage` (or
      // `task cover-frontend`) runs, vitest exits non-zero if any of
      // these aren't met. Update them deliberately — a PR that
      // ratchets them upward is the safest way to lock in coverage.
      //
      // All four sit at CONTRIBUTING's ratchet — floor(measured) − 2 —
      // against what the full-testing campaign left behind (93.8 lines /
      // 85.1 branches / 91.8 statements / 88.7 functions). That clears
      // the stackable parity bar (85 lines / 80 branches) by a wide
      // margin, so the parity numbers are history, not the gate: these
      // are. Two points is the whole tolerance, which is deliberate —
      // it is enough for an incidental refactor and not enough to land
      // a feature with its tests missing.
      //
      // The onboarding tour is no longer the exception it once was.
      // Its geometry (ResizeObserver, getBoundingClientRect, SVG mask
      // placement) still can't be unit-tested against happy-dom's
      // zeroed rects, but the pure decisions — mask rect, callout
      // flip/clamp, step reachability — were extracted into testable
      // kernels, so only the shells lean on the e2e walk in
      // onboarding-tour-spotlight.spec.ts.
      thresholds: {
        statements: 89,
        branches:   83,
        functions:  86,
        lines:      91,
      },
    },
  },
})
