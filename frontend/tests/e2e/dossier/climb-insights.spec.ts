/**
 * Dossier — the three trailing-window climb widgets.
 *
 * Each compares the player against THEMSELVES over a recent window and the
 * baseline before it, because the app has no population model and the one card
 * that assumed it had one had to be deleted when the ladder was redistributed.
 *
 * The case that matters most here is the refusal. change_percent is nullable —
 * 21 of the 44 rank captures in the corpus report none — so a window whose
 * movement pills went unread must say it cannot tell, rather than read the
 * silence as "the rank did not move" and invent rank deflation.
 */
import type { Route } from '@playwright/test'

import { test, expect } from '../_fixtures'
import { seedDossierLayout } from '../_layout'

const DAY = 86_400_000

function ymd(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10)
}

let seq = 0
function match(daysAgo: number, result: 'victory' | 'defeat', change?: number) {
  seq++
  return {
    match_key: `m${seq}`,
    source_files: [`m${seq}.png`],
    source_types: { [`m${seq}.png`]: 'rank' },
    queue_type: 'role',
    data: {
      map: 'rialto', playlist: 'competitive', game_mode: 'control',
      role: 'support', hero: 'lucio', result,
      date: ymd(daysAgo), finished_at: '20:00',
      rank: 'platinum', level: 2, rank_progress: 40,
      ...(change === undefined ? {} : { change_percent: change }),
    },
    parsed_at: `${ymd(daysAgo)}T20:30:00Z`,
  }
}

// A strong recent week over a mediocre baseline, so the comparison has enough
// on both sides to speak at all.
function corpus(recentChange?: number) {
  seq = 0
  return [
    ...Array.from({ length: 16 }, (_, i) => match(1 + (i % 5), i < 13 ? 'victory' : 'defeat', recentChange)),
    ...Array.from({ length: 16 }, (_, i) => match(20 + (i % 5), i < 8 ? 'victory' : 'defeat', 5)),
  ]
}

async function openDossier(page: import('@playwright/test').Page, records: unknown[]) {
  await seedDossierLayout(page, { 1: ['perf-vs-rank', 'rolling-baseline', 'climb-velocity'] })
  await page.route('**/api/v1/matches', async (route: Route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(records),
    })
  })
  await page.goto('/')
  await page.getByRole('tab', { name: /^Matches/ }).click()
}

test.describe('climb insights', () => {
  test('judges a strong week whose rank did not move', async ({ page }) => {
    await openDossier(page, corpus(-1))

    await expect(page.getByText(/Playing above your baseline, rank flat/i)).toBeVisible()
  })

  // The refusal. Without a movement reading the widget cannot tell deflation
  // from a rank that simply was not captured, and saying so is the honest
  // answer — the alternative is inventing the very thing the player suspects.
  test('refuses to call deflation when no movement was read', async ({ page }) => {
    await openDossier(page, corpus())

    await expect(page.getByText(/Not enough to say/i)).toBeVisible()
    await expect(page.getByText(/no rank movement was read/i)).toBeVisible()
    await expect(page.getByText(/Playing above your baseline/i)).toHaveCount(0)
  })

  test('reports the week against the trailing baseline as a sigma', async ({ page }) => {
    await openDossier(page, corpus(10))

    await expect(page.getByText(/vs \d+% baseline/i)).toBeVisible()
    // Both this widget and Play-vs-rank quote a sigma, so scope to the one
    // under test rather than matching the glyph app-wide.
    await expect(page.getByText(/vs \d+% baseline/i).locator('..')).toContainText('σ')
  })

  test('reports the climb rate per week', async ({ page }) => {
    await openDossier(page, corpus(10))

    await expect(page.getByText(/\/wk/)).toBeVisible()
  })

  // A rate nobody measured is unknown, not zero — the same rule the rest of
  // this campaign follows.
  test('shows no climb rate when nothing reported a movement', async ({ page }) => {
    // EVERY match must lack a reading: the climb window is 30 days by default,
    // so it spans the baseline group too and a movement there would legitimately
    // give it something to report.
    seq = 0
    await openDossier(page, [
      ...Array.from({ length: 16 }, (_, i) => match(1 + (i % 5), i < 13 ? 'victory' : 'defeat')),
      ...Array.from({ length: 16 }, (_, i) => match(20 + (i % 5), i < 8 ? 'victory' : 'defeat')),
    ])

    await expect(page.getByText(/No rank movement was read in this window/i)).toBeVisible()
  })
})
