/**
 * Form comparison — the Compare tab's second mode.
 *
 * "Form" compares two adjacent windows of play — this period vs the previous
 * one (mirrored, equal length) or the last N matches vs the N before them —
 * and answers with a verdict word (SHARPER / SLIPPING / HOLDING / TOO EARLY
 * TO CALL) plus the biggest movers, above the same A/B/Δ evidence table the
 * Seasons mode uses. Rows drill through to the Matches tab with the window +
 * dimension applied.
 *
 * The fixture is one match per day for the last 21 days, built relative to
 * *today* so the rolling presets are deterministic whenever the suite runs:
 *   offsets  -6..0  : 6W 1L (86%) — recent week, 4 tank (reinhardt) + 3 dps
 *   offsets -13..-7 : 2W 5L (29%) — prior week
 *   offsets -20..-14: 4W 3L        — filler so N=10 windows are full
 * By matches N=10: last 10 = 6W4L (60%) vs prior 10 = 5W5L (50%) → SHARPER.
 */
import type { Page, Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

import { test, expect } from './_fixtures'

const REFERENCE_DATA = {
  heroes_by_role: { tank: ['Reinhardt'], dps: ['Genji'] },
  maps_by_game_mode: { control: ['Ilios'] },
  screenshot_sources: [],
  seasons: [
    { name: 'S1', chapter: 'C', number: 1, start: '2026-02-10T19:00:00Z', end: '2026-04-14T19:00:00Z' },
    { name: 'S2', chapter: 'C', number: 2, start: '2026-04-14T19:00:00Z', end: '2026-08-11T19:00:00Z' },
  ],
}

function localYMD(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function rec(offset: number, hero: string, result: string) {
  const playedUTC = `${localYMD(offset)}T12:00:00Z`
  return {
    match_key: `match-d${offset}`,
    source_files: [`d${offset}.png`],
    parsed_at: playedUTC,
    data: {
      map: 'ilios', playlist: 'competitive', hero, result,
      date: playedUTC.slice(0, 10), finished_at: '12:00', played_at_utc: playedUTC,
      game_length: '12:00', eliminations: 15, assists: 8, deaths: 5,
      performance: { eliminations: { avg_per_10min: 18 }, deaths: { avg_per_10min: 6 }, assists: { avg_per_10min: 9 } },
      heroes_played: [{ hero, play_time: '12:00', percent_played: 100 }],
    },
  }
}

const WEEK_RECENT: [number, string, string][] = [
  [0, 'genji', 'victory'], [-1, 'genji', 'victory'], [-2, 'genji', 'defeat'],
  [-3, 'reinhardt', 'victory'], [-4, 'reinhardt', 'victory'], [-5, 'reinhardt', 'victory'], [-6, 'reinhardt', 'victory'],
]
const WEEK_PRIOR: [number, string, string][] = [
  [-7, 'reinhardt', 'defeat'], [-8, 'reinhardt', 'defeat'], [-9, 'reinhardt', 'defeat'],
  [-10, 'reinhardt', 'defeat'], [-11, 'reinhardt', 'defeat'], [-12, 'reinhardt', 'victory'], [-13, 'reinhardt', 'victory'],
]
const FILLER: [number, string, string][] = [
  [-14, 'genji', 'victory'], [-15, 'genji', 'defeat'], [-16, 'genji', 'victory'],
  [-17, 'genji', 'defeat'], [-18, 'genji', 'victory'], [-19, 'genji', 'defeat'], [-20, 'genji', 'victory'],
]
const corpus = () => [...WEEK_RECENT, ...WEEK_PRIOR, ...FILLER].map(([o, h, r]) => rec(o, h, r))

async function openForm(page: Page) {
  await page.locator('#tab-compare').click()
  await page.locator('[data-compare-mode="form"]').click()
}

test.describe('form comparison', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.route('**/api/v1/system/reference-data', (r: Route) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(REFERENCE_DATA) }))
    await page.route('**/api/v1/matches', (r: Route) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corpus()) }))
    await page.goto('/')
  })

  test('the Form mode shows a verdict over the evidence table; Seasons stays default', async ({ page }) => {
    await page.locator('#tab-compare').click()
    // Seasons mode is the default and keeps its selectors.
    await expect(page.locator('[data-compare-a]')).toBeVisible()
    await expect(page.locator('[data-form-verdict]')).toHaveCount(0)

    await page.locator('[data-compare-mode="form"]').click()
    await expect(page.locator('[data-form-verdict]')).toBeVisible()
    await expect(page.locator('[data-compare-a]')).toHaveCount(0)
    // Both sparklines render.
    await expect(page.locator('[data-form-spark-a]')).toBeVisible()
    await expect(page.locator('[data-form-spark-b]')).toBeVisible()
  })

  test('by matches: last 10 vs prior 10 judges SHARPER with the win-rate mover', async ({ page }) => {
    await openForm(page)
    await page.locator('[data-form-pairby="matches"]').click()
    await page.locator('[data-form-n]').selectOption('10')

    await expect(page.locator('[data-form-verdict]')).toContainText('SHARPER')
    await expect(page.locator('[data-form-mover]').first()).toContainText('Win rate +10 pts')
    // Evidence table reflects the windows: 10 games each.
    await expect(page.locator('[data-compare-row="games"] .compare-a')).toHaveText('10')
    await expect(page.locator('[data-compare-row="games"] .compare-b')).toHaveText('10')
  })

  test('by time: picking this period auto-mirrors the previous period', async ({ page }) => {
    await openForm(page)
    await page.locator('[data-form-pairby="time"]').click()
    await page.locator('[data-form-b-from]').fill(localYMD(-6))
    await page.locator('[data-form-b-to]').fill(localYMD(0))

    // The baseline window mirrors to the preceding 7 days.
    await expect(page.locator('[data-form-a-window]')).toContainText(localYMD(-13))
    await expect(page.locator('[data-form-a-window]')).toContainText(localYMD(-7))
    await expect(page.locator('[data-compare-row="games"] .compare-a')).toHaveText('7')
    await expect(page.locator('[data-compare-row="games"] .compare-b')).toHaveText('7')
    await expect(page.locator('[data-form-verdict]')).toContainText('SHARPER')
  })

  test('a window under the sample floor reads TOO EARLY TO CALL', async ({ page }) => {
    await openForm(page)
    await page.locator('[data-form-pairby="matches"]').click()
    await page.locator('[data-form-n]').selectOption('50')
    // Only 21 matches exist — the prior-50 window is empty.
    await expect(page.locator('[data-form-verdict]')).toContainText('TOO EARLY TO CALL')
  })

  test('a per-column condition narrows that window only', async ({ page }) => {
    await openForm(page)
    await page.locator('[data-form-pairby="time"]').click()
    await page.locator('[data-form-b-from]').fill(localYMD(-6))
    await page.locator('[data-form-b-to]').fill(localYMD(0))
    await expect(page.locator('[data-compare-row="games"] .compare-b')).toHaveText('7')

    // Condition this period to Tank games — only the 4 Reinhardt matches remain,
    // and the baseline column is untouched.
    await page.locator('[data-form-cond-b]').selectOption('role:tank')
    await expect(page.locator('[data-compare-row="games"] .compare-b')).toHaveText('4')
    await expect(page.locator('[data-compare-row="games"] .compare-a')).toHaveText('7')

    // The Duo condition reveals its member sub-select (no members annotated in
    // this corpus, so it offers only the placeholder and stays inert).
    await page.locator('[data-form-cond-b]').selectOption('member')
    await expect(page.getByLabel(/this period's duo member/i)).toBeVisible()
    await expect(page.locator('[data-compare-row="games"] .compare-b')).toHaveText('7')
  })

  test('drilling through a role cell lands on Matches narrowed to that window + role', async ({ page }) => {
    await openForm(page)
    await page.locator('[data-form-pairby="time"]').click()
    await page.locator('[data-form-b-from]').fill(localYMD(-6))
    await page.locator('[data-form-b-to]').fill(localYMD(0))

    await page.locator('[data-compare-row="roleTank"] .compare-b').click()
    // Lands on Matches, narrowed to the recent week + tank → the 4 Reinhardt games.
    await expect(page.locator('#tab-matches')).toHaveAttribute('aria-selected', 'true')
    await expect.poll(() => page.locator('.leaf-row').count()).toBe(4)
  })

  for (const theme of ['day', 'dark'] as const) {
    test(`populated Form view has no ax violations — ${theme}`, async ({ page }) => {
      await page.addInitScript((t) => {
        try { localStorage.setItem('recall.theme', t) } catch (_) { /* ignore */ }
      }, theme)
      await page.goto('/')
      await openForm(page)
      await expect(page.locator('[data-form-verdict]')).toBeVisible()
      const panel = page.locator('#panel-compare')
      await panel.evaluate((el) =>
        Promise.all(
          el.getAnimations({ subtree: true })
            .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
            .map((a) => a.finished.catch(() => undefined)),
        ),
      )
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()
      expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])
    })
  }
})
