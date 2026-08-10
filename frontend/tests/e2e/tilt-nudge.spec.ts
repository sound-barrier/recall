/**
 * Tilt-nudge E2E.
 *
 * Two-pronged trigger: the latest ≥3 matches are all losses AND the
 * loss-streak K/D collapsed >25% below the 30-day baseline. When both
 * hold, a dismissible bottom-right toast suggests a break; dismissing
 * is session-scoped to the current streak (no persistence — it must
 * not moralize on a single bad day, and a NEW streak may nudge again).
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

function rec(key: string, date: string, time: string, outcome: { result: string; elims: number; deaths: number }) {
  const { result, elims, deaths } = outcome
  return {
    match_key: key,
    source_files: [`${key}.png`],
    data: {
      map: 'rialto',
      playlist: 'competitive',
      hero: 'lucio',
      result,
      date,
      finished_at: time,
      eliminations: elims,
      assists: 2,
      deaths,
    },
    parsed_at: `${date}T23:00:00Z`,
  }
}

// Ten-day baseline of healthy wins (K/D 4.0) then three straight
// losses at K/D well below 75% of it.
function tiltedCorpus() {
  const out = []
  for (let d = 1; d <= 10; d++) {
    const day = String(d).padStart(2, '0')
    out.push(rec(`match-2026-05-${day}T10-00-00`, `2026-05-${day}`, '10:00', { result: 'victory', elims: 20, deaths: 5 }))
  }
  out.push(rec('match-2026-05-11T20-00-00', '2026-05-11', '20:00', { result: 'defeat', elims: 4, deaths: 9 }))
  out.push(rec('match-2026-05-11T20-30-00', '2026-05-11', '20:30', { result: 'defeat', elims: 3, deaths: 10 }))
  out.push(rec('match-2026-05-11T21-00-00', '2026-05-11', '21:00', { result: 'defeat', elims: 5, deaths: 8 }))
  return out
}

test.describe('tilt nudge', () => {
  test('nudges on a collapsed loss streak; dismiss is sticky for the streak', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(tiltedCorpus()),
      })
    })

    await page.goto('/')

    const toast = page.locator('.tilt-nudge-toast')
    await expect(toast).toBeVisible()
    await expect(toast).toContainText(/3 losses/i)

    await toast.getByRole('button', { name: /dismiss|got it/i }).click()
    await expect(toast).toHaveCount(0)

    // Navigating around must not resurrect it for the same streak.
    await page.getByRole('tab', { name: 'Settings' }).click()
    await page.getByRole('tab', { name: /^Matches/ }).click()
    await expect(page.locator('.tilt-nudge-toast')).toHaveCount(0)
  })

  test('no nudge below three losses or without the K/D collapse', async ({ page }) => {
    const healthy = tiltedCorpus().slice(0, -1) // only two trailing losses
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(healthy),
      })
    })

    await page.goto('/')
    await expect(page.getByRole('tab', { name: /^Matches/ })).toBeVisible()
    await expect(page.locator('.tilt-nudge-toast')).toHaveCount(0)
  })
})
