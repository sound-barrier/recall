import { CoverageReport } from 'monocart-coverage-reports'

import { COVERAGE_ENABLED, coverageOptions } from './coverage-options'

// Playwright globalSetup: wipe any stale V8-coverage cache so a re-run
// doesn't fold in coverage from a previous suite. No-op unless
// E2E_COVERAGE=1 (the normal e2e run pays nothing).
export default async function globalSetup(): Promise<void> {
  if (!COVERAGE_ENABLED) return
  await new CoverageReport(coverageOptions).cleanCache()
}
