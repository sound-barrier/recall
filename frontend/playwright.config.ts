/**
 * Playwright config — browser E2E for the Recall server-mode UI.
 *
 * The `webServer` block boots a pre-built `recall-server` binary
 * against a temp HOME and a non-default port (7099 instead of 7000)
 * so the suite stays hermetic — no collision with a dev server, no
 * touch on the real ~/Library/Application Support/Recall/ data.
 *
 * The binary is built by `task test-e2e` before Playwright runs;
 * the config assumes `/tmp/recall-e2e/recall-server` exists. CI's
 * e2e.yml does the same build + run sequence.
 */
import { defineConfig, devices } from '@playwright/test'

// Port can be overridden via E2E_PORT so a parallel-running tool
// (e.g. the lefthook schemathesis hook, which also binds 7099) can
// avoid colliding with this run. Default stays 7099 so task test-e2e
// + CI's e2e.yml keep working unchanged.
const E2E_PORT = Number(process.env.E2E_PORT ?? '7099')
const E2E_HOME = '/tmp/recall-e2e'

export default defineConfig({
  testDir: './tests/e2e',
  // Sequential by default — the server is a single process with shared
  // SQLite state, so parallel tests within a worker would race.
  fullyParallel: false,
  workers: 1,
  // Fail the build on `.only` slipping into CI.
  forbidOnly: !!process.env.CI,
  // Zero tolerance for flakes. A retry-pass would mask a race
  // condition or a brittle assertion; fix the underlying test
  // instead. Locally this also stops a "run it again, it'll work"
  // habit from forming.
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

  // Snapshot path: drop the default {projectName}-{platform} suffix
  // so OS-independent structural snapshots (JSON shape) can be
  // committed once and shared across macOS local + Linux CI. Pixel
  // snapshots would still need the suffix, but the suite doesn't
  // ship any pixel snapshots — `toHaveScreenshot()` would flake on
  // OS rendering drift. See `a11y-high-contrast-snapshot.spec.ts`
  // for the JSON-snapshot pattern.
  snapshotPathTemplate: '{testDir}/{testFileName}-snapshots/{arg}{ext}',

  // E2E coverage plumbing (active only when E2E_COVERAGE=1, otherwise both
  // are cheap no-ops): globalSetup wipes the stale V8-coverage cache,
  // globalTeardown folds the per-test coverage the page fixture collected
  // into coverage/e2e/frontend/. See tests/e2e/coverage-options.ts.
  globalSetup: './tests/e2e/coverage-setup.ts',
  globalTeardown: './tests/e2e/coverage-teardown.ts',

  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // WebKit (Safari engine) = the macOS Wails WKWebView the desktop app
      // renders in. Scoped to the `*-webkit.spec.ts` regression specs so the
      // main suite stays Chromium-only (sane wall-time), while engine-specific
      // bugs the desktop app hits — but Chromium/Firefox don't — get a guard.
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testMatch: /.*-webkit\.spec\.ts$/,
    },
  ],

  webServer: {
    command: `${E2E_HOME}/recall-server`,
    url: `http://127.0.0.1:${E2E_PORT}`,
    env: {
      HOME: E2E_HOME,
      RECALL_SERVER_ADDR: `127.0.0.1:${E2E_PORT}`,
      // Pin RECALL_DATA_DIR explicitly so the e2e suite stays hermetic
      // even when mise has exported `RECALL_DATA_DIR=<repo>/data` in
      // the shell `task test-e2e` is invoked from. Without this,
      // appDataDir() falls through to the env var and the server
      // reads/writes the repo's dev SQLite — leaking real records into
      // the tests and breaking the "fresh empty server" assumption
      // the a11y + match-* specs depend on.
      RECALL_DATA_DIR: `${E2E_HOME}/data`,
      // Go binary-coverage output dir (e2e-coverage run only). The
      // `-cover` server flushes its counters here on graceful shutdown;
      // an uninstrumented binary ignores it. Absent → not forwarded.
      ...(process.env.GOCOVERDIR ? { GOCOVERDIR: process.env.GOCOVERDIR } : {}),
    },
    // Locally, keep an already-running server alive across re-runs
    // (saves the ~5s boot per iteration). CI gets a fresh server.
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    // Stop the server with SIGTERM (not the default SIGKILL) so it runs
    // its graceful shutdown — which is what flushes Go binary-coverage
    // counters to GOCOVERDIR. Harmless for non-coverage runs.
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
