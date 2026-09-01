/**
 * The analytics wave, end to end.
 *
 * Six widgets shipped over one campaign — the SR-denominated pair, the
 * effective hero pool, the fresh-vs-tilted queue split, the patch split, and
 * the per-hero trend lines — and the render branch that matters most for all
 * of them is the HONEST-EMPTY one: SR is reported on a minority of captures,
 * a patch has to be straddled to split on, and a queue gap needs two games
 * close enough together to be one.
 *
 * Unit tests cover those branches per widget; this proves the transport —
 * corpus over HTTP, into the dossier, out as the sentence the player reads.
 */
import type { Route } from '@playwright/test'

import { test, expect } from '../_fixtures'
import { seedDossierLayout } from '../_layout'

const WIDGETS = ['sr-climb-rate', 'sr-by-hero', 'hero-concentration', 'queue-gap', 'patch-split', 'hero-trend-lines']

// A day inside Season 4 (patches.yaml's newest boundary is 2026-08-11T19:00Z)
// and one before it, so the patch split has a boundary to straddle.
function match(opts: {
  key: string
  utc: string
  result: string
  hero?: string
  sr?: { hero: string; sr: number; change?: number }[]
  lengthMin?: number
}) {
  const hero = opts.hero ?? 'lucio'
  const end = new Date(opts.utc)
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    match_key: opts.key,
    source_files: [`${opts.key}.png`],
    queue_type: 'role',
    data: {
      map: 'rialto', playlist: 'competitive', game_mode: 'escort',
      role: 'support', hero, result: opts.result,
      date: opts.utc.slice(0, 10), finished_at: opts.utc.slice(11, 16),
      played_at_utc: opts.utc,
      game_length: `${pad(opts.lengthMin ?? 14)}:00`,
      heroes_played: [{ hero, percent_played: 100, play_time: '14:00' }],
      ...(opts.sr ? { sr: opts.sr } : {}),
    },
    parsed_at: `${opts.utc.slice(0, 10)}T23:00:00Z`,
    _end: end.toISOString(),
  }
}

// Two matches before the Season 4 boundary and three after, the last two
// queued two minutes apart (a re-queue), with SR read on three of the five.
function corpus() {
  return [
    match({ key: 'a1', utc: '2026-08-05T20:00:00Z', result: 'victory', sr: [{ hero: 'lucio', sr: 2700, change: 22 }] }),
    match({ key: 'a2', utc: '2026-08-06T20:00:00Z', result: 'defeat', hero: 'ana' }),
    match({ key: 'b1', utc: '2026-08-20T20:00:00Z', result: 'defeat', sr: [{ hero: 'lucio', sr: 2678, change: -22 }] }),
    match({ key: 'b2', utc: '2026-08-20T20:16:00Z', result: 'defeat', sr: [{ hero: 'lucio', sr: 2656 }] }),
    match({ key: 'b3', utc: '2026-08-20T20:32:00Z', result: 'victory', hero: 'ana', sr: [{ hero: 'ana', sr: 2400, change: 20 }] }),
  ]
}

async function open(page: import('@playwright/test').Page, rows: unknown[]) {
  await seedDossierLayout(page, { 1: WIDGETS.slice(0, 3), 2: WIDGETS.slice(3) })
  await page.route('**/api/v1/matches', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) }))
  await page.goto('/')
  await expect(page.getByRole('tab', { name: /^Matches/ })).toBeVisible()
}

test.describe('analytics widgets', () => {
  test('each one reaches the page and reports on the corpus it was given', async ({ page }) => {
    await open(page, corpus())

    // SR: read on 3 of the 5 matches — and the tile says which, rather than
    // quoting a rate as if every match backed it.
    await expect(page.getByText(/read on 3 of 5/)).toBeVisible()
    // The card with an unreadable movement pill contributes no reading, so
    // lucio's two readings net out and ana's one stands alone.
    await expect(page.getByRole('progressbar', { name: /^ana SR movement/ })).toBeVisible()

    // The queue split: b2 and b3 were each queued 2 minutes after the last
    // one ended. Measured finish-to-finish, that gap read as 16 and this row
    // was empty for everybody.
    await expect(page.getByText('Re-queued within 5 min')).toBeVisible()
    await expect(page.getByRole('progressbar', { name: /^Re-queued within 5 min/ })).toBeVisible()

    // The patch split names the boundary it used.
    await expect(page.getByText(/Season 4/)).toBeVisible()

    // The trend lines caption each hero with its latest rolling rate.
    await expect(page.getByRole('img', { name: /Rolling win rate lucio:/ })).toBeVisible()
  })

  test('says what it does not know instead of printing zeros', async ({ page }) => {
    // The same corpus with every SR reading and every close-together queue
    // removed: one match, a fortnight before the newest patch.
    await open(page, [match({ key: 'lonely', utc: '2026-08-05T20:00:00Z', result: 'victory' })])

    await expect(page.getByText('No SR readings in this window.')).toBeVisible()
    await expect(page.getByText('No SR readings in this set.')).toBeVisible()
    await expect(page.getByText('Not enough back-to-back games to compare.')).toBeVisible()
    // Nothing anywhere claims a rate it did not measure.
    await expect(page.getByText('0 SR/wk')).toHaveCount(0)
  })
})
