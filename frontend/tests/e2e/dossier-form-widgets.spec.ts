/**
 * The climb-form widget family, end-to-end over a crafted corpus:
 *
 *   - Recent form (default, row 1): win rate over the last 20 decisive
 *     games vs the overall rate, with the signed gap.
 *   - After 2+ losses (gallery): win rate of games that follow two or
 *     more consecutive losses — the stop-loss signal.
 *   - Session depth (gallery): win rate by how deep into a play
 *     session the game was.
 *   - Time of day (gallery): buckets judged by WIN RATE, not volume
 *     share — "when do I win", not "when do I play".
 *
 * Corpus: 30 decisive games, 3 per day across 10 consecutive days
 * (one session per day at 20:00 / 20:30 / 21:00). Hand-computed:
 *   overall 19W-11L = 63% · last 20 = 13W-7L = 65% → delta +2
 *   after 2+ losses: games 6,9,15,20,25,26 → 5W-1L = 83% over 6
 *   session depth: game1 50% · game2 60% · game3 80% · game4+ no sample
 */
import { test, expect } from './_fixtures'
import type { Route } from '@playwright/test'

// W/L per position, chronological. Positions 3d-2..3d belong to day d.
const RESULTS = [
  'W', 'W', 'W', 'L', 'L', 'W', 'L', 'L', 'W', 'W',
  'W', 'W', 'L', 'L', 'W', 'W', 'W', 'L', 'L', 'W',
  'W', 'W', 'L', 'L', 'L', 'W', 'W', 'W', 'W', 'W',
] as const

const GAME_TIMES = ['20:00', '20:30', '21:00'] as const

function corpus() {
  const out = []
  for (let i = 0; i < RESULTS.length; i++) {
    const day = Math.floor(i / 3) // 0..9, day 9 = today
    const d = new Date()
    d.setDate(d.getDate() - (9 - day))
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const finished = GAME_TIMES[i % 3]!
    out.push({
      match_key: `m${String(i + 1).padStart(2, '0')}`,
      source_files: [`m${i + 1}.png`],
      source_types: { [`m${i + 1}.png`]: 'summary' },
      data: {
        map: 'rialto', playlist: 'competitive', game_mode: 'escort',
        role: 'support', hero: 'lucio',
        result: RESULTS[i] === 'W' ? 'victory' : 'defeat',
        date, finished_at: finished,
        eliminations: 12, assists: 8, deaths: 6,
        heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '10:00' }],
      },
      parsed_at: `${date}T${finished}:00Z`,
    })
  }
  return out
}

test.describe('climb-form widgets', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(corpus()),
      })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.set-dossier')).toBeVisible()
  })

  test('Recent form reads the last-20 rate with the signed gap vs overall', async ({ page }) => {
    const widget = page.locator('[data-widget-id="form-delta"]')
    await expect(widget).toBeVisible()
    await expect(widget.locator('.kpi-value')).toHaveText('65%')
    await expect(widget).toContainText('+2 pts')
    await expect(widget).toContainText('63% overall')
  })

  test('After 2+ losses surfaces the stop-loss rate over its real sample', async ({ page }) => {
    await page.locator('[data-dossier-add]').click()
    await page.locator('[data-widget-add="loss-streak-recovery"]').click()
    const widget = page.locator('[data-widget-id="loss-streak-recovery"]')
    await expect(widget).toBeVisible()
    await expect(widget.locator('.kpi-value')).toHaveText('83%')
    await expect(widget).toContainText('6 games')
  })

  test('Session depth buckets win rate by game number within a session', async ({ page }) => {
    await page.locator('[data-dossier-add]').click()
    await page.locator('[data-widget-add="session-depth"]').click()
    const widget = page.locator('[data-widget-id="session-depth"]')
    await expect(widget).toBeVisible()

    const rows = widget.locator('li')
    await expect(rows).toHaveCount(4)
    await expect(rows.nth(0)).toContainText('Game 1')
    await expect(rows.nth(0)).toContainText('50%')
    await expect(rows.nth(1)).toContainText('Game 2')
    await expect(rows.nth(1)).toContainText('60%')
    await expect(rows.nth(2)).toContainText('Game 3')
    await expect(rows.nth(2)).toContainText('80%')
    // No session ran 4+ games — the bucket reads as no-sample, not 0%.
    await expect(rows.nth(3)).toContainText('Game 4+')
    await expect(rows.nth(3)).toContainText('—')
  })

  test('Time of day judges buckets by win rate, not volume share', async ({ page }) => {
    await page.locator('[data-dossier-add]').click()
    await page.locator('[data-widget-add="time-of-day"]').click()
    const widget = page.locator('[data-widget-id="time-of-day"]')
    await expect(widget).toBeVisible()

    // Every game finished 20:00–21:00 → the 20–24 bucket carries the
    // corpus winrate; under the old volume rendering it read 100%.
    const evening = widget.locator('li', { hasText: '20–24' })
    await expect(evening).toContainText('63%')
    // A bucket with no games reads as no-sample.
    const smallHours = widget.locator('li', { hasText: '00–04' })
    await expect(smallHours).toContainText('—')
  })
})
