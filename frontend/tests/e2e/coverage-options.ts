/**
 * monocart-coverage-reports config shared by the Playwright e2e suite.
 *
 * When E2E_COVERAGE=1, the `_fixtures` page fixture collects Playwright's
 * built-in V8 JS coverage (Chromium only) per test and feeds it to monocart,
 * which remaps the bundled JS back to the original .ts/.vue source via the
 * inline source maps the E2E_COVERAGE Vite build emits (see vite.config.ts).
 * globalSetup cleans the on-disk cache; globalTeardown generates the reports.
 *
 * Output (relative to the Playwright cwd, frontend/) lands in the repo's
 * coverage/e2e/frontend/ — lcov.info + cobertura.xml for the PR report, plus
 * an HTML report for humans.
 */
import type { CoverageReportOptions } from 'monocart-coverage-reports'

export const COVERAGE_ENABLED = !!process.env.E2E_COVERAGE

export const coverageOptions: CoverageReportOptions = {
  name: 'Recall E2E (frontend)',
  outputDir: '../coverage/e2e/frontend',
  reports: ['console-summary', 'lcov', 'cobertura', 'html'],
  // After source-map remapping, keep only the app's own source — drop
  // node_modules, Vite-injected helpers, and anonymous/eval scripts.
  sourceFilter: (sourcePath: string) => sourcePath.includes('src/') && !sourcePath.includes('node_modules'),
  // The console-summary report prints the total; silence the per-add noise.
  logging: 'error',
}
