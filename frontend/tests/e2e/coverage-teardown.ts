import { CoverageReport } from 'monocart-coverage-reports'

import { COVERAGE_ENABLED, coverageOptions } from './coverage-options'

// Playwright globalTeardown: fold the per-test V8 coverage the page fixture
// cached into one report (lcov + cobertura + html) under
// coverage/e2e/frontend/. No-op unless E2E_COVERAGE=1.
export default async function globalTeardown(): Promise<void> {
  if (!COVERAGE_ENABLED) return
  await new CoverageReport(coverageOptions).generate()
}
