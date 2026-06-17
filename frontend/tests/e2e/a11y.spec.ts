/**
 * Accessibility audits via axe-core.
 *
 * Two loops:
 *   1. Every major VIEW against the dark theme (the bulk of the
 *      contrast tuning anchors here).
 *   2. The matches view across every THEME so the other three
 *      palettes (day / night / high-contrast) get color-contrast
 *      coverage too — matches is the most visually-dense view, so
 *      whatever palette-specific contrast issues exist will show up
 *      there first.
 *
 * Baseline policy: zero violations on wcag2a/wcag2aa/wcag21a/wcag21aa.
 * Don't silence axe rules globally (e.g. `.disableRules(['color-
 * contrast'])`) — that hides ALL new contrast bugs across the app.
 *
 * Sister file: smoke.spec.ts (functional smoke + keyboard nav).
 */
import AxeBuilder from '@axe-core/playwright'

import { test, expect } from './_fixtures'

const VIEWS: { name: string; tabId: string }[] = [
  { name: 'matches (default landing)', tabId: 'tab-matches' },
  { name: 'settings',                  tabId: 'tab-settings' },
  { name: 'ingest',                    tabId: 'tab-ingest' },
  { name: 'unknown',                   tabId: 'tab-unknown' },
]

const THEMES = ['day', 'dark', 'night', 'high-contrast'] as const

// Force `prefers-reduced-motion: reduce` for every a11y test so the
// site's @media rule collapses every animation/transition to 0.01ms.
// Without this, axe-core's color-contrast check samples mid-animation
// alpha (the view-fade-in keyframes ramp opacity 0→1 across the
// page-fade duration) and reports false negatives on perfectly
// legible colors. Setting it via
// `use.reducedMotion` in playwright.config.ts has no effect — the
// project-level `use: { ...devices['Desktop Chrome'] }` shadows the
// top-level, and re-asserting it inside the project still doesn't
// take. page.emulateMedia() is the only reliable lever as of
// Playwright 1.60. Accessibility audits SHOULD run in reduced-motion
// mode anyway — animations must not mask contrast issues.
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
})

async function pinTheme(page: import('@playwright/test').Page, theme: string) {
  await page.addInitScript((t) => {
    try { localStorage.setItem('recall.theme', t) } catch (_) {}
  }, theme)
}

async function runAxe(page: import('@playwright/test').Page) {
  // wcag2a + wcag2aa is the standard combination most regulators
  // and contracts care about. wcag21a/wcag21aa adds the WCAG 2.1
  // additions (mobile, low-vision); fine to include on a desktop
  // app since they're additive.
  return new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
}

// Wait for a freshly-mounted lazy view to finish its entrance fade before
// axe samples colors. The views are `defineAsyncComponent`s, so clicking a
// tab flips its `aria-selected` synchronously but the panel mounts a beat
// later and runs the `view-fade-in` keyframes (opacity 0→1). Playwright
// treats an opacity:0 element as "visible", so `toBeVisible()` can return
// mid-fade — axe then reads the ramped alpha and reports dozens of false
// color-contrast violations (observed: ~42 on the settings view, an
// intermittent CI red). Awaiting the panel subtree's finite animations
// settles that deterministically; the `iterations !== Infinity` filter
// skips looping animations (e.g. the `pulse-dot` spinner) so the wait can
// never hang, and views that don't fade (matches) simply have nothing to
// await.
async function settleView(page: import('@playwright/test').Page, tabId: string) {
  const panel = page.locator(`#${tabId.replace('tab-', 'panel-')}`)
  await expect(panel).toBeVisible()
  await panel.evaluate((el) =>
    Promise.all(
      el
        .getAnimations({ subtree: true })
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  )
}

// Loop 1: every view × dark theme.
for (const view of VIEWS) {
  test(`a11y: ${view.name} view (dark theme) has no axe violations`, async ({ page }) => {
    await pinTheme(page, 'dark')
    await page.goto('/')
    await page.locator(`#${view.tabId}`).click()
    await expect(page.locator(`#${view.tabId}`)).toHaveAttribute('aria-selected', 'true')
    await settleView(page, view.tabId)

    const results = await runAxe(page)
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])
  })
}

// Loop 2: matches view × each theme (dark already covered above but
// rerunning is cheap and keeps the loop reading symmetrically).
for (const theme of THEMES) {
  test(`a11y: matches view (${theme} theme) has no axe violations`, async ({ page }) => {
    await pinTheme(page, theme)
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('#tab-matches')).toHaveAttribute('aria-selected', 'true')
    await settleView(page, 'tab-matches')

    const results = await runAxe(page)
    expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])
  })
}
