/**
 * "Left after a leaver" quick-add.
 *
 * Overwatch drops a match you leave early from your history entirely, so the
 * OCR pipeline never sees it. The Add-match split button's second item opens
 * the same modal in a stripped mode: map + result, nothing else. It pre-tags
 * BOTH disruption sides (a teammate left, then you did) — which is only
 * expressible now that `leavers` is a set.
 *
 * Drives api.ts ↔ POST /api/v1/matches ↔ Go ↔ store ↔ aggregate.
 */
import type { Route } from '@playwright/test'

import { routeCapture } from '../_capture'
import { test, expect } from '../_fixtures'

const refData = {
  heroes_by_role: { tank: ['Reinhardt'], damage: ['Tracer'], support: ['Ana'] },
  maps_by_game_mode: { control: ['Ilios'], hybrid: ["King's Row"] },
}

function quickRecord(body: { map?: string; result?: string }) {
  return {
    match_key: 'match-2026-06-15T14-30-00',
    source_files: [],
    source: 'manual',
    edited_fields: [],
    data: { map: body.map ?? '', hero: '', result: body.result ?? '', heroes_played: [] },
    annotation: { leavers: ['team', 'self'], throwers: [], members: [] },
  }
}

async function openQuickAdd(page: import('@playwright/test').Page) {
  await page.locator('[data-add-match]').click()
  await page.locator('[data-add-match-leaver-exit]').click()
  await expect(page.locator('.mm-modal')).toBeVisible()
}

test('Left after a leaver → map + result → the match is recorded', async ({ page }) => {
  const postBody = routeCapture<string>('quick-add POST body')
  const created: unknown[] = []
  await page.route('**/api/v1/system/reference-data', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(refData) }),
  )
  await page.route('**/api/v1/matches', async (route: Route) => {
    const req = route.request()
    if (req.method() === 'POST') {
      postBody.set(req.postData() ?? '{}')
      const rec = quickRecord(JSON.parse(postBody.get()))
      created.push(rec)
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(rec) })
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(created) })
    }
  })

  await page.goto('/')
  await page.getByRole('tab', { name: /^Matches/ }).click()
  await openQuickAdd(page)

  // The whole point: no hero, no mode, no queue, no rank — two fields only.
  await expect(page.locator('[data-combo-id="mm-hero"]')).toHaveCount(0)
  await expect(page.locator('[data-mode="competitive"]')).toHaveCount(0)
  await expect(page.locator('[data-queue="role"]')).toHaveCount(0)

  const mapCombo = page.locator('[data-combo-id="mm-map"]')
  await mapCombo.locator('.combo-input').click()
  await mapCombo.locator('.combo-input').fill('ili')
  await page.keyboard.press('Enter')
  await expect(mapCombo.locator('.combo-pill')).toContainText('ilios')

  await page.locator('[data-result="defeat"]').click()
  await expect(page.locator('[data-mm-submit]')).toBeEnabled()
  await page.locator('[data-mm-submit]').click()

  await expect.poll(() => postBody.seen()).toBe(true)
  const parsed = JSON.parse(postBody.get()) as {
    map: string; result: string; leavers: string[]; heroes?: string[]
    play_mode?: string; queue_type?: string
  }
  expect(parsed.map).toBe('ilios')
  expect(parsed.result).toBe('defeat')
  // Both sides: a teammate left, and so did you. The old scalar column could
  // only hold one of these.
  expect([...parsed.leavers].sort()).toEqual(['self', 'team'])
  expect(parsed.heroes ?? []).toEqual([])
  expect(parsed.play_mode ?? '').toBe('')
  expect(parsed.queue_type ?? '').toBe('')

  await expect(page.locator('.prov-manual').first()).toBeVisible()
})

test('submit stays blocked until both the map and the result are set', async ({ page }) => {
  await page.route('**/api/v1/system/reference-data', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(refData) }),
  )
  await page.route('**/api/v1/matches', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
  )

  await page.goto('/')
  await page.getByRole('tab', { name: /^Matches/ }).click()
  await openQuickAdd(page)

  await expect(page.locator('[data-mm-submit]')).toBeDisabled()

  const mapCombo = page.locator('[data-combo-id="mm-map"]')
  await mapCombo.locator('.combo-input').click()
  await mapCombo.locator('.combo-input').fill('ili')
  await page.keyboard.press('Enter')
  // Map alone isn't enough — the result is the second required tap.
  await expect(page.locator('[data-mm-submit]')).toBeDisabled()

  await page.locator('[data-result="victory"]').click()
  await expect(page.locator('[data-mm-submit]')).toBeEnabled()
})

test('the full-entry menu item still opens the complete form', async ({ page }) => {
  await page.route('**/api/v1/system/reference-data', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(refData) }),
  )
  await page.route('**/api/v1/matches', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) }),
  )

  await page.goto('/')
  await page.getByRole('tab', { name: /^Matches/ }).click()
  await page.locator('[data-add-match]').click()
  await page.locator('[data-add-match-full]').click()
  await expect(page.locator('.mm-modal')).toBeVisible()
  await expect(page.locator('[data-combo-id="mm-hero"]')).toHaveCount(1)
})
