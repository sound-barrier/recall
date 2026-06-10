/**
 * Dossier customization with NO edit mode:
 *   - Every widget always carries its drag grip + trash (hover-revealed);
 *     clicking trash removes it straight away — no mode to enter first.
 *   - The "Add" button opens a compact dropdown of removed widgets +
 *     removed sections, each with a + to re-add, plus Reset.
 *   - Campaign Log + Geography are full-width SECTIONS below the dossier
 *     grid, each with an inline × to remove; re-add from the same menu.
 */
import { test, expect } from './_fixtures'
import type { Route } from '@playwright/test'

const RECENT = (() => { const d = new Date(); d.setDate(d.getDate() - 3); return d.toISOString().slice(0, 10) })()

function singleMatch() {
  return {
    match_key: 'm1',
    source_files: ['m1.png'],
    source_types: { 'm1.png': 'summary' },
    data: {
      map: 'rialto', mode: 'competitive', type: 'control',
      role: 'support', hero: 'lucio',
      result: 'victory', date: RECENT, finished_at: '22:00',
      eliminations: 17, assists: 16, deaths: 11,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '11:25' }],
    },
    parsed_at: `${RECENT}T22:30:00Z`,
  }
}

test.describe('dossier customize — no edit mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([singleMatch()]),
      })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.set-dossier')).toBeVisible()
  })

  test('a widget carries an always-present trash; clicking it removes the widget; reload persists', async ({ page }) => {
    await expect(page.locator('[data-widget-id="winrate"]')).toBeVisible()
    // No edit mode — the trash is in the DOM already (CSS hover-reveals it).
    const trash = page.locator('[data-widget-remove="winrate"]')
    await expect(trash).toHaveCount(1)
    await trash.click()
    await expect(page.locator('[data-widget-id="winrate"]')).toHaveCount(0)

    await page.reload()
    await page.locator('#tab-matches').click()
    await expect(page.locator('[data-widget-id="winrate"]')).toHaveCount(0)
  })

  test('the Add menu re-adds a removed widget', async ({ page }) => {
    await page.locator('[data-widget-remove="winrate"]').click()
    await expect(page.locator('[data-widget-id="winrate"]')).toHaveCount(0)

    await page.locator('[data-dossier-add]').click()
    const addBtn = page.locator('[data-widget-add="winrate"]')
    await expect(addBtn).toBeVisible()
    await addBtn.click()
    await expect(page.locator('[data-widget-id="winrate"]')).toBeVisible()
    // Added → no longer offered in the menu.
    await expect(addBtn).toHaveCount(0)
  })

  test('Reset restores the install default', async ({ page }) => {
    await page.locator('[data-widget-remove="winrate"]').click()
    await expect(page.locator('[data-widget-id="winrate"]')).toHaveCount(0)

    await page.locator('[data-dossier-add]').click()
    await page.locator('[data-reset-layout]').click()
    await expect(page.locator('[data-widget-id="winrate"]')).toBeVisible()
  })

  test('Escape closes the Add menu', async ({ page }) => {
    await page.locator('[data-dossier-add]').click()
    await expect(page.locator('[data-reset-layout]')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-reset-layout]')).toHaveCount(0)
    await expect(page.locator('[data-widget-id="winrate"]')).toBeVisible()
  })

  test('sections (Campaign Log + Geography) remove inline and re-add from the menu', async ({ page }) => {
    await expect(page.locator('[data-section="campaign-log"]')).toBeVisible()
    await expect(page.locator('[data-section="geography"]')).toBeVisible()

    // Remove Geography via its inline ×.
    await page.locator('[data-section-remove="geography"]').click()
    await expect(page.locator('[data-section="geography"]')).toHaveCount(0)
    // Campaign Log is untouched.
    await expect(page.locator('[data-section="campaign-log"]')).toBeVisible()

    // Re-add Geography from the Add menu.
    await page.locator('[data-dossier-add]').click()
    await page.locator('[data-section-add="geography"]').click()
    await expect(page.locator('[data-section="geography"]')).toBeVisible()
  })

  test('section reorder via the grip persists', async ({ page }) => {
    // Default order: Campaign Log then Geography.
    const order = () => page.locator('[data-section]').evaluateAll(
      (els) => els.map((e) => e.getAttribute('data-section')),
    )
    expect(await order()).toEqual(['campaign-log', 'geography'])

    // Keyboard-move the Campaign Log down past Geography via its grip.
    await page.locator('[data-section-grip="campaign-log"]').focus()
    await page.keyboard.press('ArrowDown')
    await expect.poll(order).toEqual(['geography', 'campaign-log'])

    await page.reload()
    await page.locator('#tab-matches').click()
    await expect.poll(order).toEqual(['geography', 'campaign-log'])
  })
})
