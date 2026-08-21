/**
 * Accessibility audits via axe-core — every VIEW × every THEME.
 *
 * This used to be two partial loops: all views against `dark`, plus the
 * matches view against each theme. That covered 9 of the 24 cells and
 * left a hole exactly where the bugs were — Settings, Parse, Unknown,
 * Compare and Elo were never contrast-audited outside `dark`. The Day
 * palette deliberately splits `--accent` (chrome; bright OW orange) from
 * `--accent-text` (readable type; deeper rust), and the views outside
 * the audited cell had drifted onto `--accent` for small type, landing
 * at ~1.9:1 against the cream surface. Nothing failed, because nothing
 * looked.
 *
 * The matrix is now complete, and `_theme-matrix.ts` seeds a record
 * corpus so the dense surfaces (dossier widgets, Campaign Log, leaf
 * rows, rank block, unknown triage) actually render for axe instead of
 * every view showing its empty state.
 *
 * Baseline policy: zero violations on wcag2a/wcag2aa/wcag21a/wcag21aa.
 * Don't silence axe rules globally (e.g. `.disableRules(['color-
 * contrast'])`) — that hides ALL new contrast bugs across the app.
 *
 * Sister files: smoke.spec.ts (functional smoke + keyboard nav),
 * a11y-theme-snapshot.spec.ts (structural + design-system probes).
 */
import AxeBuilder from '@axe-core/playwright'

import { test, expect } from '../_fixtures'
import { VIEWS, THEMES, openView } from '../_theme-matrix'

// Force `prefers-reduced-motion: reduce` for every a11y test so the
// site's @media rule collapses every animation/transition to 0.01ms.
// Without this, axe-core's color-contrast check samples mid-animation
// alpha (the view-fade-in keyframes ramp opacity 0→1) and reports
// perfectly legible colors as failing. Setting it via `use.reducedMotion`
// in playwright.config.ts has no effect — the project-level
// `use: { ...devices['Desktop Chrome'] }` shadows the top-level, and
// re-asserting it inside the project still doesn't take.
// page.emulateMedia() is the only reliable lever as of Playwright 1.60.
// Accessibility audits SHOULD run in reduced-motion mode anyway —
// animations must not mask contrast issues.
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
})

async function runAx(page: import('@playwright/test').Page) {
  // wcag2a + wcag2aa is the standard combination most regulators
  // and contracts care about. wcag21a/wcag21aa adds the WCAG 2.1
  // additions (mobile, low-vision); fine to include on a desktop
  // app since they're additive.
  return new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
}

for (const theme of THEMES) {
  for (const view of VIEWS) {
    test(`a11y: ${view.name} view (${theme} theme) has no axe violations`, async ({ page }) => {
      await openView(page, view.tabId, theme)

      const results = await runAx(page)
      expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])
    })
  }

  // The hand-entry form, which the matrix above never reaches: it is a modal,
  // so every one of its controls is behind a click no view sweep performs. It
  // holds a note EDITOR now — a contenteditable that has to carry its own
  // accessible name, because `for` cannot point at one.
  test(`a11y: manual-entry modal (${theme} theme) has no axe violations`, async ({ page }) => {
    await openView(page, 'tab-matches', theme)
    await page.locator('[data-add-match]').click()
    await page.locator('[data-add-match-full]').click()
    await expect(page.locator('.mm-modal')).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Notes' })).toBeVisible()

    const results = await runAx(page)
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])
  })
}
