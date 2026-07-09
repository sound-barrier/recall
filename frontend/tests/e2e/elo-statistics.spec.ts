/**
 * Elo Calculator — the statistics layer.
 *
 * Beyond the two projection models: a Beta-posterior "skeptic's verdict"
 * (better-than-a-coin probability + credible interval), an honest timeline
 * (posterior-predictive fast/median/slow percentiles + games-to-certainty),
 * a decay slope MEASURED from the player's own climb (with a plateau
 * preview), a Wald–Wolfowitz streakiness check, win/loss stat separators
 * ("what to change"), streak-depth win rates + streak meter impact, and
 * empirical-Bayes adjusted hero rates in the picker.
 *
 * Corpus (support role queue, 60 decisive games, every game rank-bearing):
 *   OLD band (seq 60..31): gold 5–4, three 10-game blocks of 7W/3L (70%).
 *   NEW band (seq 30..1):  gold 2–1, three 10-game blocks of 6W/4L (60%).
 *   Total 39W/21L = 65% — win rate FALLS as rank climbs, so the fitted
 *   decay slope is positive and lands in the input's 0.5–5 pts/div band.
 *   Latest reading: gold 1 @ 50% (ladder 14.5) → default target Plat 5.
 *   Meter: streak-modified games move ±30, normal games ±20.
 *   Performance: deaths ~4/10 in wins vs ~6.5/10 in losses (the driver).
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

function localYMD(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const REFERENCE_DATA = {
  heroes_by_role: { support: ['Lúcio', 'Ana'], dps: ['Ashe'], tank: ['Zarya'] },
  maps_by_game_mode: { control: ['Ilios'] },
  screenshot_sources: [],
  seasons: [],
}

// Ten-game result blocks, oldest→newest within the block. Games that sit
// 2nd+ inside a run carry the matching streak modifier (the rank card's
// 'win streak' / 'loss streak'), and streak games move the meter ±30 vs
// the normal ±20 — the "streaks move your rank double" fixture.
type B = { r: 'victory' | 'defeat'; streak?: 'win streak' | 'loss streak' }
const BLOCK_70: B[] = [ // 7W/3L — the OLD (lower-rank) band
  { r: 'victory' }, { r: 'victory', streak: 'win streak' },
  { r: 'defeat' }, { r: 'defeat', streak: 'loss streak' },
  { r: 'victory' }, { r: 'victory', streak: 'win streak' }, { r: 'victory', streak: 'win streak' },
  { r: 'defeat' }, { r: 'victory' }, { r: 'victory', streak: 'win streak' },
]
const BLOCK_60: B[] = [ // 6W/4L — the NEW (higher-rank) band
  { r: 'victory' }, { r: 'victory', streak: 'win streak' },
  { r: 'defeat' }, { r: 'defeat', streak: 'loss streak' }, { r: 'defeat', streak: 'loss streak' },
  { r: 'victory' }, { r: 'victory', streak: 'win streak' }, { r: 'victory', streak: 'win streak' },
  { r: 'defeat' }, { r: 'victory' },
]

// seq 1 = newest. Chronological order is seq 60 → 1: BLOCK_70 ×3, then
// BLOCK_60 ×3. Bands pin the rank fields; progress walks deterministically.
function climb60() {
  const chronological: B[] = [
    ...BLOCK_70, ...BLOCK_70, ...BLOCK_70,
    ...BLOCK_60, ...BLOCK_60, ...BLOCK_60,
  ]
  const rows = chronological.map((g, idx) => {
    const seq = 60 - idx // idx 0 is the oldest game
    const isOld = idx < 30
    const win = g.r === 'victory'
    const move = g.streak ? 30 : 20
    const level = isOld ? (idx < 15 ? 5 : 4) : (idx < 45 ? 2 : 1)
    const progress = seq === 60 - 59 ? 50 : (idx * 7) % 100 // newest = gold 1 @ 50
    const utc = `${localYMD(-seq)}T12:00:00Z`
    const modifiers = [g.r, ...(g.streak ? [g.streak] : []), 'expected']
    return {
      match_key: `m${seq}`,
      source_files: [`${seq}.png`],
      parsed_at: utc,
      queue_type: 'role',
      data: {
        map: 'ilios', playlist: 'competitive', hero: 'lucio', role: 'support', result: g.r,
        date: utc.slice(0, 10), finished_at: `12:${String(seq % 60).padStart(2, '0')}`,
        played_at_utc: utc, game_length: '10:00',
        heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '10:00' }],
        rank: 'gold', level, rank_progress: progress,
        change_percent: win ? move : -move, modifiers,
        performance: {
          deaths: { total: win ? 4 : 7, avg_per_10min: (win ? 4.0 : 6.5) + (seq % 3) * 0.2 },
          eliminations: { total: 20, avg_per_10min: (win ? 22 : 18) + (seq % 3) * 0.3 },
        },
      },
    }
  })
  // A tiny out-of-pool hero with a hot small record — the shrinkage fixture:
  // ana 3W/0L raw 100% must display an adjusted (pulled-toward-pool) rate.
  for (let i = 0; i < 3; i++) {
    const seq = 61 + i
    const utc = `${localYMD(-seq)}T12:00:00Z`
    rows.push({
      match_key: `m${seq}`, source_files: [`${seq}.png`], parsed_at: utc, queue_type: 'role',
      data: {
        map: 'ilios', playlist: 'competitive', hero: 'ana', role: 'support', result: 'victory',
        date: utc.slice(0, 10), finished_at: '12:00', played_at_utc: utc, game_length: '10:00',
        heroes_played: [{ hero: 'ana', percent_played: 100, play_time: '10:00' }],
      },
    } as never)
  }
  return rows
}

async function openCalculator(page: import('@playwright/test').Page) {
  await page.route('**/api/v1/system/reference-data', (r: Route) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(REFERENCE_DATA) }))
  await page.route('**/api/v1/matches', (r: Route) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(climb60()) }))
  await page.goto('/')
  await page.locator('#tab-elo').click()
  await expect(page.locator('#panel-elo')).toBeVisible()
}

test.describe('Elo Calculator — statistics layer', () => {
  test('skeptic verdict: Beta-posterior better-than-a-coin + credible interval', async ({ page }) => {
    await openCalculator(page)
    const cell = page.locator('[data-elo-stat="bayes"]')
    await expect(cell).toBeVisible()
    // A probability headline + the true-win-rate credible range in the note.
    await expect(cell).toContainText(/%/)
    await expect(cell).toContainText(/true win rate/i)
    await expect(cell).toContainText(/–|-/)
  })

  test('honest timeline: posterior percentiles + games-to-certainty', async ({ page }) => {
    await openCalculator(page)
    const timeline = page.locator('[data-elo-timeline]')
    await expect(timeline).toBeVisible()
    await expect(timeline).toContainText(/median/i)
    await expect(timeline).toContainText(/games/i)
    // Sample-size honesty: how many more games until the rate is pinned down.
    await expect(page.locator('[data-elo-know]')).toContainText(/±\s?3/)
  })

  test('decay slope is measured from the climb and previews the plateau', async ({ page }) => {
    await openCalculator(page)
    // The Advanced group holds the slope input; open it first.
    await page.locator('.elo-advanced summary').click()
    await expect(page.locator('[data-elo-slope-hint]')).toContainText(/measured from your climb/i)
    // Live consequence line: names the rank the current slope levels off at.
    await expect(page.locator('[data-elo-plateau]')).toContainText(/gold|platinum|diamond|master/i)
    // The measured value seeds the input inside its 0.5–5 band.
    const v = Number(await page.locator('[data-elo-input="decay-slope"]').inputValue())
    expect(v).toBeGreaterThanOrEqual(0.5)
    expect(v).toBeLessThanOrEqual(5)
  })

  test('streakiness myth check runs the Wald–Wolfowitz test on the real sequence', async ({ page }) => {
    await openCalculator(page)
    const cell = page.locator('[data-elo-stat="runs"]')
    await expect(cell).toBeVisible()
    await expect(cell).toContainText(/p [=<]/)
    // This corpus's runs count sits within chance — the calm verdict.
    await expect(cell).toContainText(/coin|chance|normal/i)
  })

  test('stat drivers: deaths separate wins from losses', async ({ page }) => {
    await openCalculator(page)
    const drivers = page.locator('[data-elo-drivers]')
    await expect(drivers).toBeVisible()
    const deaths = page.locator('[data-elo-driver="deaths"]')
    await expect(deaths).toContainText(/wins/i)
    await expect(deaths).toContainText(/losses/i)
    // Association-honesty fine print.
    await expect(drivers).toContainText(/not causation/i)
  })

  test('streak evidence: depth win rates + the meter moves more inside streaks', async ({ page }) => {
    await openCalculator(page)
    const depth = page.locator('[data-elo-evidence="streak-tilt"]')
    await expect(depth).toBeVisible()
    await expect(depth).toContainText(/%/)
    await expect(depth).toContainText(/loss/i)

    const meter = page.locator('[data-elo-evidence="streak-meter"]')
    await expect(meter).toBeVisible()
    // Streak games move ±30 vs ±20 normal → the ratio and both magnitudes.
    await expect(meter).toContainText(/30/)
    await expect(meter).toContainText(/20/)
    await expect(meter).toContainText(/1\.5/)
  })

  test('hero picker shows an adjusted rate for hot small samples', async ({ page }) => {
    await openCalculator(page)
    const ana = page.locator('[data-elo-hero="ana"]')
    await expect(ana).toBeVisible()
    // 3W/0L raw 100% — the shrunk display pulls it toward the pool rate.
    await expect(ana).toContainText(/100%/)
    await expect(ana).toContainText(/adj/i)
  })
})
