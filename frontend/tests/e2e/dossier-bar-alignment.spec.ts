/**
 * Breakdown-bar alignment E2E.
 *
 * Every bar-graph widget row is a 3-column grid; the name and stats
 * columns are FIXED so the bar track starts and ends at identical x
 * across rows regardless of name length, percent width, a ± interval,
 * or the n<5 chip (which overlays the bar instead of adding a
 * column). Pins the geometry: same x, same width, per widget.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

function rec(i: number, map: string, result: string) {
  const day = String((i % 27) + 1).padStart(2, '0')
  return {
    match_key: `match-2026-05-${day}T1${i % 10}-${String(i % 60).padStart(2, '0')}-00`,
    source_files: [`m${i}.png`],
    data: {
      map,
      playlist: 'competitive',
      hero: 'lucio',
      result,
      date: `2026-05-${day}`,
      finished_at: `1${i % 10}:00`,
      eliminations: 9,
      assists: 4,
      deaths: 5,
    },
    parsed_at: `2026-05-${day}T22:00:00Z`,
  }
}

test('winrate rows with ± and n<5 chips keep identical bar geometry', async ({ page }) => {
  // Three maps with maximal row-shape variance: a solid n=32 row (no
  // ±), an n=14 row (±), and an n=3 row (± + n<5 chip).
  const corpus = [
    ...Array.from({ length: 20 }, (_, i) => rec(i, 'rialto', 'victory')),
    ...Array.from({ length: 12 }, (_, i) => rec(i + 20, 'rialto', 'defeat')),
    ...Array.from({ length: 9 }, (_, i) => rec(i + 32, 'watchpoint gibraltar', 'victory')),
    ...Array.from({ length: 5 }, (_, i) => rec(i + 41, 'watchpoint gibraltar', 'defeat')),
    ...Array.from({ length: 1 }, (_, i) => rec(i + 46, 'oasis', 'victory')),
    ...Array.from({ length: 2 }, (_, i) => rec(i + 47, 'oasis', 'defeat')),
  ]
  await page.addInitScript(() => {
    localStorage.setItem('recall.dashboard.layout', JSON.stringify({
      1: ['winrate'],
      2: ['winrate-by-map'],
    }))
    localStorage.setItem('recall.dashboard.layoutVersion', '1')
    localStorage.setItem('recall.dashboard.widget-config.winrate-by-map', JSON.stringify({ minMatches: 3, limit: 5 }))
  })
  await page.route('**/api/v1/matches', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corpus) })
  })

  await page.goto('/')

  const widget = page.locator('[data-widget-id="winrate-by-map"]')
  await expect(widget.locator('.bd-bar')).toHaveCount(3)
  await expect(widget.locator('.bd-ci')).toHaveCount(2)
  await expect(widget.locator('.bd-low-n')).toHaveCount(1)

  // Bars: identical x and width across all three row shapes.
  const bars = await widget.locator('.bd-bar').evaluateAll(els =>
    els.map(el => {
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.x), w: Math.round(r.width) }
    }),
  )
  for (const b of bars.slice(1)) {
    expect(b.x).toBe(bars[0]!.x)
    expect(b.w).toBe(bars[0]!.w)
  }

  // Stats columns: same left edge; ± spans: same left edge.
  const statsLeft = await widget.locator('.bd-stats').evaluateAll(els =>
    els.map(el => Math.round(el.getBoundingClientRect().left)),
  )
  for (const l of statsLeft.slice(1)) expect(l).toBe(statsLeft[0]!)

  const ciLeft = await widget.locator('.bd-ci').evaluateAll(els =>
    els.map(el => Math.round(el.getBoundingClientRect().left)),
  )
  expect(ciLeft[1]).toBe(ciLeft[0]!)
})
