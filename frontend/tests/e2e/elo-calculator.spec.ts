/**
 * Elo Calculator tab — loan-calculator math for ranked climbing.
 *
 * Inputs seed from the picked track's actual history (rank readings, decisive
 * W/L, measured per-game meter move, pace) and stay editable; two models
 * project games-to-target side by side (naive constant-WR random walk vs ELO
 * decay toward the implied true rank); the hero picker re-seeds the win rate
 * from the selected heroes' pooled record.
 *
 * Corpus (support role queue, competitive, all within the last 28 days):
 *   lucio    24 games (18W  6L)  — in pool
 *   brigitte 12 games ( 8W  4L)  — in pool
 *   ana       4 games ( 2W  2L)  — out of pool (below the 5-game floor)
 *   total    40 decisive (28W 12L = 70%) → Wilson lower ≈ 54.6% > 50% (finite CI)
 * Rank readings: latest = Gold 2 @ 40% (ladder 13.4); meter samples
 * |+22|, |−20|, |+21| → mean 21 (a calibration +35 and a 0 reading are excluded).
 * Defaults: target = one tier up, division 5 → Platinum 5 (ladder 15), D = 1.6.
 * Naive: δ = 0.21·(2·0.7−1) = 0.084 → E ≈ 19 games.
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
  heroes_by_role: { support: ['Lúcio', 'Brigitte', 'Ana'], dps: ['Ashe'], tank: ['Zarya'] },
  maps_by_game_mode: { control: ['Ilios'] },
  screenshot_sources: [],
  seasons: [],
}

let seq = 0
interface RankBits { rank?: string; level?: number; rank_progress?: number; change_percent?: number; modifiers?: string[] }
function rec(result: string, hero: string, rankBits?: RankBits) {
  seq++
  const utc = `${localYMD(-seq)}T12:00:00Z`
  return {
    match_key: `m${seq}`,
    source_files: [`${seq}.png`],
    parsed_at: utc,
    queue_type: 'role',
    data: {
      map: 'ilios', playlist: 'competitive', hero, role: 'support', result,
      date: utc.slice(0, 10), finished_at: `12:${String(seq % 60).padStart(2, '0')}`,
      played_at_utc: utc, game_length: '10:00',
      heroes_played: [{ hero, percent_played: 100, play_time: '10:00' }],
      ...(rankBits ?? {}),
    },
  }
}

function games(n: number, wins: number, hero: string) {
  return Array.from({ length: n }, (_, i) => rec(i < wins ? 'victory' : 'defeat', hero))
}

function corpus70() {
  seq = 0
  const rows = [
    // Latest match carries the current rank reading (seq=1 is the most recent day).
    rec('victory', 'lucio', { rank: 'gold', level: 2, rank_progress: 40, change_percent: 22, modifiers: ['victory', 'expected'] }),
    rec('defeat', 'lucio', { rank: 'gold', level: 2, rank_progress: 18, change_percent: -20, modifiers: ['defeat', 'expected'] }),
    rec('victory', 'lucio', { rank: 'gold', level: 3, rank_progress: 95, change_percent: 21, modifiers: ['victory', 'expected'] }),
    // Excluded meter samples: calibration modifier + a zero reading.
    rec('victory', 'lucio', { rank: 'gold', level: 3, rank_progress: 70, change_percent: 35, modifiers: ['victory', 'calibration'] }),
    rec('victory', 'lucio', { rank: 'gold', level: 3, rank_progress: 40, change_percent: 0, modifiers: ['victory', 'expected'] }),
    ...games(19, 14, 'lucio'), // + the 5 ranked lucio games above = 24 games, 18W 6L
    ...games(12, 8, 'brigitte'),
    ...games(4, 2, 'ana'),
  ]
  return rows
}

function corpus48() {
  seq = 0
  return [
    rec('victory', 'lucio', { rank: 'gold', level: 2, rank_progress: 40, change_percent: 21, modifiers: ['victory', 'expected'] }),
    ...games(49, 23, 'lucio'), // total 50 decisive, 24W 26L = 48%
  ]
}

async function mockCorpus(page: import('@playwright/test').Page, rows: unknown[]) {
  await page.route('**/api/v1/system/reference-data', (r: Route) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(REFERENCE_DATA) }))
  await page.route('**/api/v1/matches', (r: Route) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) }))
}

async function openCalculator(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.locator('#tab-elo').click()
  await expect(page.locator('#panel-elo')).toBeVisible()
}

test.describe('Elo Calculator', () => {
  test('tab 06 opens a proper tabpanel and seeds inputs from the support track', async ({ page }) => {
    await mockCorpus(page, corpus70())
    await openCalculator(page)

    const panel = page.locator('#panel-elo')
    await expect(panel).toHaveAttribute('role', 'tabpanel')
    await expect(panel).toHaveAttribute('aria-labelledby', 'tab-elo')

    // The support track (the only one with data) is picked and seeds the form.
    await expect(page.locator('[data-elo-track="support"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('[data-elo-current="tier"]')).toHaveValue('gold')
    await expect(page.locator('[data-elo-current="division"]')).toHaveValue('2')
    await expect(page.locator('[data-elo-current="progress"]')).toHaveValue('40')
    await expect(page.locator('[data-elo-input="win-rate"]')).toHaveValue('70')
    await expect(page.locator('[data-elo-input="sample-n"]')).toHaveValue('40')
    // Mean |change_percent| of 22, 20, 21 — calibration + zero readings excluded.
    await expect(page.locator('[data-elo-input="meter-move"]')).toHaveValue('21')
  })

  test('both models project a finite climb to the default target (Platinum 5)', async ({ page }) => {
    await mockCorpus(page, corpus70())
    await openCalculator(page)

    // Default target: one tier up, division 5.
    await expect(page.locator('[data-elo-target="tier"]')).toHaveValue('platinum')
    await expect(page.locator('[data-elo-target="division"]')).toHaveValue('5')

    const naive = page.locator('[data-elo-card="naive"]')
    await expect(naive).toContainText(/~\s*20 games/)
    // Wilson lower ≈ 54.6% keeps the range finite: "Best case ~N".
    await expect(naive).toContainText(/best case ~\d+/i)

    const decay = page.locator('[data-elo-card="decay"]')
    await expect(decay).toContainText(/games/)
    await expect(decay).toContainText(/ceiling/i)

    // The verdict leads with a plain-language answer.
    await expect(page.locator('[data-elo-answer]')).toContainText(/games|reach|near/i)

    // Myth-check chips answer the three complaints in plain language, each
    // keeping its raw stat in a muted aside.
    await expect(page.locator('[data-elo-stat="p-value"]')).toContainText(/p [=<]/)
    await expect(page.locator('[data-elo-stat="percentile"]')).toContainText(/%/)
    await expect(page.locator('[data-elo-stat="streak"]')).toContainText(/normal/i)
  })

  test('a sub-50% win rate yields honest unreachable verdicts', async ({ page }) => {
    await mockCorpus(page, corpus48())
    await openCalculator(page)

    await expect(page.locator('[data-elo-input="win-rate"]')).toHaveValue('48')
    await expect(page.locator('[data-elo-card="naive"]')).toContainText(/out of reach|cost you rank/i)
    // Decay: required WR = 50 + 1.5·(15 − 13.4) = 52.4%.
    await expect(page.locator('[data-elo-card="decay"]')).toContainText(/52\.4%/)
    // The headline verdict is the honest reality check, not a fantasy count.
    await expect(page.locator('[data-elo-answer]')).toContainText(/capped|reality|52\.4%/i)
  })

  test('picking heroes re-seeds the win rate from their pooled record', async ({ page }) => {
    await mockCorpus(page, corpus70())
    await openCalculator(page)

    // Hero rows show record + pool badges (ana is below the 5-game pool floor).
    await expect(page.locator('[data-elo-hero="lucio"] [data-pool-badge]')).toContainText(/in pool/i)
    await expect(page.locator('[data-elo-hero="ana"] [data-pool-badge]')).toContainText(/out/i)

    // Select only lucio: 18W/6L → 75%, n=24.
    await page.locator('[data-elo-hero="lucio"] input[type="checkbox"]').check()
    await expect(page.locator('[data-elo-input="win-rate"]')).toHaveValue('75')
    await expect(page.locator('[data-elo-input="sample-n"]')).toHaveValue('24')
  })

  test('the projection chart renders with a target markline caption', async ({ page }) => {
    await mockCorpus(page, corpus70())
    await openCalculator(page)

    const chart = page.locator('[data-elo-chart]')
    await expect(chart).toBeVisible()
    await expect(chart.locator('canvas')).toBeVisible()
    await expect(page.locator('[data-elo-chart-caption]')).toContainText(/two futures/i)
  })
})
