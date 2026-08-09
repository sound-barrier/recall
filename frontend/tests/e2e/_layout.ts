/**
 * Dossier-layout seeding for specs that exercise gallery (opt-in)
 * widgets. The climb-focused install default no longer ships the
 * volume/review widgets, so a spec pinning one seeds a stored layout
 * holding exactly the widgets it asserts on — faster and less
 * brittle than clicking through the "+ Add" menu per test.
 *
 * Stamps the CURRENT layout version so the one-shot migrations
 * treat the seed as already-migrated user state. Call BEFORE
 * page.goto().
 */
import type { Page } from '@playwright/test'

// Mirrors CURRENT_LAYOUT_VERSION in useDashboardLayout.ts. If a new
// migration bumps that constant, bump this too — otherwise seeded
// layouts get re-shaped before the spec's assertions run.
export const SEEDED_LAYOUT_VERSION = '2'

export async function seedDossierLayout(
  page: Page,
  layout: Record<number, string[]>,
): Promise<void> {
  await page.addInitScript(({ layout, version }) => {
    localStorage.setItem('recall.dashboard.layout', JSON.stringify(layout))
    localStorage.setItem('recall.dashboard.layoutVersion', version)
  }, { layout, version: SEEDED_LAYOUT_VERSION })
}
