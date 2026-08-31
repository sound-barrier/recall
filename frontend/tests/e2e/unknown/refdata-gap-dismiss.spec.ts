/**
 * Unknown tab — Dismiss on a Reference-data-gap card is ACKNOWLEDGE-only.
 *
 * These cards are real, tracked matches whose OCR'd hero/map didn't
 * resolve against the current reference data; the card's own promise is
 * that a future YAML update fixes them. So Dismiss here must not touch
 * the match — it just stops the warning: one click (the action is
 * reversible, unlike the destructive dismiss on the other sections)
 * fires PUT /api/v1/matches/{key}/reference-gap-acknowledgement, the
 * card leaves the list, and an "N acknowledged — show" disclosure keeps
 * it restorable without leaving the tab.
 */
import type { Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

import { test, expect } from '../_fixtures'

const KEY = 'match-2026-05-10T22-21-11'

const gapRecord = (acked: boolean) => ({
  match_key: KEY,
  source_files: ['summary.png'],
  source_types: { 'summary.png': 'summary' },
  source_dir_ids: {},
  data: { map: 'neon junction', hero: '', hero_raw: 'Miyazaki', playlist: 'competitive' },
  ...(acked ? { reference_gap_acknowledged: true } : {}),
  parsed_at: '2026-05-10T22:21:11Z',
})

test.describe('Unknown tab — reference-gap acknowledge', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
  })

  test('Dismiss acknowledges the gap; the disclosure shows and restores it', async ({ page }) => {
    let acked = false
    let putHits = 0
    let delHits = 0

    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([gapRecord(acked)]),
      })
    })
    await page.route(`**/api/v1/matches/${KEY}/reference-gap-acknowledgement`, async (route: Route) => {
      if (route.request().method() === 'PUT') {
        putHits++
        acked = true
      } else {
        delHits++
        acked = false
      }
      await route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/')
    await page.getByRole('tab', { name: /^Unknown/ }).click()

    const section = page.locator('#section-reference-gaps')
    await expect(section).toContainText(/Reference data gaps — 1/)

    // One click — the action is reversible, so no armed confirm.
    await section.getByRole('button', { name: `Dismiss the warning for ${KEY}` }).click()
    await expect.poll(() => putHits).toBe(1)

    // The card leaves the active list; the disclosure carries the count.
    await expect(section.locator(`[data-reference-gap-key="${KEY}"]`)).toHaveCount(0)
    const disclosure = section.getByRole('button', { name: /1 acknowledged — show/ })
    await expect(disclosure).toBeVisible()

    // Opening the disclosure reveals the card with a restore affordance.
    await disclosure.click()
    await expect(section.locator(`[data-reference-gap-key="${KEY}"]`)).toHaveCount(1)
    await section.getByRole('button', { name: `Show the warning for ${KEY} again` }).click()
    await expect.poll(() => delHits).toBe(1)
    await expect(section).toContainText(/Reference data gaps — 1/)
  })

  test('an acknowledged gap stays hidden across a reload', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([gapRecord(true)]),
      })
    })

    await page.goto('/')
    await page.getByRole('tab', { name: /^Unknown/ }).click()

    const section = page.locator('#section-reference-gaps')
    // No active cards — the section leads with the disclosure only.
    await expect(section.getByRole('button', { name: /1 acknowledged — show/ })).toBeVisible()
    await expect(section.locator(`[data-reference-gap-key="${KEY}"]`)).toHaveCount(0)

    // The shared a11y matrix never renders this section (its corpus has
    // no gap records), so the acknowledged-open state gets its axe pass
    // here — the settled styling must never dip below AA again.
    await section.getByRole('button', { name: /1 acknowledged — show/ }).click()
    await expect(section.locator(`[data-reference-gap-key="${KEY}"]`)).toHaveCount(1)
    const results = await new AxeBuilder({ page })
      .include('#section-reference-gaps')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    expect(results.violations).toEqual([])
  })
})
