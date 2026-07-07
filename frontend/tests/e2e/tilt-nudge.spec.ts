/**
 * Tilt-nudge E2E.
 *
 * Two-pronged trigger: the latest ≥3 matches are all losses AND the
 * loss-streak K/D collapsed >25% below the 30-day baseline. When both
 * hold, a dismissible bottom-right toast suggests a break; dismissing
 * is session-scoped to the current streak (no persistence — it must
 * not moralise on a single bad day, and a NEW streak may nudge again).
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

function rec(key: string, date: string, time: string, result: string, elims: number, deaths: number) {
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
    out.push(rec(`match-2026-05-${day}T10-00-00`, `2026-05-${day}`, '10:00', 'victory', 20, 5))
  }
  out.push(rec('match-2026-05-11T20-00-00', '2026-05-11', '20:00', 'defeat', 4, 9))
  out.push(rec('match-2026-05-11T20-30-00', '2026-05-11', '20:30', 'defeat', 3, 10))
  out.push(rec('match-2026-05-11T21-00-00', '2026-05-11', '21:00', 'defeat', 5, 8))
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

    await toast.locator('button', { hasText: /dismiss|got it/i }).click()
    await expect(toast).toHaveCount(0)

    // Navigating around must not resurrect it for the same streak.
    await page.locator('#tab-settings').click()
    await page.locator('#tab-matches').click()
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
    await expect(page.locator('#tab-matches')).toBeVisible()
    await expect(page.locator('.tilt-nudge-toast')).toHaveCount(0)
  })
})
