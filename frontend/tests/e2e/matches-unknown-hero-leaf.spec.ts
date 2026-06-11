/**
 * Matches leaf row — Unknown hero / Unknown map chip.
 *
 * A match whose OCR captured a hero name that didn't pin to any
 * canonical entry in `pkg/parser/heroes.yaml` lands with
 * `data.hero = ''` and `data.hero_raw = '<ocr text>'`. The leaf
 * row swaps the normal lowercase hero name for a warning-styled
 * "Unknown hero (miyazaki?)" chip. Same shape for maps.
 *
 * Pre-fix the parser silently attributed "miyazaki" OCR to "mei"
 * (Pass-2 fuzzy length-gate accepted 1 edit on a 3-char hero),
 * leaving every Miyazaki play merged into Mei's totals.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

test.describe('Matches — Unknown hero / map leaf chip', () => {
  test('shows "Unknown hero (miyazaki?)" with the OCR text in parens', async ({ page }) => {
    const matches = [{
      match_key:    'k1',
      source_files: ['k1.png'],
      source_types: { 'k1.png': 'summary' },
      data: {
        map: 'rialto',
        playlist: 'competitive',
        type: 'control',
        hero: '',                  // matcher rejected
        hero_raw: 'miyazaki',      // raw OCR preserved
        result: 'victory',
        date: '2026-05-10',
        finished_at: '22:00',
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

    await page.goto('/')
    await expect(page.locator('#panel-matches')).toBeVisible()
    await expect(page.locator('.leaf-hero-unknown').first()).toHaveText('Unknown hero (miyazaki?)')
    await expect(page.locator('[data-unknown-hero="miyazaki"]').first()).toBeVisible()
  })

  test('records with unknown map land on the Unknown tab Reference-data-gap section', async ({ page }) => {
    // Records with no `data.map` are routed to the Unknown tab by
    // App.vue's `unknownRecords` filter (`!data.map && !ambiguous`).
    // The new Reference-data-gap section surfaces every record where
    // hero_raw OR map_raw is set, so an unknown-map record lands
    // there with a one-liner showing the OCR'd text.
    const matches = [{
      match_key:    'k2',
      source_files: ['k2.png'],
      source_types: { 'k2.png': 'summary' },
      data: {
        map: '',
        map_raw: 'new-junk-city',
        playlist: 'competitive',
        type: '',
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

    await page.goto('/')
    await page.locator('button[role="tab"]', { hasText: 'Unknown' }).click()
    await expect(page.locator('#panel-unknown')).toBeVisible()
    const gapCard = page.locator('[data-reference-gap-key="k2"]')
    await expect(gapCard).toBeVisible()
    await expect(gapCard).toContainText('new-junk-city')
  })

  test('renders "Unknown hero" (no parens) when hero_raw is missing', async ({ page }) => {
    // Pre-fix record (parsed before hero_raw was preserved). Leaf
    // still surfaces the warning so the user knows the row has a
    // gap, just without the recognisable OCR hint.
    const matches = [{
      match_key:    'k3',
      source_files: ['k3.png'],
      source_types: { 'k3.png': 'summary' },
      data: {
        map: 'rialto', playlist: 'competitive', type: 'control',
        hero: '',
        // intentionally NO hero_raw
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

    await page.goto('/')
    await expect(page.locator('#panel-matches')).toBeVisible()
    // No hero_raw → the row should NOT render the unknown variant
    // (isHeroUnknown requires hero_raw to be truthy).
    await expect(page.locator('.leaf-hero-unknown')).toHaveCount(0)
  })
})
