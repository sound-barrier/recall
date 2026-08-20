/**
 * Post-session summary toast E2E.
 *
 * When a parse run completes and the freshest matches form an ACTIVE
 * session (latest match within the 3h session gap of now), a
 * bottom-right toast tallies it: "Session so far: 3 matches · 2W-1L".
 * It persists while the session is live rather than auto-dismissing, a
 * dismissal sticks to the session it dismissed, and stale history (re-parses
 * of old backlogs) never toasts at all. Driven over the SSE mock:
 * parse-complete → refetch → toast.
 */
import type { Route } from '@playwright/test'

import { test, expect } from '../_fixtures'
import { installSSEMock, localStamp } from '../_session-sse'

function rec(minutesAgo: number, result: string, change?: number) {
  const s = localStamp(minutesAgo)
  return {
    match_key: s.key,
    source_files: [`${s.key}.png`],
    data: {
      map: 'rialto', playlist: 'competitive', hero: 'lucio', result,
      date: s.date, finished_at: s.time, eliminations: 10, assists: 2, deaths: 4,
      ...(change === undefined ? {} : { change_percent: change }),
    },
    parsed_at: new Date().toISOString(),
  }
}

test.describe('session summary toast', () => {
  test('parse-complete over an active session tallies it', async ({ page }) => {
    await installSSEMock(page)
    let batch: unknown[] = []
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(batch) })
    })

    await page.goto('/')
    await expect(page.getByRole('tab', { name: /^Matches/ })).toBeVisible()
    await expect(page.locator('.session-summary-toast')).toHaveCount(0)

    batch = [rec(90, 'victory'), rec(50, 'victory'), rec(10, 'defeat')]
    await page.evaluate(() => {
      ;(window as unknown as { __recallSSE: { emit: (n: string, d?: unknown) => void } }).__recallSSE.emit('parse-complete')
    })

    const toast = page.locator('.session-summary-toast')
    await expect(toast).toBeVisible()
    await expect(toast).toContainText(/3 matches/i)
    await expect(toast).toContainText(/2W[\s·-]*1L/i)
  })

  // "×" has to mean it. Keyed on the toast instance rather than the session,
  // dismissal lasted exactly one game: the next parse built a fresh instance
  // and put the same readout straight back, all evening — and re-announced it
  // to a screen reader each time, since a status region re-reads its whole
  // contents.
  test('a dismissed session stays dismissed across the next parse', async ({ page }) => {
    await installSSEMock(page)
    let batch: unknown[] = []
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(batch) })
    })
    const emit = () => page.evaluate(() => {
      ;(window as unknown as { __recallSSE: { emit: (n: string, d?: unknown) => void } }).__recallSSE.emit('parse-complete')
    })

    await page.goto('/')
    await expect(page.getByRole('tab', { name: /^Matches/ })).toBeVisible()
    batch = [rec(90, 'victory'), rec(50, 'victory')]
    await emit()

    const toast = page.locator('.session-summary-toast')
    await expect(toast).toBeVisible()
    await toast.getByRole('button', { name: /dismiss/i }).click()
    await expect(toast).toHaveCount(0)

    // Another game in the SAME session lands.
    batch = [rec(90, 'victory'), rec(50, 'victory'), rec(10, 'defeat')]
    await emit()

    await expect(toast).toHaveCount(0)
  })

  // THE REASON THIS TOAST EXISTS AT ALL. The watcher debounces for 60 seconds
  // before parsing, so the toast appears about a minute after the match ends —
  // by which point the player is back in Overwatch, alt-tabbed away. It used to
  // auto-dismiss after six seconds, which meant the one readout of the session
  // was shown almost exclusively to an empty desktop.
  test('stays put instead of vanishing while the player is still in game', async ({ page }) => {
    await installSSEMock(page)
    let batch: unknown[] = []
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(batch) })
    })

    await page.goto('/')
    await expect(page.getByRole('tab', { name: /^Matches/ })).toBeVisible()

    batch = [rec(90, 'victory', 20), rec(50, 'victory', 21), rec(10, 'defeat', -25)]
    await page.evaluate(() => {
      ;(window as unknown as { __recallSSE: { emit: (n: string, d?: unknown) => void } }).__recallSSE.emit('parse-complete')
    })

    const toast = page.locator('.session-summary-toast')
    await expect(toast).toBeVisible()
    // The session's rank movement rides along with the tally.
    await expect(toast).toContainText('+16%')

    // Well past the old six-second dismissal.
    await page.waitForTimeout(8000)
    await expect(toast).toBeVisible()

    // And it can still be dismissed by hand.
    await toast.getByRole('button', { name: /dismiss/i }).click()
    await expect(toast).toHaveCount(0)
  })

  // A session whose movement pills went unread has an UNKNOWN movement, not a
  // flat one, so the clause is absent rather than reading "+0%".
  test('omits the movement when no capture in the session reported one', async ({ page }) => {
    await installSSEMock(page)
    let batch: unknown[] = []
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(batch) })
    })

    await page.goto('/')
    await expect(page.getByRole('tab', { name: /^Matches/ })).toBeVisible()

    batch = [rec(50, 'victory'), rec(10, 'defeat')]
    await page.evaluate(() => {
      ;(window as unknown as { __recallSSE: { emit: (n: string, d?: unknown) => void } }).__recallSSE.emit('parse-complete')
    })

    const toast = page.locator('.session-summary-toast')
    await expect(toast).toBeVisible()
    await expect(toast).toContainText(/2 matches/i)
    await expect(toast).not.toContainText('%')
  })

  test('stale history never toasts', async ({ page }) => {
    await installSSEMock(page)
    let batch: unknown[] = []
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(batch) })
    })

    await page.goto('/')
    await expect(page.getByRole('tab', { name: /^Matches/ })).toBeVisible()

    // A week-old session — re-parse of a backlog, nothing "so far".
    batch = [
      { ...rec(7 * 24 * 60 + 120, 'victory') },
      { ...rec(7 * 24 * 60 + 60, 'defeat') },
    ]
    await page.evaluate(() => {
      ;(window as unknown as { __recallSSE: { emit: (n: string, d?: unknown) => void } }).__recallSSE.emit('parse-complete')
    })

    await expect(page.locator('.leaf-row').first()).toBeVisible()
    await expect(page.locator('.session-summary-toast')).toHaveCount(0)
  })
})
