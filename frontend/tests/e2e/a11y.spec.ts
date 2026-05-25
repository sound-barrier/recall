/**
 * Accessibility audits via axe-core. One test per major view.
 *
 * Baseline policy: zero violations on wcag2a/wcag2aa/wcag21a/wcag21aa.
 * Don't silence axe rules globally (e.g. `.disableRules(['color-
 * contrast'])`) — that hides ALL new contrast bugs across the app.
 *
 * Sister file: smoke.spec.ts (functional smoke + keyboard nav).
 */
import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

const VIEWS: { name: string; tabId: string }[] = [
  { name: 'matches (default landing)', tabId: 'tab-matches' },
  { name: 'settings',                  tabId: 'tab-settings' },
  { name: 'ingest',                    tabId: 'tab-ingest' },
  { name: 'unknown',                   tabId: 'tab-unknown' },
]

// Force `prefers-reduced-motion: reduce` for every a11y test so the
// site's @media rule collapses every animation/transition to 0.01ms.
// Without this, axe-core's color-contrast check samples mid-animation
// alpha (the view-fade-in keyframes ramp opacity 0→1 over 360ms) and
// reports false negatives on perfectly legible colors. Setting it via
// `use.reducedMotion` in playwright.config.ts has no effect — the
// project-level `use: { ...devices['Desktop Chrome'] }` shadows the
// top-level, and re-asserting it inside the project still doesn't
// take. page.emulateMedia() is the only reliable lever as of
// Playwright 1.60. Accessibility audits SHOULD run in reduced-motion
// mode anyway — animations must not mask contrast issues.
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
})

for (const view of VIEWS) {
  test(`a11y: ${view.name} view has no axe violations`, async ({ page }) => {
    await page.goto('/')
    await page.locator(`#${view.tabId}`).click()
    await expect(page.locator(`#${view.tabId}`)).toHaveAttribute('aria-selected', 'true')

    const results = await new AxeBuilder({ page })
      // wcag2a + wcag2aa is the standard combination most regulators
      // and contracts care about. wcag21a/wcag21aa adds the WCAG 2.1
      // additions (mobile, low-vision); fine to include on a desktop
      // app since they're additive.
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])
  })
}
