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
// Division walk: old half (idx < 30) gold 5→4, new half gold 2→1.
function levelAt(idx: number): number {
  if (idx < 15) return 5
  if (idx < 30) return 4
  if (idx < 45) return 2
  return 1
}

function climb60() {
  const chronological: B[] = [
    ...BLOCK_70, ...BLOCK_70, ...BLOCK_70,
    ...BLOCK_60, ...BLOCK_60, ...BLOCK_60,
  ]
  const rows = chronological.map((g, idx) => {
    const seq = 60 - idx // idx 0 is the oldest game
    const win = g.r === 'victory'
    const move = g.streak ? 30 : 20
    const level = levelAt(idx)
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

  test('hero picker keeps the shrunk rate for hot small samples in the stat tooltip', async ({ page }) => {
    await openCalculator(page)
    const ana = page.locator('[data-elo-hero="ana"]')
    await expect(ana).toBeVisible()
    // 3W/0L raw 100% — the pool-band restyle moved the shrunk "adj" rate
    // into the stat's tooltip; the visible flags are n<5 + the faded bar.
    await expect(ana).toContainText(/100%/)
    await expect(ana.locator('[data-elo-hero-stat]'))
      .toHaveAttribute('title', /shrunk toward your pooled rate/i)
    await expect(ana.locator('.elo-lown')).toBeVisible()
  })
})

test.describe('Elo Calculator — phase 2 (simulator + skill curve)', () => {
  test('the season simulator band renders its three verdict cells', async ({ page }) => {
    await openCalculator(page)
    const band = page.locator('[data-elo-sim]')
    await expect(band).toBeVisible()
    // 60 rank cards feed the empirical pools — no fallback note.
    await expect(band).not.toContainText(/not enough rank cards/i)
    await expect(page.locator('[data-elo-sim-stat="reach"]')).toContainText(/%/)
    await expect(page.locator('[data-elo-sim-stat="lower"]')).toContainText(/%/)
    // Median landing spot names a rank.
    await expect(page.locator('[data-elo-sim-stat="final"]')).toContainText(/gold|platinum|diamond|silver/i)
  })

  test('the projection chart caption gains the simulated fan', async ({ page }) => {
    await openCalculator(page)
    await expect(page.locator('[data-elo-chart-caption]')).toContainText(/simulated/i)
  })

  test('the skill curve band renders with the signal-share verdict', async ({ page }) => {
    await openCalculator(page)
    const band = page.locator('[data-elo-skill]')
    await expect(band).toBeVisible()
    await expect(band.locator('canvas')).toBeVisible()
    await expect(page.locator('[data-elo-skill-share]')).toContainText(/skill drift explains \d+%/i)

    // The verdict paragraphs must sit BELOW the chart figure, not on it —
    // the band-sub top margin once pulled them into the frame. Wait for
    // webfonts: a late font swap reflows the caption and races the measure.
    await page.evaluate(() => document.fonts.ready.then(() => undefined))
    const fig = await band.locator('figure.elo-chart').boundingBox()
    const share = await page.locator('[data-elo-skill-share]').first().boundingBox()
    if (!fig || !share) throw new Error('skill band geometry unavailable')
    // 1px slack for subpixel layout rounding; the bug this guards against
    // was a 6px+ intrusion into the chart frame.
    expect(share.y).toBeGreaterThanOrEqual(fig.y + fig.height - 1)
  })
})

test.describe('Elo Calculator — phase 3 (sessions, change-point, lift)', () => {
  async function openWith(page: import('@playwright/test').Page, rows: unknown[]) {
    await page.route('**/api/v1/system/reference-data', (r: Route) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(REFERENCE_DATA) }))
    await page.route('**/api/v1/matches', (r: Route) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) }))
    await page.goto('/')
    await page.locator('#tab-elo').click()
    await expect(page.locator('#panel-elo')).toBeVisible()
  }

  function baseRec(
    seqNo: number,
    game: { day: string; hourMin: string; result: string; hero: string },
    extra: Record<string, unknown> = {},
  ) {
    const { day, hourMin, result, hero } = game
    return {
      match_key: `p3-${seqNo}`,
      source_files: [`p3-${seqNo}.png`],
      parsed_at: `${day}T${hourMin}:00Z`,
      queue_type: 'role',
      ...('annotation' in extra ? { annotation: extra.annotation } : {}),
      data: {
        map: (extra.map as string) ?? 'ilios', playlist: 'competitive', hero, role: 'support', result,
        date: day, finished_at: hourMin, played_at_utc: `${day}T${hourMin}:00Z`, game_length: '10:00',
        heroes_played: [{ hero, percent_played: 100 }],
        ...(extra.data as Record<string, unknown> ?? {}),
      },
    }
  }

  test('session-hygiene evidence: the per-game-in-session ladder with priced advice', async ({ page }) => {
    // 15 days × 5-game sessions (hours 20:00–23:30, gaps < 3h): early games
    // winny, games 4–5 lossy — a real late-session sag. change_percent on
    // every game feeds the meter pools so the advice line gets priced.
    const rows: unknown[] = []
    let n = 0
    for (let d = 1; d <= 15; d++) {
      const day = `2026-05-${String(d).padStart(2, '0')}`
      const results = [d % 5 !== 0, d % 5 !== 1, d % 2 === 0, d % 5 === 2, false] // ~80/73/53/20/0%
      const hours = ['20:00', '21:10', '22:05', '22:55', '23:30']
      results.forEach((win, i) => {
        n++
        rows.push(baseRec(n, { day, hourMin: hours[i]!, result: win ? 'victory' : 'defeat', hero: 'lucio' }, {
          data: { rank: 'gold', level: 3, rank_progress: (n * 7) % 100, change_percent: win ? 20 : -20, modifiers: [win ? 'victory' : 'defeat'] },
        }))
      })
    }
    await openWith(page, rows)
    const item = page.locator('[data-elo-evidence="session-hygiene"]')
    await expect(item).toBeVisible()
    await expect(item).toContainText(/%.*·.*%/)
    await expect(item).toContainText(/game/i)
    await expect(item).toContainText(/meter/i)
  })

  test('change-point: the dated shift sentence renders in the skill band', async ({ page }) => {
    // Oldest 50 games at 80%, newest 50 at 40% — a 40-point break (the
    // honest selection-penalty math needs a big, sustained shift), every
    // game rank-bearing so the skill band (and its markline) renders.
    const rows: unknown[] = []
    for (let i = 0; i < 100; i++) {
      const old = i < 50
      const win = old ? i % 5 !== 4 : i % 5 < 2
      const day = `2026-0${old ? 3 : 4}-${String((i % 25) + 1).padStart(2, '0')}`
      rows.push(baseRec(i + 1, { day, hourMin: `${String(10 + (i % 12)).padStart(2, '0')}:00`, result: win ? 'victory' : 'defeat', hero: 'lucio' }, {
        data: { rank: 'gold', level: old ? 4 : 3, rank_progress: (i * 9) % 100, change_percent: win ? 20 : -20, modifiers: [win ? 'victory' : 'defeat'] },
      }))
    }
    await openWith(page, rows)
    const line = page.locator('[data-elo-changepoint]')
    await expect(line).toBeVisible()
    await expect(line).toContainText(/shifted/i)
    // The corpus's within-month day-recycling scrambles exact ordering, so
    // the MLE split lands near (not exactly at) the intended boundary —
    // assert the magnitudes, not the precise rates.
    await expect(line).toContainText(/7[5-9]%|8[0-9]%/)
    await expect(line).toContainText(/3[0-9]%|4[0-5]%/)
  })

  test('lift table: ranked helps/hurts with × lifts', async ({ page }) => {
    // lucio on ilios 30 games at 70% vs ana on junkertown 20 games at 30%;
    // a frequent teammate rides the winny half.
    const rows: unknown[] = []
    let n = 0
    for (let i = 0; i < 30; i++) {
      n++
      const win = i < 21
      rows.push(baseRec(n, { day: `2026-05-${String((i % 28) + 1).padStart(2, '0')}`, hourMin: '20:00', result: win ? 'victory' : 'defeat', hero: 'lucio' }, {
        map: 'ilios',
        ...(i < 12 ? { annotation: { members: ['Buddy#123'] } } : {}),
      }))
    }
    for (let i = 0; i < 20; i++) {
      n++
      rows.push(baseRec(n, { day: `2026-06-${String((i % 28) + 1).padStart(2, '0')}`, hourMin: '21:00', result: i < 6 ? 'victory' : 'defeat', hero: 'ana' }, { map: 'junkertown' }))
    }
    await openWith(page, rows)
    const band = page.locator('[data-elo-lift]')
    await expect(band).toBeVisible()
    await expect(band).toContainText('×')
    await expect(band).toContainText(/helps/i)
    await expect(band).toContainText(/hurts/i)
    await expect(band).toContainText(/l[uú]cio/i)
  })
})

test.describe('Elo Calculator — consistency & tilt (breaks, rust, tilt queues)', () => {
  async function openWith(page: import('@playwright/test').Page, rows: unknown[]) {
    await page.route('**/api/v1/system/reference-data', (r: Route) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(REFERENCE_DATA) }))
    await page.route('**/api/v1/matches', (r: Route) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) }))
    await page.goto('/')
    await page.locator('#tab-elo').click()
    await expect(page.locator('#panel-elo')).toBeVisible()
  }

  function rec(seqNo: number, day: string, hourMin: string, win: boolean) {
    return {
      match_key: `ct-${seqNo}`,
      source_files: [`ct-${seqNo}.png`],
      parsed_at: `${day}T${hourMin}:00Z`,
      queue_type: 'role',
      data: {
        map: 'ilios', playlist: 'competitive', hero: 'lucio', role: 'support',
        result: win ? 'victory' : 'defeat',
        date: day, finished_at: hourMin, played_at_utc: `${day}T${hourMin}:00Z`, game_length: '10:00',
        heroes_played: [{ hero: 'lucio', percent_played: 100 }],
        rank: 'gold', level: 3, rank_progress: (seqNo * 7) % 100,
        change_percent: win ? 20 : -20, modifiers: [win ? 'victory' : 'defeat'],
      },
    }
  }

  test('a rusty return after a break surfaces the consistency lever', async ({ page }) => {
    const rows: unknown[] = []
    let n = 0
    // Three weeks of steady play at ~60%...
    for (let d = 1; d <= 20; d++) {
      const day = `2026-04-${String(d).padStart(2, '0')}`
      rows.push(rec(++n, day, '20:00', d % 5 !== 0))
      rows.push(rec(++n, day, '21:00', d % 5 !== 1))
    }
    // ...a 12-day vacation, then a rusty first week back (1W/7L)...
    for (let i = 0; i < 8; i++) {
      const day = `2026-05-${String(2 + i).padStart(2, '0')}`
      rows.push(rec(++n, day, '20:30', i === 3))
    }
    // ...then form returns.
    for (let d = 12; d <= 20; d++) {
      const day = `2026-05-${String(d).padStart(2, '0')}`
      rows.push(rec(++n, day, '20:00', d % 3 !== 0))
    }
    await openWith(page, rows)
    const item = page.locator('[data-elo-evidence="consistency"]')
    await expect(item).toBeVisible()
    await expect(item).toContainText(/first games back/i)
    await expect(item).toContainText(/break/i)
    await expect(item).toContainText(/sleep|exercise/i)
  })

  test('queuing through 5+ straight losses surfaces the tilt-queue flag', async ({ page }) => {
    const rows: unknown[] = []
    let n = 0
    // Baseline evenings around 55% (meter pools need both win and loss mass)...
    for (let d = 1; d <= 12; d++) {
      const day = `2026-05-${String(d).padStart(2, '0')}`
      rows.push(rec(++n, day, '20:00', d % 4 !== 0))
      rows.push(rec(++n, day, '21:00', d % 3 !== 0))
    }
    // ...and one catastrophic sitting: seven straight losses, 25 minutes apart.
    const hours = ['19:00', '19:25', '19:50', '20:15', '20:40', '21:05', '21:30']
    for (const h of hours) rows.push(rec(++n, '2026-05-15', h, false))
    await openWith(page, rows)
    const item = page.locator('[data-elo-evidence="tilt-queue"]')
    await expect(item).toBeVisible()
    await expect(item).toContainText(/tilt/i)
    await expect(item).toContainText(/5 straight|five straight/i)
    await expect(item).toContainText(/meter|ground/i)
  })
})
