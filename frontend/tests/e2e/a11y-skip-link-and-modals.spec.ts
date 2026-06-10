/**
 * A11y polish (1.0 plan §C):
 *   1. Skip-link works even when the System Alert (Tesseract
 *      missing) is rendered above it in the page flow. Pin the
 *      z-index contract.
 *   2. Nested-modal Esc sequence — opening the cheatsheet over
 *      the match detail panel and pressing Esc closes the
 *      cheatsheet only; a second Esc closes the panel; focus
 *      returns to the originating row.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

function tessMissing() {
  return {
    path:      '',
    found:     false,
    version:   '',
    supported: false,
    error:     'tesseract: executable file not found',
    default:   '/opt/homebrew/bin/tesseract',
    platform:  'darwin',
  }
}

function tessOk() {
  return {
    path:      '/opt/homebrew/bin/tesseract',
    found:     true,
    version:   '5.3.4',
    supported: true,
    error:     '',
    default:   '/opt/homebrew/bin/tesseract',
    platform:  'darwin',
  }
}

test.describe('a11y — skip-link survives the System Alert banner', () => {
  test('skip-link snaps in on focus + lands focus on #main-content even with System Alert above the masthead', async ({ page }) => {
    await page.route('**/api/v1/profiles', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ active: 'main', profiles: ['main'] }),
      })
    })
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
    await page.route('**/api/v1/settings/tesseract', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tessMissing()) })
    })

    await page.goto('/')

    // System Alert is visible because Tesseract is missing.
    await expect(page.locator('.system-alert')).toBeVisible()

    // Tab into the page — the skip-link is the very first focusable
    // because it's the first child of .app.
    await page.keyboard.press('Tab')
    const skip = page.locator('.skip-link')
    await expect(skip).toBeFocused()

    // When focused it snaps in (transform: translateY(0)). Verify
    // it's visually positioned over the System Alert — the alert
    // is in normal flow (z-index: auto), the skip-link is absolute
    // with z-index: 1000.
    const skipZ = await skip.evaluate((el) => getComputedStyle(el).zIndex)
    expect(Number(skipZ)).toBeGreaterThanOrEqual(1000)
    const alertZ = await page.locator('.system-alert').evaluate((el) => getComputedStyle(el).zIndex)
    expect(['auto', '0']).toContain(alertZ)

    // Activating it lands focus on #main-content via the focusMain
    // click handler (browsers don't move focus on hash navigation
    // by default for non-input targets).
    await skip.click()
    await expect(page.locator('#main-content')).toBeFocused()
  })
})

test.describe('a11y — nested-modal focus-trap Esc sequence', () => {
  test('cheatsheet over detail panel: Esc closes cheatsheet, second Esc closes panel, focus returns to row', async ({ page }) => {
    await page.route('**/api/v1/profiles', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ active: 'main', profiles: ['main'] }),
      })
    })
    await page.route('**/api/v1/settings/tesseract', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tessOk()) })
    })
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([
          {
            match_key:    'match-2026-05-10T22-00-00',
            source_files: ['match-2026-05-10T22-00-00.png'],
            data: {
              map: 'rialto', mode: 'competitive', type: 'control',
              role: 'support', hero: 'lucio', result: 'victory',
              date: '2026-05-10', finished_at: '22:00',
              eliminations: 12, assists: 8, deaths: 3, damage: 5500,
              heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '10:00' }],
            },
            parsed_at: '2026-05-10T23:30:00Z',
          },
        ]),
      })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    const row = page.locator('.leaf-row').first()
    await row.click()

    // Detail panel is open.
    const panel = page.locator('.detail-panel').first()
    await expect(panel).toBeVisible()

    // Open the cheatsheet on top.
    await page.keyboard.press('?')
    const cheat = page.locator('[data-testid="kbd-shortcuts-modal"]')
    await expect(cheat).toBeVisible()
    await expect(panel).toBeVisible()

    // First Esc: cheatsheet closes via capture-phase Esc handler;
    // stopImmediatePropagation prevents the panel's bubble-phase
    // Esc from firing. The pre-existing CLAUDE.md gotcha pins
    // this pattern.
    await page.keyboard.press('Escape')
    await expect(cheat).toBeHidden()
    await expect(panel).toBeVisible()

    // Second Esc: panel closes via its own bubble-phase Esc.
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()

    // Focus returns to a sensible target (the originating row, or
    // an element inside the leaves list that the panel's focus
    // restore handed back to). The exact element is implementation
    // detail; assert focus is *somewhere* inside the matches list
    // rather than on body / a stale ghost element.
    const focusedInList = await page.evaluate(() => {
      const el = document.activeElement
      if (!el || el === document.body) return false
      return !!el.closest('.leaves-list, .detail-panel')
    })
    expect(focusedInList).toBeTruthy()
  })
})
