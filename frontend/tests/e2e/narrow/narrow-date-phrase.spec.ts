/**
 * Narrow — describing a date range in words.
 *
 * "last week", "since Friday", "this season" resolve to the SAME state the
 * preset chips and the From/To pickers write, so there is one filter reachable
 * three ways.
 *
 * The refusals are the feature, and they are what this spec spends most of its
 * cases on. A date filter that quietly picks the wrong window is worse than one
 * that does nothing: the user sees a filtered set, believes it means what they
 * asked for, and reads conclusions off it. On a phrase it cannot read, the
 * existing filter must be left exactly as it was.
 */
import type { Route } from '@playwright/test'

import { test, expect } from '../_fixtures'

const DAY = 86_400_000

function ymd(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * DAY)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${String(d.getDate()).padStart(2, '0')}`
}

let seq = 0
function match(daysAgo: number) {
  seq++
  return {
    match_key: `m${seq}`,
    source_files: [`m${seq}.png`],
    data: {
      map: 'rialto', playlist: 'competitive', game_mode: 'control',
      role: 'support', hero: 'lucio', result: 'victory',
      date: ymd(daysAgo), finished_at: '20:00',
    },
    parsed_at: `${ymd(daysAgo)}T20:30:00Z`,
  }
}

async function openNarrow(page: import('@playwright/test').Page) {
  seq = 0
  // Spread across five weeks so a calendar-week phrase selects a real subset.
  const records = Array.from({ length: 35 }, (_, i) => match(i))
  await page.route('**/api/v1/matches', async (route: Route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(records),
    })
  })
  await page.goto('/')
  await page.getByRole('tab', { name: /^Matches/ }).click()
  // The install's own default scope already narrows this, so the baseline is
  // measured rather than assumed.
  await expect(page.locator('.leaf-row').first()).toBeVisible()
  const baseline = await page.locator('.leaf-row').count()
  await page.getByRole('button', { name: /Filter matches/i }).click()
  return baseline
}

test.describe('date phrases', () => {
  test('narrows the set to the previous calendar week', async ({ page }) => {
    const baseline = await openNarrow(page)

    await page.getByLabel(/describe it/i).fill('last week')
    await page.getByRole('button', { name: 'Apply' }).click()

    // A calendar week holds seven days of this corpus — one match per day —
    // and that is fewer than the scope started with.
    await expect(page.locator('.leaf-row')).toHaveCount(7)
    expect(baseline).toBeGreaterThan(7)
  })

  test('reaches back to a named weekday', async ({ page }) => {
    const baseline = await openNarrow(page)

    await page.getByLabel(/describe it/i).fill('since Friday')
    await page.getByRole('button', { name: 'Apply' }).click()

    const rows = await page.locator('.leaf-row').count()
    expect(rows).toBeGreaterThan(0)
    expect(rows).toBeLessThan(baseline)
  })

  // The refusal, and the property that matters most about it: the filter the
  // user already had must survive untouched.
  test('declines a phrase it cannot read, without disturbing the filter', async ({ page }) => {
    await openNarrow(page)

    await page.getByLabel(/describe it/i).fill('last week')
    await page.getByRole('button', { name: 'Apply' }).click()
    await expect(page.locator('.leaf-row')).toHaveCount(7)

    await page.getByLabel(/describe it/i).fill('sometime around the Mauga patch')
    await page.getByRole('button', { name: 'Apply' }).click()

    // Scoped: other live regions exist on the page (the session toast among
    // them), so this asks for the refusal specifically.
    await expect(page.getByRole('status').filter({ hasText: /not sure what/i })).toBeVisible()
    // Still the previous week — the refusal changed nothing.
    await expect(page.locator('.leaf-row')).toHaveCount(7)
  })

  test('applying the same phrase twice leaves it applied', async ({ page }) => {
    await openNarrow(page)

    for (let i = 0; i < 2; i++) {
      await page.getByLabel(/describe it/i).fill('last week')
      await page.getByRole('button', { name: 'Apply' }).click()
    }

    await expect(page.locator('.leaf-row')).toHaveCount(7)
  })
})
