/**
 * Contextual callout on the Reference data gaps section
 * (UI_RECOMMENDATIONS item 13 surface C).
 *
 * Most users never see a reference-data-gap record — they're the
 * fallout from the parser capturing a new hero/map name that
 * hasn't shipped in the YAML rosters yet. A static onboarding-tour
 * step couldn't time this surface; a contextual callout fires
 * the first time the section materialises and explains the
 * wait-for-YAML recovery path + the "Fixed in v<X>" CTAs the user
 * just lit up.
 *
 * Callout fires when:
 *   - referenceGapRecords.length > 0 AND
 *   - recall.tour.unknown.refdata.seen IS NOT 'true'
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const gap = (key: string, heroRaw: string) => ({
  match_key:    key,
  source_files: [`${key}.png`],
  source_types: { [`${key}.png`]: 'summary' },
  data: {
    hero_raw: heroRaw,
  },
  parsed_at: '2026-05-10T14:00:00Z',
})

test.describe('unknown tab — reference-data-gaps contextual callout', () => {
  test('callout surfaces the first time a gap record exists; dismisses on Got it', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.removeItem('recall.tour.unknown.refdata.seen')
    })
    await page.route('**/api/v1/matches', (route: Route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([gap('miya', 'miyazaki')]),
    }))
    await page.goto('/')
    await page.locator('#tab-unknown').click()
    await expect(page.locator('#section-reference-gaps')).toBeVisible()
    const callout = page.locator('[data-ctx-callout]')
    await expect(callout).toBeVisible()
    await expect(callout).toContainText(/reference data gaps/i)
    // Click the inline Got it.
    await callout.locator('.ctx-action').click()
    await expect(page.locator('[data-ctx-callout]')).toHaveCount(0)
    const seen = await page.evaluate(() => window.localStorage.getItem('recall.tour.unknown.refdata.seen'))
    expect(seen).toBe('true')
  })

  test('callout does NOT surface when no gap records exist', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.removeItem('recall.tour.unknown.refdata.seen')
    })
    // No gap records — just a single resolved match.
    await page.route('**/api/v1/matches', (route: Route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([{
        match_key: 'm1', source_files: ['ok.png'], source_types: { 'ok.png': 'summary' },
        data: { map: 'ilios', hero: 'lucio', result: 'victory', mode: 'competitive' },
        parsed_at: '2026-05-10T14:00:00Z',
      }]),
    }))
    await page.goto('/')
    await page.locator('#tab-unknown').click()
    // Section absent, callout absent.
    await expect(page.locator('#section-reference-gaps')).toHaveCount(0)
    await expect(page.locator('[data-ctx-callout]')).toHaveCount(0)
  })

  test('callout does NOT surface when the per-id seen flag is already set', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('recall.tour.unknown.refdata.seen', 'true')
    })
    await page.route('**/api/v1/matches', (route: Route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([gap('miya', 'miyazaki')]),
    }))
    await page.goto('/')
    await page.locator('#tab-unknown').click()
    await expect(page.locator('#section-reference-gaps')).toBeVisible()
    await expect(page.locator('[data-ctx-callout]')).toHaveCount(0)
  })
})
