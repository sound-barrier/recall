/**
 * Filter-preset save & recall E2E.
 *
 * The FilterRail gains a "Presets" menu in the .filter-tools row that
 * lets the user persist + recall recurring filter combinations
 * (UI_RECOMMENDATIONS.md item #1). The flow exercised here:
 *
 *   1. open the Hero filter, pick a hero — engages a filter
 *   2. open Presets, click Save current — prompt asks for a name
 *   3. clear filters, confirm hero list returns
 *   4. open Presets again, click the saved entry — hero list narrows again
 *   5. presets survive a reload (localStorage-backed)
 *   6. delete the preset — menu returns to empty state
 *
 * Persistence is localStorage only — no backend route mocks needed
 * beyond /api/v1/matches.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

function record(matchKey: string, hero: string, map: string) {
  return {
    match_key: matchKey,
    source_files: [`${matchKey}.png`],
    data: {
      map,
      mode: 'competitive',
      type: 'control',
      role: 'support',
      hero,
      result: 'victory',
      date: '2026-05-10',
      finished_at: '22:00',
      eliminations: 17,
      assists: 16,
      deaths: 11,
      damage: 7200,
      heroes_played: [{ hero, percent_played: 100, play_time: '11:25' }],
    },
    parsed_at: '2026-05-10T22:30:00Z',
  }
}

const RECORDS = [
  record('match:1', 'juno', 'rialto'),
  record('match:2', 'lucio', 'rialto'),
  record('match:3', 'kiriko', 'ilios'),
]

test.describe('filter-preset save & recall', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(RECORDS),
      })
    })
    await page.goto('/')
    // Clear once after navigation. addInitScript was tempting but it
    // re-fires on every reload too, which would wipe a preset under
    // the test's own feet halfway through the save/reload/apply
    // round-trip.
    await page.evaluate(() => {
      try { localStorage.removeItem('recall.filterPresets') } catch (_) {}
    })
    await page.locator('#tab-matches').click()
    await expect(page.locator('.match')).toHaveCount(3)
  })

  test('save current filters → apply restores them → delete removes', async ({ page }) => {
    // Pick juno from the Hero filter — narrows to 1 match.
    await page.locator('button[aria-label*="Hero filter"]').click()
    await page.locator('.mf-row', { hasText: /^\s*juno\s*$/i }).click()
    await page.keyboard.press('Escape')
    await expect(page.locator('.match')).toHaveCount(1)

    // Open Presets menu. The trigger lives in .filter-tools alongside
    // the other compact pill buttons.
    const presetsTrigger = page.locator('button[aria-label*="Filter presets"]')
    await expect(presetsTrigger).toBeVisible()
    await presetsTrigger.click()

    // Save current — prompts for a name via window.prompt(). Stub the
    // browser dialog so the test never waits on a real prompt.
    page.once('dialog', async (dialog) => {
      expect(dialog.type()).toBe('prompt')
      await dialog.accept('Juno games')
    })
    await page.locator('button[data-preset-action="save"]').click()

    // Saved entry appears in the menu.
    const savedEntry = page.locator('button[data-preset-apply="Juno games"]')
    await expect(savedEntry).toBeVisible()

    // Close menu, clear filters → all 3 matches return.
    await page.keyboard.press('Escape')
    await page.locator('.btn.ghost.tiny.danger', { hasText: /clear filters/i }).click()
    await expect(page.locator('.match')).toHaveCount(3)

    // Re-open menu, click the saved preset → hero filter restored.
    await presetsTrigger.click()
    await page.locator('button[data-preset-apply="Juno games"]').click()
    await expect(page.locator('.match')).toHaveCount(1)

    // Preset survives a reload (localStorage).
    await page.reload()
    await page.locator('#tab-matches').click()
    await presetsTrigger.click()
    await expect(page.locator('button[data-preset-apply="Juno games"]')).toBeVisible()

    // Delete: the × button on the saved row removes it. A confirm()
    // gates the action; auto-accept so the test runs unattended.
    page.once('dialog', async (dialog) => {
      expect(dialog.type()).toBe('confirm')
      await dialog.accept()
    })
    await page.locator('button[data-preset-delete="Juno games"]').click()
    // After deletion the menu shows the empty hint.
    await expect(page.locator('button[data-preset-apply="Juno games"]')).toHaveCount(0)
    await expect(page.locator('.presets-empty')).toBeVisible()
  })

  test('cancelling the save prompt leaves no preset', async ({ page }) => {
    await page.locator('button[aria-label*="Hero filter"]').click()
    // Hero labels render through useOWData's heroDisplayName which
    // adds diacritics (Lúcio, Torbjörn) — Juno is plain ASCII so the
    // regex stays stable against display-name evolution.
    await page.locator('.mf-row', { hasText: /^\s*juno\s*$/i }).click()
    await page.keyboard.press('Escape')

    await page.locator('button[aria-label*="Filter presets"]').click()
    page.once('dialog', async (dialog) => { await dialog.dismiss() })
    await page.locator('button[data-preset-action="save"]').click()

    // Empty-state hint still visible.
    await expect(page.locator('.presets-empty')).toBeVisible()
  })
})
