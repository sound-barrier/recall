/**
 * Live session banner E2E.
 *
 * A top-anchored bar that says where the player sits on the ladder RIGHT NOW
 * and how far the running session has moved them. Four surfaces already spell
 * a session W-L tally; the rank is the half none of them carries, and it is
 * the reason this one exists.
 *
 * OFF by default — the duplication is the player's to opt into, not ours to
 * impose. Settings → Appearance turns it on; the choice persists.
 */
import type { Route } from '@playwright/test'

import { test, expect } from '../_fixtures'
import { localStamp } from '../_session-sse'

function rec(minutesAgo: number, result: string, rank?: { tier: string; level: number; progress: number }) {
  const s = localStamp(minutesAgo)
  return {
    match_key: s.key,
    source_files: [`${s.key}.png`],
    queue_type: 'role',
    data: {
      map: 'rialto', playlist: 'competitive', hero: 'lucio', role: 'support', result,
      date: s.date, finished_at: s.time,
      ...(rank ? { rank: rank.tier, level: rank.level, rank_progress: rank.progress } : {}),
    },
    parsed_at: new Date().toISOString(),
  }
}

const LIVE_SESSION = [
  rec(90, 'victory', { tier: 'gold', level: 3, progress: 80 }),
  rec(50, 'victory', { tier: 'gold', level: 2, progress: 20 }),
  rec(10, 'defeat', { tier: 'gold', level: 2, progress: 55 }),
]

async function mock(page: import('@playwright/test').Page, rows: unknown[]) {
  await page.route('**/api/v1/matches', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) }))
}

async function enableBanner(page: import('@playwright/test').Page) {
  await page.getByRole('tab', { name: 'Settings' }).click()
  await page.getByRole('switch', { name: 'Live session banner' }).click()
}

test.describe('live session banner', () => {
  test('stays off until the player asks for it, then reports rank and session', async ({ page }) => {
    await mock(page, LIVE_SESSION)
    await page.goto('/')
    await expect(page.getByRole('tab', { name: /^Matches/ })).toBeVisible()

    const banner = page.getByRole('status', { name: 'Live session' })
    await expect(banner).toHaveCount(0)

    await enableBanner(page)
    await expect(banner).toBeVisible()
    // Where the player sits, and what tonight did to it.
    await expect(banner).toContainText('Gold 2')
    await expect(banner).toContainText(/3 games/i)
    await expect(banner).toContainText(/2W[\s·-]*1L/i)

    // The choice survives a relaunch.
    await page.reload()
    await expect(page.getByRole('status', { name: 'Live session' })).toBeVisible()
  })

  test('says nothing when the newest match is older than the session gap', async ({ page }) => {
    await mock(page, [rec(60 * 24, 'victory', { tier: 'gold', level: 2, progress: 20 })])
    await page.goto('/')
    await expect(page.getByRole('tab', { name: /^Matches/ })).toBeVisible()
    await enableBanner(page)
    await expect(page.getByRole('status', { name: 'Live session' })).toHaveCount(0)
  })

  test('a dismissed session stays dismissed', async ({ page }) => {
    await mock(page, LIVE_SESSION)
    await page.goto('/')
    await expect(page.getByRole('tab', { name: /^Matches/ })).toBeVisible()
    await enableBanner(page)

    const banner = page.getByRole('status', { name: 'Live session' })
    await expect(banner).toBeVisible()
    await banner.getByRole('button', { name: /dismiss/i }).click()
    await expect(banner).toHaveCount(0)

    // Navigating away and back does not resurrect it.
    await page.getByRole('tab', { name: /^Matches/ }).click()
    await expect(page.getByRole('status', { name: 'Live session' })).toHaveCount(0)
  })
})
