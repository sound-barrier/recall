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

// Mirrors CURRENT_LAYOUT_VERSION in dashboardLayout.migrations.ts. If a new
// migration bumps that constant, bump this too — otherwise seeded layouts get
// re-shaped before the spec's assertions run.
//
// It drifted exactly that way once: the v3 migration shipped while this stayed
// at '2', so every seeded layout was silently re-shaped (v3 inserts the
// rank-percentile widget) before ten specs made their assertions. Nothing
// failed, which is precisely the problem — those specs were asserting against a
// layout none of them had asked for. A unit test now pins the two together.
export const SEEDED_LAYOUT_VERSION = '3'

export async function seedDossierLayout(
  page: Page,
  layout: Record<number, string[]>,
): Promise<void> {
  await page.addInitScript(({ layout, version }) => {
    localStorage.setItem('recall.dashboard.layout', JSON.stringify(layout))
    localStorage.setItem('recall.dashboard.layoutVersion', version)
  }, { layout, version: SEEDED_LAYOUT_VERSION })
}
