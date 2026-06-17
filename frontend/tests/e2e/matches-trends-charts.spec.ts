/**
 * Matches — "Trends" time-series section.
 *
 * The in-app replacement for the (removed) Grafana line charts. A
 * collapsible section below the dossier renders four ECharts line
 * charts over the *narrowed* match set: SR by hero, a selectable
 * per-match stat, a rolling win-rate (windowed), and per-10
 * performance. ECharts is lazy-loaded, so the canvases only appear
 * after the section is expanded.
 *
 * This proves the full frontend chain api.ts -> /matches -> dossier
 * trend series -> option builders -> ECharts canvas, plus the two
 * subtle bug surfaces: the lazy chunk actually resolves on expand, and
 * the charts re-render when an input changes (proven via the
 * stat-selector flipping the chart's accessible name — ECharts paints
 * its legend into the canvas, opaque to the DOM, so the container's
 * aria-label is the observable reactivity signal).
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

interface Stub {
  e?: number
  d?: number
  a?: number
  damage?: number
  sr?: number
  result?: 'victory' | 'defeat' | 'draw'
}

// A competitive match at a given date/time carrying SR (ana), a
// performance block, damage, and a result — enough for all four charts
// to have data.
const match = (key: string, date: string, time: string, s: Stub) => ({
  match_key: key,
  source_files: [`${key}.png`],
  source_types: { [`${key}.png`]: 'summary' },
  data: {
    map: 'rialto',
    playlist: 'competitive',
    hero: 'ana',
    role: 'support',
    result: s.result ?? 'victory',
    date,
    finished_at: time,
    damage: s.damage ?? 5000,
    // Top-level totals back the per-match stat chart (KDA reads these,
    // not the per-10 performance block).
    eliminations: s.e ?? 10,
    assists: s.a ?? 8,
    deaths: s.d ?? 5,
    ...(s.sr != null ? { sr: [{ hero: 'ana', sr: s.sr, change: 0 }] } : {}),
    ...(s.e != null
      ? {
        performance: {
          eliminations: { total: 0, avg_per_10min: s.e },
          deaths: { total: 0, avg_per_10min: s.d ?? 0 },
          assists: { total: 0, avg_per_10min: s.a ?? 0 },
        },
      }
      : {}),
  },
  parsed_at: `${date}T${time}:00Z`,
})

const CORPUS = [
  match('m1', '2026-05-08', '20:00', { sr: 2500, e: 9, d: 5, a: 7, damage: 4800, result: 'victory' }),
  match('m2', '2026-05-09', '20:00', { sr: 2470, e: 7, d: 6, a: 6, damage: 4200, result: 'defeat' }),
  match('m3', '2026-05-10', '20:00', { sr: 2540, e: 11, d: 4, a: 9, damage: 6100, result: 'victory' }),
  match('m4', '2026-05-11', '20:00', { sr: 2580, e: 8, d: 5, a: 8, damage: 5300, result: 'victory' }),
]

function mockMatches(page: import('@playwright/test').Page, body: unknown) {
  return page.route('**/api/v1/matches', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

test.describe('Matches — Trends section', () => {
  test('expands to render the four lazy-loaded trend charts', async ({ page }) => {
    await mockMatches(page, CORPUS)
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.set-dossier')).toBeVisible()

    const toggle = page.locator('.trends-toggle')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    // Charts are lazy — nothing painted while collapsed.
    await expect(page.locator('.trend-chart canvas')).toHaveCount(0)

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')

    // Four labelled chart containers, each with a painted canvas once
    // the lazy ECharts chunk resolves.
    await expect(page.locator('.trend-card')).toHaveCount(4)
    await expect(page.locator('.trend-chart[role="img"]')).toHaveCount(4)
    await expect(page.locator('.trend-chart canvas')).toHaveCount(4)
  })

  test('the stat selector re-renders the per-match stat chart', async ({ page }) => {
    await mockMatches(page, CORPUS)
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('.trends-toggle').click()

    // Defaults to KDA.
    await expect(page.locator('.trend-chart[aria-label="Per-match KDA over time"]')).toBeVisible()

    await page.locator('.trend-stat-select').selectOption('damage')
    await expect(page.locator('.trend-chart[aria-label="Per-match Damage over time"]')).toBeVisible()
    await expect(page.locator('.trend-chart[aria-label="Per-match KDA over time"]')).toHaveCount(0)
  })

  test('shows an empty state when no match in the set has a placeable time', async ({ page }) => {
    await mockMatches(page, [
      { match_key: 'unmatched-a.png', source_files: ['a.png'], data: { map: 'rialto', result: 'victory' } },
    ])
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('.trends-toggle').click()

    await expect(page.locator('.trends-empty')).toBeVisible()
    await expect(page.locator('.trend-chart canvas')).toHaveCount(0)
  })
})
