/**
 * Matches — "Trends" time-series section.
 *
 * A collapsible section below the dossier renders two ECharts line charts
 * over the *narrowed* match set: rank progression (a tier-labeled ladder,
 * one line per role) and a windowed rolling win-rate (also per role).
 * ECharts is lazy-loaded, so the canvases only appear after the section is
 * expanded.
 *
 * This proves the full frontend chain api.ts -> /matches -> dossier trend
 * series -> option builders -> ECharts canvas, plus the two subtle bug
 * surfaces: the lazy chunk actually resolves on expand, and a chart
 * re-renders when an input changes (proven via the win-rate window
 * selector flipping the chart's accessible name — ECharts paints into the
 * canvas, opaque to the DOM, so the container's aria-label is the
 * observable reactivity signal).
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

interface Stub {
  role?: 'tank' | 'dps' | 'support'
  queue?: 'role' | 'open'
  rank?: string
  level?: number
  progress?: number
  change?: number
  result?: 'victory' | 'defeat' | 'draw'
  modifiers?: string[]
}

// A competitive match at a given date/time carrying a rank reading + a
// result, with the effective queue_type on the record top level (override-
// aware) — enough for both charts to have per-role data.
const match = (key: string, date: string, time: string, s: Stub) => ({
  match_key: key,
  source_files: [`${key}.png`],
  source_types: { [`${key}.png`]: 'rank' },
  queue_type: s.queue ?? 'role',
  data: {
    map: 'rialto',
    playlist: 'competitive',
    role: s.role ?? 'tank',
    result: s.result ?? 'victory',
    date,
    finished_at: time,
    ...(s.rank != null ? { rank: s.rank } : {}),
    ...(s.level != null ? { level: s.level } : {}),
    ...(s.progress != null ? { rank_progress: s.progress } : {}),
    ...(s.change != null ? { change_percent: s.change } : {}),
    ...(s.modifiers != null ? { modifiers: s.modifiers } : {}),
  },
  parsed_at: `${date}T${time}:00Z`,
})

// Two roles climbing over time + decisive results + modifiers — enough for
// all five charts to have data.
const CORPUS = [
  match('m1', '2026-05-08', '20:00', { role: 'tank', rank: 'platinum', level: 4, progress: 20, change: 22, result: 'victory', modifiers: ['underdog', 'victory'] }),
  match('m2', '2026-05-09', '20:00', { role: 'tank', rank: 'platinum', level: 3, progress: 50, change: 25, result: 'victory', modifiers: ['unexpected', 'victory'] }),
  match('m3', '2026-05-09', '21:00', { role: 'dps', rank: 'gold', level: 2, progress: 40, change: -15, result: 'defeat', modifiers: ['expected', 'defeat'] }),
  match('m4', '2026-05-10', '20:00', { role: 'tank', rank: 'platinum', level: 2, progress: 10, change: 24, result: 'defeat', modifiers: ['underdog', 'defeat'] }),
  match('m5', '2026-05-11', '20:00', { role: 'dps', rank: 'gold', level: 1, progress: 30, change: 26, result: 'victory', modifiers: ['overcharge', 'victory'] }),
]

function mockMatches(page: import('@playwright/test').Page, body: unknown) {
  return page.route('**/api/v1/matches', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

test.describe('Matches — Trends section', () => {
  test('expands to render the five lazy-loaded trend charts', async ({ page }) => {
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

    // Five labelled chart containers (Rank ladder, Win-rate, Rank delta,
    // Cumulative net, Modifiers), each with a painted canvas once the lazy
    // ECharts chunk resolves.
    await expect(page.locator('.trend-card')).toHaveCount(5)
    await expect(page.locator('.trend-chart[role="img"]')).toHaveCount(5)
    await expect(page.locator('.trend-chart canvas')).toHaveCount(5)
    await expect(page.locator('.trend-chart[aria-label="Rank progression over time, by role"]')).toBeVisible()
  })

  test('the window selector re-renders the rolling win-rate chart', async ({ page }) => {
    await mockMatches(page, CORPUS)
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('.trends-toggle').click()

    // Defaults to a 20-match window.
    await expect(page.locator('.trend-chart[aria-label="Rolling win rate over the last 20 matches, by role"]')).toBeVisible()

    await page.locator('.trend-window-select').selectOption('50')
    await expect(page.locator('.trend-chart[aria-label="Rolling win rate over the last 50 matches, by role"]')).toBeVisible()
    await expect(page.locator('.trend-chart[aria-label="Rolling win rate over the last 20 matches, by role"]')).toHaveCount(0)
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
