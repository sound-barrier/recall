/**
 * Matches detail panel — Unknown hero / map inline banner.
 *
 * When a match's parser data has `hero='' && hero_raw!=''` (or the
 * map variant), opening the detail panel shows a striped-accent
 * banner above the chooser block with the OCR text in parens and a
 * link to the latest release. Cannot be dismissed; cannot be
 * edited — the only path to a fix is a future YAML release.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

test.describe('Matches — Unknown hero / map detail-panel banner', () => {
  test('inline banner appears above the chooser block with the OCR text', async ({ page }) => {
    const matches = [{
      match_key:    'k1',
      source_files: ['k1.png'],
      source_types: { 'k1.png': 'summary' },
      data: {
        map: 'rialto', playlist: 'competitive', game_mode: 'control',
        hero: '', hero_raw: 'miyazaki',
        result: 'victory',
        date: '2026-05-10', finished_at: '22:00',
        eliminations: 10, assists: 5, deaths: 3,
        heroes_played: [],
      },
      parsed_at: '2026-05-10T22:30:00Z',
    }]
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(matches),
      })
    })
    // Detail panel auto-syncs play_mode on open — swallow the PUT.
    await page.route('**/api/v1/matches/*/play-mode', route => route.fulfill({ status: 204, body: '' }))

    await page.goto('/')
    await expect(page.locator('#panel-matches')).toBeVisible()
    await page.locator('[data-match-key="k1"]').click()
    await expect(page.locator('[role="dialog"]').first()).toBeVisible()

    const banner = page.locator('[data-unknown-alert]')
    await expect(banner).toBeVisible()
    await expect(banner).toContainText('Unknown hero detected')
    await expect(banner.locator('code')).toHaveText('miyazaki')
    await expect(banner.locator('a.unknown-alert-link')).toHaveAttribute(
      'href',
      'https://github.com/sound-barrier/recall/releases/latest',
    )
  })

  test('no banner when hero is canonical', async ({ page }) => {
    const matches = [{
      match_key:    'k2',
      source_files: ['k2.png'],
      source_types: { 'k2.png': 'summary' },
      data: {
        map: 'rialto', playlist: 'competitive', game_mode: 'control',
        hero: 'lucio',
        result: 'victory',
        date: '2026-05-10', finished_at: '22:00',
        eliminations: 10, assists: 5, deaths: 3,
        heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '5:00' }],
      },
      parsed_at: '2026-05-10T22:30:00Z',
    }]
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(matches),
      })
    })
    await page.route('**/api/v1/matches/*/play-mode', route => route.fulfill({ status: 204, body: '' }))

    await page.goto('/')
    await page.locator('[data-match-key="k2"]').click()
    await expect(page.locator('[role="dialog"]').first()).toBeVisible()
    await expect(page.locator('[data-unknown-alert]')).toHaveCount(0)
  })
})
