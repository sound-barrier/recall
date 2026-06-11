/**
 * Bulk-tag from selected rows (UI_RECOMMENDATIONS item 3).
 *
 * Select two rows → BulkActionBar surfaces "Tag ▾" menu → typing
 * + Enter (or click on a suggestion) appends the tag to every
 * selected match via one read-modify-write PUT per record. Reload
 * confirms the chip surfaces on every selected row.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

function record(matchKey: string, tags: string[] = []) {
  return {
    match_key: matchKey,
    source_files: [`${matchKey}.png`],
    data: {
      map: 'rialto',
      playlist: 'competitive',
      game_mode: 'control',
      role: 'support',
      hero: 'lucio',
      result: 'victory',
      date: matchKey.slice(6, 16),
      finished_at: '22:00',
      eliminations: 17,
      assists: 16,
      deaths: 11,
      damage: 7200,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '11:25' }],
    },
    parsed_at: `${matchKey.slice(6, 16)}T22:30:00Z`,
    ...(tags.length ? { annotation: { tags } } : {}),
  }
}

test.describe('bulk-tag', () => {
  test('typing a new tag + Enter writes it to every selected row', async ({ page }) => {
    const KEY_A = 'match-2026-05-10T22-00-00'
    const KEY_B = 'match-2026-05-11T22-00-00'
    const KEY_C = 'match-2026-05-12T22-00-00'
    const captured: Record<string, Record<string, unknown>> = {}
    const liveTags: Record<string, string[]> = {}

    await page.route('**/api/v1/matches', async (route: Route) => {
      const all = [record(KEY_A), record(KEY_B), record(KEY_C)].map((r) => {
        const t = liveTags[r.match_key] ?? []
        return t.length ? { ...r, annotation: { tags: t } } : r
      })
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(all),
      })
    })
    for (const key of [KEY_A, KEY_B, KEY_C]) {
      await page.route(`**/api/v1/matches/${encodeURIComponent(key)}/annotation`, async (route: Route) => {
        const body = JSON.parse(route.request().postData() ?? '{}')
        captured[key] = body
        liveTags[key] = (body?.tags as string[]) ?? []
        await route.fulfill({ status: 204, body: '' })
      })
    }

    await page.goto('/')
    await page.locator('#tab-matches').click()

    // Tick two of the three rows via the per-row checkbox affordance.
    const checkboxes = page.locator('.leaf-row .leaf-checkbox')
    await checkboxes.nth(0).click()
    await checkboxes.nth(1).click()

    // Bulk bar appears.
    await expect(page.locator('.bulk-action-bar')).toBeVisible()
    await page.locator('[data-bulk-menu="tag"]').click()

    // Type a new tag + Enter.
    const tagInput = page.locator('.bab-menu-tag input.combo-input')
    await tagInput.focus()
    await tagInput.fill('clutch')
    await tagInput.press('Enter')

    // Two PUTs fire; the third row stays unmodified.
    await expect.poll(() => Object.keys(captured).length).toBe(2)
    for (const key of Object.keys(captured)) {
      expect((captured[key]?.tags as string[]) ?? []).toContain('clutch')
    }
  })
})
