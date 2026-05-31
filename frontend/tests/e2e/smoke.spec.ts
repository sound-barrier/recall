/**
 * Smoke tests — bare-minimum guarantees that the server-mode UI
 * loads in a real browser and the major a11y patterns this session
 * landed (modal focus trap, tablist arrow-key nav, skip-link) still
 * work end-to-end.
 *
 * Sister file: a11y.spec.ts (axe-core audits per view).
 */
import { test, expect } from './_fixtures'

test.describe('smoke — page loads + navigation', () => {
  test('masthead renders with the RECALL wordmark', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.masthead')).toBeVisible()
    await expect(page.locator('.brand')).toContainText(/RECALL/i)
  })

  test('all four tabs are reachable by click', async ({ page }) => {
    await page.goto('/')
    for (const id of ['tab-settings', 'tab-ingest', 'tab-matches', 'tab-unknown']) {
      await page.locator(`#${id}`).click()
      await expect(page.locator(`#${id}`)).toHaveAttribute('aria-selected', 'true')
    }
  })
})

test.describe('a11y patterns — keyboard navigation', () => {
  // Mirrors the unit test in App.test.ts but in a real browser, where
  // focus management and CSS-driven visibility actually matter.
  test('tablist Arrow keys move selection (automatic activation)', async ({ page }) => {
    await page.goto('/')
    // The arrow-key handler is wired on <nav role="tablist">, but
    // <nav> isn't focusable — Locator.press() against it silently
    // no-ops. Press on a focusable tab button instead; the keydown
    // bubbles up to the nav listener.
    //
    // Click Settings first to set view='settings' as the baseline
    // (the handler reads view.value, not focus).
    await page.locator('#tab-settings').click()
    await expect(page.locator('#tab-settings')).toHaveAttribute('aria-selected', 'true')

    // ArrowRight → Ingest. The handler re-focuses the new tab after
    // goToView completes (see App.vue onTabKeydown), so subsequent
    // presses can target whichever button is currently active.
    await page.locator('#tab-settings').press('ArrowRight')
    await expect(page.locator('#tab-ingest')).toHaveAttribute('aria-selected', 'true')

    // End → Unknown (last tab)
    await page.locator('#tab-ingest').press('End')
    await expect(page.locator('#tab-unknown')).toHaveAttribute('aria-selected', 'true')

    // Home → Settings (first tab)
    await page.locator('#tab-unknown').press('Home')
    await expect(page.locator('#tab-settings')).toHaveAttribute('aria-selected', 'true')

    // ArrowLeft from Settings wraps to Unknown
    await page.locator('#tab-settings').press('ArrowLeft')
    await expect(page.locator('#tab-unknown')).toHaveAttribute('aria-selected', 'true')

    // Vim-style h / l aliases — l advances right, h walks left.
    // Same handler as ArrowLeft/ArrowRight, just an alternate key.
    await page.locator('#tab-settings').click()
    await page.locator('#tab-settings').press('l')
    await expect(page.locator('#tab-ingest')).toHaveAttribute('aria-selected', 'true')
    await page.locator('#tab-ingest').press('h')
    await expect(page.locator('#tab-settings')).toHaveAttribute('aria-selected', 'true')
  })

  test('skip-link is the first focusable + jumps to <main>', async ({ page }) => {
    await page.goto('/')
    // Tab once from the address bar → skip-link should grab focus.
    await page.keyboard.press('Tab')
    const focusedClass = await page.evaluate(() => document.activeElement?.className)
    expect(focusedClass).toContain('skip-link')

    // Activating the link moves focus to <main id="main-content">.
    await page.keyboard.press('Enter')
    const focusedId = await page.evaluate(() => document.activeElement?.id)
    expect(focusedId).toBe('main-content')
  })
})
