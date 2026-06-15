/**
 * Hand-entering a match (no OCR) — the no-Tesseract persona.
 *
 * Starting from an EMPTY match list, the toolbar's "Add match" button opens
 * the modal; filling the required fields and saving POSTs ManualMatchInput to
 * /api/v1/matches (201), the app reloads, and the new match appears with the
 * Manual badge (the detail panel opens on it so the user can add review /
 * replay-code details).
 *
 * Drives api.ts ↔ POST /api/v1/matches ↔ Go ↔ store ↔ aggregate.
 */
import { test, expect } from './_fixtures'
import type { Route } from '@playwright/test'

function manualRecord(body: { map?: string; heroes?: string[]; result?: string; play_mode?: string; queue_type?: string }) {
  return {
    match_key: 'match-2026-06-15T14-30-00',
    source_files: [],
    source: 'manual',
    edited_fields: [],
    data: {
      map: body.map ?? '',
      hero: body.heroes?.[0] ?? '',
      result: body.result ?? '',
      heroes_played: (body.heroes ?? []).map((h, i) => ({ hero: h, percent_played: i === 0 ? 100 : 0 })),
    },
    play_mode: body.play_mode,
    queue_type: body.queue_type,
  }
}

test('Add match → fill → save → the match appears with the Manual badge', async ({ page }) => {
  let postBody: string | null = null
  const created: unknown[] = []
  await page.route('**/api/v1/matches', async (route: Route) => {
    const req = route.request()
    if (req.method() === 'POST') {
      postBody = req.postData()
      const rec = manualRecord(JSON.parse(postBody ?? '{}'))
      created.push(rec)
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(rec) })
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(created) })
    }
  })

  await page.goto('/')
  await page.locator('#tab-matches').click()

  await page.locator('[data-add-match]').click()
  await expect(page.locator('.mm-modal')).toBeVisible()

  await page.locator('#mm-map').fill('Ilios')
  await page.locator('[data-mode="competitive"]').click()
  await page.locator('[data-queue="role"]').click()
  await page.locator('#mm-hero').fill('ana')
  await page.locator('#mm-hero').press('Enter')
  await expect(page.locator('.mm-hero-chip')).toContainText('ana')
  await page.locator('[data-result="victory"]').click()
  await page.locator('[data-leaver="team"]').click()

  await page.locator('[data-mm-submit]').click()

  await expect.poll(() => postBody).not.toBeNull()
  const parsed = JSON.parse(postBody as string) as {
    map: string; play_mode: string; queue_type: string; heroes: string[]; result: string; leaver: string
  }
  expect(parsed.map).toBe('Ilios')
  expect(parsed.play_mode).toBe('competitive')
  expect(parsed.queue_type).toBe('role')
  expect(parsed.heroes).toEqual(['ana'])
  expect(parsed.result).toBe('victory')
  expect(parsed.leaver).toBe('team')

  // The created manual match surfaces with the Manual provenance badge.
  await expect(page.locator('.prov-manual').first()).toBeVisible()
})
