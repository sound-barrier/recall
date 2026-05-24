/**
 * Playwright config — browser E2E for the Recall server-mode UI.
 *
 * The `webServer` block boots a pre-built `recall-server` binary
 * against a temp HOME and a non-default port (7099 instead of 7000)
 * so the suite stays hermetic — no collision with a dev server, no
 * touch on the real ~/Library/Application Support/Recall/ data.
 *
 * The binary is built by `make test-e2e` before Playwright runs;
 * the config assumes `/tmp/recall-e2e/recall-server` exists. CI's
 * e2e.yml does the same build + run sequence.
 */
import { defineConfig, devices } from '@playwright/test'

const E2E_PORT = 7099
const E2E_HOME = '/tmp/recall-e2e'

export default defineConfig({
  testDir: './tests/e2e',
  // Sequential by default — the server is a single process with shared
  // SQLite state, so parallel tests within a worker would race.
  fullyParallel: false,
  workers: 1,
  // Fail the build on `.only` slipping into CI.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

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
  ],

  webServer: {
    command: `${E2E_HOME}/recall-server`,
    url: `http://127.0.0.1:${E2E_PORT}`,
    env: {
      HOME: E2E_HOME,
      RECALL_SERVER_ADDR: `127.0.0.1:${E2E_PORT}`,
    },
    // Locally, keep an already-running server alive across re-runs
    // (saves the ~5s boot per iteration). CI gets a fresh server.
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
