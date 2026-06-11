/**
 * Dossier review-coverage widgets — `Matches reviewed` + `Days since
 * last review` KPI tiles.
 *
 * The tiles read directly off `reviewed_by` + `reviewed_at` on the
 * MatchRecord JSON the dossier composable consumes. We mock the
 * matches endpoint with a mixed corpus (reviewed + unreviewed) and
 * pin the subtitle / value cells.
 */
import { test, expect } from './_fixtures'
import type { Route } from '@playwright/test'

function record(matchKey: string, opts: {
  reviewedBy?: 'self' | 'coach'
  reviewedAt?: string
  result?: 'victory' | 'defeat' | 'draw'
  parsedAt?: string
} = {}) {
  const rec: Record<string, unknown> = {
    match_key: matchKey,
    source_files: [`${matchKey}.png`],
    source_types: { [`${matchKey}.png`]: 'summary' },
    data: {
      map: 'rialto', playlist: 'competitive', game_mode: 'control',
      role: 'support', hero: 'lucio',
      result: opts.result ?? 'victory', date: '2026-05-10', finished_at: '22:00',
      eliminations: 17, assists: 16, deaths: 11,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '11:25' }],
    },
    parsed_at: opts.parsedAt ?? '2026-05-10T22:30:00Z',
  }
  if (opts.reviewedBy) rec.reviewed_by = opts.reviewedBy
  if (opts.reviewedAt) rec.reviewed_at = opts.reviewedAt
  return rec
}

test.describe('dossier — review-coverage widgets', () => {
  test('renders Matches reviewed count + percentage subtitle', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      // 2 reviewed (one self + one coach), 2 not reviewed → 50%.
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([
          record('m1', { reviewedBy: 'self',  reviewedAt: '2026-06-01T10:00:00Z' }),
          record('m2'),
          record('m3', { reviewedBy: 'coach', reviewedAt: '2026-06-03T10:00:00Z' }),
          record('m4'),
        ]),
      })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    const tile = page.locator('[data-kpi="reviewed-count"]')
    await expect(tile).toBeVisible()
    await expect(tile.locator('.kpi-eyebrow')).toHaveText('Matches reviewed')
    await expect(tile.locator('.kpi-value')).toHaveText('2')
    // Subtitle reads "50% of 4 matches" — both the share AND the
    // denominator. No "(s)" trailing in this corpus.
    await expect(tile.locator('.kpi-sub')).toContainText('50%')
    await expect(tile.locator('.kpi-sub')).toContainText('4 matches')
  })

  test('Matches reviewed shows em-dash for an empty corpus', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    const tile = page.locator('[data-kpi="reviewed-count"]')
    await expect(tile.locator('.kpi-value')).toHaveText('—')
    // No subtitle when there are zero matches.
    await expect(tile.locator('.kpi-sub')).toHaveCount(0)
  })

  test('Days since last review reflects the most-recent reviewed_at', async ({ page }) => {
    // Pin the browser clock so the day-math doesn't drift between
    // local + CI timezones. 2026-06-10T12:00Z — 7 days after m3's
    // review and 9 after m1's, so the widget reads "7 days ago".
    await page.addInitScript(() => {
      const FIXED = Date.UTC(2026, 5, 10, 12, 0, 0)
      const _Date = Date
      const Stub = function (this: unknown, ...args: unknown[]) {
        if (args.length === 0) return new _Date(FIXED)
        // @ts-expect-error -- forward unknown-args ctor
        return new _Date(...args)
      } as unknown as DateConstructor
      Stub.now = () => FIXED
      Stub.parse = _Date.parse
      Stub.UTC = _Date.UTC
      Stub.prototype = _Date.prototype
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(globalThis as any).Date = Stub
    })

    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([
          record('older',  { reviewedBy: 'self',  reviewedAt: '2026-06-01T12:00:00Z' }),
          record('newer',  { reviewedBy: 'coach', reviewedAt: '2026-06-03T12:00:00Z' }),
          record('plain'),
        ]),
      })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    const tile = page.locator('[data-kpi="days-since-review"]')
    await expect(tile).toBeVisible()
    await expect(tile.locator('.kpi-eyebrow')).toHaveText('Days since last review')
    await expect(tile.locator('.kpi-value')).toHaveText('7')
    await expect(tile.locator('.kpi-sub')).toContainText('days ago')
    // Title-tip carries the precise ISO so power users can hover.
    await expect(tile.locator('.kpi-value')).toHaveAttribute('title', '2026-06-03T12:00:00Z')
  })

  test('Days since last review shows em-dash when nothing has been reviewed', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([record('m1'), record('m2')]),
      })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    const tile = page.locator('[data-kpi="days-since-review"]')
    await expect(tile.locator('.kpi-value')).toHaveText('—')
    await expect(tile.locator('.kpi-sub')).toHaveCount(0)
  })

  test('W / L / D since last review counts matches parsed AFTER the latest review', async ({ page }) => {
    const ANCHOR = '2026-06-03T12:00:00Z'
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([
          // The reviewed match itself — its parsed_at equals the anchor
          // so it does NOT count as "since".
          record('anchor', { reviewedBy: 'coach', reviewedAt: ANCHOR, parsedAt: ANCHOR, result: 'defeat' }),
          // Older matches — also not "since".
          record('old-w', { result: 'victory', parsedAt: '2026-06-01T12:00:00Z' }),
          // Three new matches after the anchor — these all count.
          record('new-w',  { result: 'victory', parsedAt: '2026-06-04T12:00:00Z' }),
          record('new-w2', { result: 'victory', parsedAt: '2026-06-05T12:00:00Z' }),
          record('new-l',  { result: 'defeat',  parsedAt: '2026-06-06T12:00:00Z' }),
        ]),
      })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    const tile = page.locator('[data-kpi="wld-since-review"]')
    await expect(tile).toBeVisible()
    await expect(tile.locator('.kpi-eyebrow')).toHaveText(/W \/ L \/ D since last review/)
    await expect(tile.locator('.kpi-value')).toHaveText('2 / 1 / 0')
    await expect(tile.locator('.kpi-sub')).toContainText('3 new matches')
    // Title-tip carries the precise anchor ISO.
    await expect(tile.locator('.kpi-value')).toHaveAttribute('title', ANCHOR)
  })

  test('W / L / D since last review reads em-dash when nothing has been reviewed', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([
          record('m1', { result: 'victory' }),
          record('m2', { result: 'defeat'  }),
        ]),
      })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    const tile = page.locator('[data-kpi="wld-since-review"]')
    await expect(tile.locator('.kpi-value')).toHaveText('—')
    await expect(tile.locator('.kpi-sub')).toHaveCount(0)
  })

  test('W / L / D since last review shows 0 / 0 / 0 + "0 new matches" when reviewed but no new matches landed', async ({ page }) => {
    const ANCHOR = '2026-06-03T12:00:00Z'
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([
          record('anchor', { reviewedBy: 'self', reviewedAt: ANCHOR, parsedAt: ANCHOR }),
          // Older matches only — none after the anchor.
          record('older', { result: 'victory', parsedAt: '2026-06-01T00:00:00Z' }),
        ]),
      })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    const tile = page.locator('[data-kpi="wld-since-review"]')
    await expect(tile.locator('.kpi-value')).toHaveText('0 / 0 / 0')
    await expect(tile.locator('.kpi-sub')).toContainText('0 new matches')
  })
})
