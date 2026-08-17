/**
 * Elo Calculator — "Where do I stand?".
 *
 * Commit a928122f deleted a population card that answered this from a published
 * distribution, because season 4's Rank Redistribution voided that
 * distribution: it moved Platinum and Diamond players into a tier that had not
 * existed, so every share the card printed became wrong.
 *
 * Nothing replaced the distribution, so the successor does not use one. It
 * reports what the player's OWN rank screens said — where they stand, and where
 * they stood before — and compares two readings only within a season, since a
 * redistribution moves the whole population and makes a cross-boundary
 * difference meaningless.
 */
import type { Route } from '@playwright/test'

import { test, expect } from '../_fixtures'

function localYMD(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// One season covering the whole corpus, so readings pair. The spec that needs
// a boundary overrides this.
const SEASONS = [{
  name: 'Season 4',
  start: `${localYMD(-120)}T00:00:00Z`,
  end: `${localYMD(30)}T00:00:00Z`,
}]

const REFERENCE_DATA = {
  heroes_by_role: { support: ['Lúcio'], dps: ['Ashe'], tank: ['Zarya'] },
  maps_by_game_mode: { control: ['Ilios'] },
  screenshot_sources: [],
  seasons: SEASONS,
}

let seq = 0
interface Bits { percentile?: number; daysAgo?: number }
function rec(result: string, bits: Bits = {}) {
  seq++
  const days = bits.daysAgo ?? seq
  return {
    match_key: `m${seq}`,
    source_files: [`m${seq}.png`],
    source_types: { [`m${seq}.png`]: 'rank' },
    queue_type: 'role',
    play_mode: 'competitive',
    data: {
      map: 'ilios', playlist: 'competitive', game_mode: 'control',
      role: 'support', hero: 'lucio', result,
      date: localYMD(-days), finished_at: '20:00',
      played_at_utc: `${localYMD(-days)}T20:00:00Z`,
      rank: 'gold', level: 2, rank_progress: 40, change_percent: 21,
      ...(bits.percentile === undefined ? {} : { rank_percentile: bits.percentile }),
    },
    parsed_at: `${localYMD(-days)}T20:30:00Z`,
  }
}

async function openElo(
  page: import('@playwright/test').Page,
  records: unknown[],
  seasons: unknown[] = SEASONS,
) {
  await page.route('**/api/v1/system/reference-data', async (route: Route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ ...REFERENCE_DATA, seasons }),
    })
  })
  await page.route('**/api/v1/matches', async (route: Route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(records),
    })
  })
  await page.goto('/')
  await page.getByRole('tab', { name: 'Elo Calculator' }).click()
  return page.locator('[data-elo-stat="percentile"]')
}

// A corpus with enough decisive games for the calculator to seed at all.
function corpus(percentiles: { at: number; pct: number }[]) {
  seq = 0
  const games = Array.from({ length: 20 }, (_, i) => rec(i % 3 === 0 ? 'defeat' : 'victory', { daysAgo: i + 1 }))
  return [...games, ...percentiles.map((p) => rec('victory', { daysAgo: p.at, percentile: p.pct }))]
}

test.describe('where do I stand', () => {
  test('reports the standing and how it moved this season', async ({ page }) => {
    const card = await openElo(page, corpus([{ at: 30, pct: 52 }, { at: 3, pct: 61 }]))

    await expect(card).toBeVisible()
    await expect(card).toContainText('61%')
    // Points, not percent: the gap between two percentiles is a difference in
    // percentage POINTS.
    await expect(card).toContainText(/up 9 pts/i)
    await expect(card).toContainText('52%')
  })

  // One reading is the COMMON case — only post-placement rank screens carry the
  // caption — and the bare fact is still worth stating.
  test('states the bare standing when there is nothing to compare', async ({ page }) => {
    const card = await openElo(page, corpus([{ at: 3, pct: 61 }]))

    await expect(card).toBeVisible()
    await expect(card).toContainText('61%')
    await expect(card).toContainText(/nothing to compare/i)
    await expect(card).not.toContainText(/up \d|down \d/i)
  })

  // The card that was deleted printed a share for a rank the player had not
  // reached, from a table. Its successor must never appear without a reading.
  test('is absent entirely when no capture reported a percentile', async ({ page }) => {
    const card = await openElo(page, corpus([]))

    await expect(page.locator('[data-elo-stat="p-value"]')).toBeVisible()
    await expect(card).toHaveCount(0)
  })

  // The Rank Redistribution lesson, encoded: two readings either side of a
  // season boundary measure different populations.
  test('refuses to compare across a season boundary', async ({ page }) => {
    const card = await openElo(
      page,
      corpus([{ at: 60, pct: 52 }, { at: 3, pct: 61 }]),
      [
        { name: 'Season 3', start: `${localYMD(-120)}T00:00:00Z`, end: `${localYMD(-30)}T00:00:00Z` },
        { name: 'Season 4', start: `${localYMD(-30)}T00:00:00Z`, end: `${localYMD(30)}T00:00:00Z` },
      ],
    )

    await expect(card).toBeVisible()
    await expect(card).toContainText('61%')
    // The message names the REASON. "Nothing to compare" would be true but
    // uninformative here — the user has two readings and deserves to know why
    // they are not being compared.
    await expect(card).toContainText(/previous seasons/i)
    await expect(card).toContainText(/redistribution/i)
    await expect(card).not.toContainText(/up \d|down \d/i)
  })

  // "Hardstuck" was a diagnosis layered on the number, and it needed the
  // comparison the distribution used to provide.
  test('never calls the player hardstuck', async ({ page }) => {
    const card = await openElo(page, corpus([{ at: 30, pct: 52 }, { at: 3, pct: 61 }]))

    await expect(card).toBeVisible()
    await expect(card).not.toContainText(/hardstuck/i)
  })
})
