/**
 * Reference-data-gap "Fixed in v<X>" CTA (UI_RECOMMENDATIONS item 11).
 *
 * When the user clicks "Check for updates" in the masthead and the
 * upcoming release would recognise an OCR'd hero/map name currently
 * sitting in the Unknown tab's reference-data-gaps section, each
 * gap-card surfaces a "Fixed in v<X>" CTA linking to the release.
 *
 * Spec covers two paths:
 *   1. CTA renders when the upcoming roster contains the OCR'd name.
 *   2. CTA does NOT render when the roster does not (e.g. the parser
 *      still has work to do upstream).
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const gap = (key: string, heroRaw: string, mapRaw: string | null) => ({
  match_key:    key,
  source_files: [`${key}.png`],
  source_types: { [`${key}.png`]: 'summary' },
  data: {
    hero_raw: heroRaw,
    map_raw:  mapRaw,
  },
  parsed_at: '2026-05-10T14:00:00Z',
})

test.describe('unknown tab — reference-data-gap fix CTA', () => {
  test.beforeEach(async ({ page }) => {
    // A single gap record: parser captured "miyazaki" as an
    // unknown hero. Lives in the Reference data gaps section.
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([gap('miya', 'miyazaki', null)]),
      })
    })
  })

  test('renders "Fixed in v<X>" when the upcoming roster recognises the name', async ({ page }) => {
    await page.route('**/api/v1/system/update', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          checked:   true,
          dev_build: false,
          available: true,
          latest:    '1.2.3',
          url:       'https://github.com/sound-barrier/recall/releases/tag/v1.2.3',
          latest_heroes: ['Miyazaki', 'Reinhardt'],
          latest_maps:   [],
        }),
      })
    })
    await page.goto('/')
    await page.locator('#tab-unknown').click()
    // Click the masthead "Check for updates" button so updateInfo
    // hydrates. The button copy changes after the click — locator by
    // a stable test ID would be cleaner, but the unique title works
    // for this RED test.
    await page.getByTitle('Check for updates').click()
    // CTA surfaces on the gap card.
    const cta = page.locator('[data-fix-cta-key="miya"]')
    await expect(cta).toBeVisible()
    await expect(cta).toContainText('Fixed in')
    await expect(cta).toContainText('v1.2.3')
    await expect(cta).toContainText('Miyazaki')
    const link = cta.locator('.fix-link')
    await expect(link).toHaveAttribute('href', 'https://github.com/sound-barrier/recall/releases/tag/v1.2.3')
  })

  test('keeps the generic copy when the upcoming roster does NOT recognise the name', async ({ page }) => {
    await page.route('**/api/v1/system/update', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          checked:   true,
          dev_build: false,
          available: true,
          latest:    '1.2.3',
          url:       'https://github.com/sound-barrier/recall/releases/tag/v1.2.3',
          // Roster doesn't include miyazaki — generic copy stays.
          latest_heroes: ['Reinhardt'],
          latest_maps:   [],
        }),
      })
    })
    await page.goto('/')
    await page.locator('#tab-unknown').click()
    await page.getByTitle('Check for updates').click()
    // No CTA element for this card.
    await expect(page.locator('[data-fix-cta-key="miya"]')).toHaveCount(0)
    // But the section's existing "wait for the next release" copy is
    // still rendered.
    await expect(page.locator('#section-reference-gaps')).toContainText('next launch after a YAML update')
  })
})
