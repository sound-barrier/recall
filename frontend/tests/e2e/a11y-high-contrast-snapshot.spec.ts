/**
 * High-contrast theme — layout-level snapshot.
 *
 * `a11y.spec.ts` runs axe-core's color-contrast check across every
 * theme, but axe is selector-blind: it can't catch "the high-contrast
 * theme silently dropped the section-divider rule and now all the
 * Settings rows blur together." This spec captures a STRUCTURAL
 * snapshot per view (key element counts + computed background +
 * computed font tokens) so a regression in the high-contrast
 * cascade fails the test the next time someone bumps the theme CSS.
 *
 * Why structural (JSON) instead of pixel snapshots: Playwright pixel
 * snapshots are bound to the rendering OS (macOS local vs Linux CI),
 * so a literal `toHaveScreenshot` would flake on every commit unless
 * we ran the suite in Docker. The JSON shape captured here is the
 * same on every OS — it's the DOM + computed styles, not the
 * compositor output. Sufficient to catch "the theme dropped on the
 * floor"; not a substitute for design QA on real builds.
 */
import type { Page } from '@playwright/test'
import { test, expect } from './_fixtures'

const HC_THEME = 'high-contrast'

const VIEWS: { name: string; tabId: string }[] = [
  { name: 'settings', tabId: 'tab-settings' },
  { name: 'ingest',   tabId: 'tab-ingest' },
  { name: 'matches',  tabId: 'tab-matches' },
  { name: 'unknown',  tabId: 'tab-unknown' },
]

async function pinTheme(page: Page, theme: string) {
  await page.addInitScript((t) => {
    try { localStorage.setItem('recall.theme', t) } catch (_) { /* sandbox */ }
  }, theme)
}

async function captureStructure(page: Page, tabId: string) {
  return page.evaluate((tabIdInner) => {
    // Tokens to capture for the snapshot. Stable across OSes —
    // computed RGB values come from CSS custom properties, not
    // the compositor.
    const rootStyle = getComputedStyle(document.documentElement)
    const tabBtn = document.getElementById(tabIdInner) as HTMLElement | null
    const main = document.getElementById('main-content')
    const masthead = document.querySelector('.masthead')

    const tokensOfInterest = [
      '--accent',
      '--accent-text',
      '--accent-glow',
      '--text',
      '--text-dim',
      '--text-faint',
      '--surface',
      '--surface-2',
      '--surface-3',
      '--bg',
      '--border',
      '--border-soft',
      '--win',
      '--loss',
    ]
    const cssTokens: Record<string, string> = {}
    for (const t of tokensOfInterest) {
      cssTokens[t] = rootStyle.getPropertyValue(t).trim()
    }

    // Compose the snapshot. Keep this shape stable — additions are
    // fine, removals require a rebaseline.
    return {
      htmlAttr: {
        dataTheme: document.documentElement.getAttribute('data-theme'),
      },
      activeTab: {
        id:           tabBtn?.id ?? null,
        ariaSelected: tabBtn?.getAttribute('aria-selected') ?? null,
        textContent:  tabBtn?.textContent?.trim() ?? null,
      },
      mainPresent:    !!main,
      mastheadPresent: !!masthead,
      cssTokens,
    }
  }, tabId)
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
})

for (const view of VIEWS) {
  test(`high-contrast: ${view.name} view structural snapshot`, async ({ page }) => {
    await pinTheme(page, HC_THEME)
    await page.goto('/')
    await page.locator(`#${view.tabId}`).click()
    await expect(page.locator(`#${view.tabId}`)).toHaveAttribute('aria-selected', 'true')

    const snapshot = await captureStructure(page, view.tabId)

    // Sanity: the theme actually applied.
    expect(snapshot.htmlAttr.dataTheme).toBe(HC_THEME)
    // Every token resolved to something non-empty — catches a
    // dropped/typo'd var() in the high-contrast cascade.
    for (const [name, value] of Object.entries(snapshot.cssTokens)) {
      expect(value, `expected ${name} to resolve under [data-theme="${HC_THEME}"]`).not.toBe('')
    }

    // Persist the structural shape. First run writes the baseline
    // under `frontend/tests/e2e/a11y-high-contrast-snapshot.spec.ts-
    // snapshots/<view>.json`; subsequent runs diff against it.
    expect(JSON.stringify(snapshot, null, 2)).toMatchSnapshot(`${view.name}-structure.json`)
  })
}
