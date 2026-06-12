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
      map: 'rialto', playlist: 'competitive', game_mode: 'control',
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
    // Default order: Campaign Log, Geography, Hero × Game-Mode.
    const order = () => page.locator('[data-section]').evaluateAll(
      (els) => els.map((e) => e.getAttribute('data-section')),
    )
    expect(await order()).toEqual(['campaign-log', 'geography', 'hero-game-mode'])

    // Keyboard-move the Campaign Log down past Geography via its grip.
    await page.locator('[data-section-grip="campaign-log"]').focus()
    await page.keyboard.press('ArrowDown')
    await expect.poll(order).toEqual(['geography', 'campaign-log', 'hero-game-mode'])

    await page.reload()
    await page.locator('#tab-matches').click()
    await expect.poll(order).toEqual(['geography', 'campaign-log', 'hero-game-mode'])
  })

  test('the Add menu opens fully within the viewport', async ({ page }) => {
    await page.locator('[data-dossier-add]').click()
    const panel = page.locator('.dossier-manage-panel')
    await expect(panel).toBeVisible()
    const box = await panel.boundingBox()
    const vp = page.viewportSize()
    expect(box).not.toBeNull()
    expect(vp).not.toBeNull()
    // Fully on-screen: no edge spills past the viewport.
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(vp!.width + 1)
  })

  test('widget manage controls are hidden at rest and reveal on hover', async ({ page }) => {
    const controls = page.locator('[data-widget-id="winrate"] [data-widget-controls]')
    await expect(controls).toHaveCSS('opacity', '0')
    await page.locator('[data-widget-id="winrate"]').hover()
    await expect(controls).toHaveCSS('opacity', '1')
  })

  test('the Campaign Log removes via its inline control (not occluded by the dossier)', async ({ page }) => {
    await expect(page.locator('[data-section="campaign-log"]')).toBeVisible()
    // Would throw "intercepts pointer events" if the control sat behind
    // the dossier — the regression this guards.
    await page.locator('[data-section-remove="campaign-log"]').click()
    await expect(page.locator('[data-section="campaign-log"]')).toHaveCount(0)
  })

  test('section manage controls are hidden at rest and reveal on hover', async ({ page }) => {
    const chrome = page.locator('[data-section="geography"] [data-section-chrome]')
    await expect(chrome).toHaveCSS('opacity', '0')
    await page.locator('[data-section="geography"]').hover()
    await expect(chrome).toHaveCSS('opacity', '1')
  })

  test('the dossier, Campaign Log and Geography are evenly spaced', async ({ page }) => {
    const r = await page.evaluate(() => {
      const box = (sel: string) => {
        const el = document.querySelector(sel)
        return el ? { top: el.getBoundingClientRect().top, bottom: el.getBoundingClientRect().bottom } : null
      }
      return { dossier: box('.set-dossier'), campaign: box('.match-timeline'), geo: box('.match-map-role') }
    })
    expect(r.dossier && r.campaign && r.geo).toBeTruthy()
    const dossierToCampaign = r.campaign!.top - r.dossier!.bottom
    const campaignToGeo = r.geo!.top - r.campaign!.bottom
    // Uniform rhythm — the dossier→first-band gap matches the band→band gap.
    expect(Math.abs(dossierToCampaign - campaignToGeo)).toBeLessThanOrEqual(2)
  })
})
