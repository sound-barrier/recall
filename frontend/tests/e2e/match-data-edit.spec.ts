/**
 * Inline per-field editing of a parsed match + per-field revert.
 *
 * Clicking a combat stat in the detail panel swaps it into an input; Enter
 * PUTs the FULL override set to /matches/{key}/data (204), the app reloads,
 * and the match flips to `ocr_edited` — the header shows a "Reset to OCR"
 * button and the edited cell carries a ✎ revert marker. Clicking ✎ on the
 * only edit empties the set, so the client sends a DELETE (reset to pure
 * OCR) instead of persisting an empty row.
 *
 * Drives the full api.ts ↔ /api/v1 ↔ Go ↔ store ↔ aggregate chain — the e2e
 * that guards the 204/r.json() transport trap.
 */
import { test, expect } from './_fixtures'
import type { Route } from '@playwright/test'

function record(state: { damage?: number } = {}) {
  const edited = state.damage !== undefined
  return {
    match_key: 'm1',
    source_files: ['m1.png'],
    source_types: { 'm1.png': 'teams' },
    source: edited ? 'ocr_edited' : 'ocr',
    edited_fields: edited ? ['data.damage'] : [],
    data: {
      map: 'rialto', playlist: 'competitive', game_mode: 'control',
      role: 'support', hero: 'lucio', result: 'victory',
      date: '2026-05-10', finished_at: '22:00',
      eliminations: 17, assists: 16, deaths: 11,
      damage: state.damage ?? 7200, healing: 2100, mitigation: 800,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '11:25' }],
    },
    parsed_at: '2026-05-10T22:30:00Z',
  }
}

test.describe('inline match-data editing', () => {
  test('editing damage PUTs the override and flips the match to Edited', async ({ page }) => {
    const state: { damage?: number } = {}
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([record(state)]) })
    })
    let lastPutBody: string | null = null
    await page.route('**/api/v1/matches/m1/data', async (route: Route) => {
      const req = route.request()
      if (req.method() === 'PUT') {
        lastPutBody = req.postData()
        const body = JSON.parse(lastPutBody ?? '{}') as { damage?: number }
        if (body.damage !== undefined) state.damage = body.damage
        await route.fulfill({ status: 204, body: '' })
      } else if (req.method() === 'DELETE') {
        delete state.damage
        await route.fulfill({ status: 204, body: '' })
      } else {
        await route.fallback()
      }
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('.leaf-row').first().click()
    await expect(page.locator('aside.detail-panel')).toBeVisible()

    await page.locator('button[aria-label^="Damage"]').click()
    const input = page.locator('.stat-input')
    await input.fill('9999')
    await input.press('Enter')

    await expect.poll(() => lastPutBody).not.toBeNull()
    expect(JSON.parse(lastPutBody as string)).toEqual({ damage: 9999 })

    await expect(page.locator('.detail-reset-btn')).toBeVisible()
    await expect(page.locator('button[aria-label^="Damage"]')).toContainText('9,999')
  })

  test('the ✎ revert on the only edit sends a DELETE back to pure OCR', async ({ page }) => {
    const state: { damage?: number } = { damage: 9999 }
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([record(state)]) })
    })
    let sawDelete = false
    await page.route('**/api/v1/matches/m1/data', async (route: Route) => {
      const req = route.request()
      if (req.method() === 'DELETE') {
        sawDelete = true
        delete state.damage
        await route.fulfill({ status: 204, body: '' })
      } else if (req.method() === 'PUT') {
        const body = JSON.parse(req.postData() ?? '{}') as { damage?: number }
        if (body.damage !== undefined) state.damage = body.damage
        await route.fulfill({ status: 204, body: '' })
      } else {
        await route.fallback()
      }
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('.leaf-row').first().click()

    await expect(page.locator('.detail-reset-btn')).toBeVisible()
    await page.locator('[aria-label="Revert Damage to the scanned value"]').click()

    await expect.poll(() => sawDelete).toBe(true)
    await expect(page.locator('.detail-reset-btn')).toHaveCount(0)
    await expect(page.locator('button[aria-label^="Damage"]')).toContainText('7,200')
  })
})
