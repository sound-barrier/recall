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
    // At 70% a 5-loss run is ~15% per 100 games — the honest register is
    // "rare, but real", not "normal".
    await expect(page.locator('[data-elo-stat="streak"]')).toContainText(/rare, but real/i)
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

    // The season receipt ANSWERS the sub-50 case instead of vanishing.
    const season = page.locator('[data-elo-stat="season"]')
    await expect(season).toContainText(/not at this rate/i)
    await expect(season).toContainText(/you'd need about \d+(\.\d+)?%/i)
  })

  test('losing at volume gets the honest dip answer, not "near even"', async ({ page }) => {
    seq = 0
    // 400 decisive at 45% — measured well, clearly leaning below even, yet
    // (barely) not significant. The receipt must not call this "near even"
    // OR "too few games": it is a real, fixable dip.
    const rows = [
      rec('victory', 'lucio', { rank: 'gold', level: 2, rank_progress: 40, change_percent: 21, modifiers: ['victory', 'expected'] }),
      ...games(399, 179, 'lucio'), // + the ranked win above = 180W/220L
    ]
    await mockCorpus(page, rows)
    await openCalculator(page)

    const cell = page.locator('[data-elo-stat="p-value"]')
    await expect(cell).toContainText(/a real dip/i)
    await expect(cell).toContainText(/playbook/i)
    await expect(cell).not.toContainText(/near even/i)
    await expect(cell).not.toContainText(/slow climb/i)
    await expect(cell).not.toContainText(/too few games/i)
  })

  test('picking heroes re-seeds the win rate from their pooled record', async ({ page }) => {
    await mockCorpus(page, corpus70())
    await openCalculator(page)

    // Hero rows speak the Hero Pool band language: pool/off badge + the
    // right-aligned record stat (ana is below the 5-game pool floor).
    await expect(page.locator('[data-elo-hero="lucio"] [data-pool-badge]')).toHaveText(/^pool$/i)
    await expect(page.locator('[data-elo-hero="ana"] [data-pool-badge]')).toHaveText(/^off$/i)
    await expect(page.locator('[data-elo-hero="lucio"] [data-elo-hero-stat]')).toContainText('24x · 75%')

    // Select only lucio: 18W/6L → 75%, n=24.
    await page.locator('[data-elo-hero="lucio"] input[type="checkbox"]').check()
    await expect(page.locator('[data-elo-input="win-rate"]')).toHaveValue('75')
    await expect(page.locator('[data-elo-input="sample-n"]')).toHaveValue('24')
  })

  test('the rigged receipt is honest at volume: near even and measured, not "too few games"', async ({ page }) => {
    seq = 0
    // 500 decisive games at 51.0% — a season and a half of play. The old copy
    // called this "too few games to tell", which reads absurd at this volume:
    // the truth is the rate is PINNED near even, and that's the answer.
    const rows = [
      rec('victory', 'lucio', { rank: 'gold', level: 2, rank_progress: 40, change_percent: 21, modifiers: ['victory', 'expected'] }),
      ...games(499, 254, 'lucio'), // + the ranked win above = 255W/245L
    ]
    await mockCorpus(page, rows)
    await openCalculator(page)

    const cell = page.locator('[data-elo-stat="p-value"]')
    await expect(cell).toContainText(/near even/i)
    await expect(cell).toContainText(/\d+–\d+%/) // the pinned credible range
    await expect(cell).not.toContainText(/too few games/i)
    await expect(cell).not.toContainText(/play more/i)

    // The coin cell speaks odds, not seminar: no "forced 50-50" jargon, and
    // the straddling range is EXPLAINED (more of it above even than below)
    // rather than left to read as a contradiction.
    const coin = page.locator('[data-elo-stat="bayes"]')
    await expect(coin).toContainText(/in 100/)
    await expect(coin).toContainText(/more of it above|leans below|dead even/i)
    await expect(coin).not.toContainText(/skeptic's own assumption/i)
    await expect(coin).not.toContainText(/forced 50-50/i)

    // The season receipt names its assumption and carries the decay
    // counterweight instead of silently contradicting the capped verdict.
    const season = page.locator('[data-elo-stat="season"]')
    await expect(season).toContainText(/if your 51% holds/i)
    await expect(season).toContainText(/amber future/i)
  })

  test('the page tells its story in order: truth, playbook, price, proof, receipts', async ({ page }) => {
    await mockCorpus(page, corpus70())
    await openCalculator(page)

    const bandLocator = page.locator('#panel-elo section.elo-band[aria-labelledby]')
    const bands: (string | null)[] = []
    for (let i = 0; i < await bandLocator.count(); i++) {
      bands.push(await bandLocator.nth(i).getAttribute('aria-labelledby'))
    }
    const at = (id: string) => bands.indexOf(id)
    expect(at('elo-verdict-title')).toBeGreaterThanOrEqual(0)
    expect(at('elo-sim-title')).toBeGreaterThan(at('elo-verdict-title'))
    expect(at('elo-playbook-title')).toBeGreaterThan(at('elo-sim-title'))
    expect(at('elo-adjust-title')).toBeGreaterThan(at('elo-playbook-title'))
    // The why-you're-stuck receipts close the page.
    expect(bands[bands.length - 1]).toBe('elo-myths-title')

    // The demoted improvement blocks live INSIDE the playbook band.
    await expect(page.locator('[data-elo-playbook] [data-elo-lift]')).toBeVisible()
    await expect(page.locator('[data-elo-playbook] [data-elo-evidence="reviews"]')).toBeVisible()
  })

  test('the playbook opens with ranked, priced next moves', async ({ page }) => {
    await mockCorpus(page, corpus70())
    await openCalculator(page)

    const card = page.locator('[data-elo-next-moves]')
    await expect(card).toBeVisible()
    const moves = card.locator('[data-elo-move]')
    expect(await moves.count()).toBeGreaterThanOrEqual(2)
    // Nothing reviewed in the corpus → reviewing leads the list.
    await expect(moves.first()).toContainText(/review/i)
  })

  test('the playbook approximates the best-vs-worst hero climb gap', async ({ page }) => {
    seq = 0
    // lucio 30 games at 70% vs brigitte 20 at 35% — both past the evidence
    // floor, a spread worth pricing. Meter pools are thin (one rank card),
    // so the naive drift fallback prices it.
    const rows = [
      rec('victory', 'lucio', { rank: 'gold', level: 2, rank_progress: 40, change_percent: 21, modifiers: ['victory', 'expected'] }),
      ...games(29, 20, 'lucio'),
      ...games(20, 7, 'brigitte'),
    ]
    await mockCorpus(page, rows)
    await openCalculator(page)

    const gap = page.locator('[data-elo-hero-gap]')
    await expect(gap).toBeVisible()
    await expect(gap).toContainText(/l[uú]cio/i)
    await expect(gap).toContainText(/brigitte/i)
    await expect(gap).toContainText(/% meter per game faster/i)
    await expect(gap).toContainText(/division/i)
  })

  test('the projection chart renders with a target markline caption', async ({ page }) => {
    await mockCorpus(page, corpus70())
    await openCalculator(page)

    const chart = page.locator('[data-elo-chart]')
    await expect(chart).toBeVisible()
    await expect(chart.locator('canvas')).toBeVisible()
    await expect(page.locator('[data-elo-chart-caption]')).toContainText(/two futures/i)
  })

  test('nudging a hero shifts the blend by its share, one point per press up to ±5', async ({ page }) => {
    await mockCorpus(page, corpus70())
    await openCalculator(page)

    // ▲ once on lucio: +1 point on 24 of the track's 40 games = +0.6 blended.
    const lucio = page.locator('[data-elo-hero="lucio"]')
    const up = lucio.locator('[data-elo-nudge="up"]')
    const down = lucio.locator('[data-elo-nudge="down"]')
    await up.click()
    const summary = page.locator('[data-elo-whatif-summary]')
    await expect(summary).toContainText('70% → 70.6%')
    await expect(lucio).toContainText('75% → 76%')
    await expect(page.locator('[data-elo-input="win-rate"]')).toHaveValue('70')

    // Four more presses saturate at +5 (75% → 80%), blending to 73% — and
    // every projection follows: naive E = 1.6 / (0.21·0.46) → ~17 games.
    for (let i = 0; i < 4; i++) await up.click()
    await expect(summary).toContainText('70% → 73%')
    await expect(lucio).toContainText('75% → 80%')
    await expect(up).toBeDisabled()
    await expect(page.locator('[data-elo-card="naive"]')).toContainText(/~\s*17 games/)

    // ▼ down to the −5 floor: a slump on the main slows the climb, 70% → 67%.
    for (let i = 0; i < 10; i++) await down.click()
    await expect(summary).toContainText('70% → 67%')
    await expect(lucio).toContainText('75% → 70%')
    await expect(down).toBeDisabled()

    // Reset drops the layer and the verdict returns to the measured ~20.
    await page.locator('[data-elo-nudge-reset]').click()
    await expect(summary).toBeHidden()
    await expect(page.locator('[data-elo-card="naive"]')).toContainText(/~\s*20 games/)
  })
})
