/**
 * Post-session summary toast E2E.
 *
 * When a parse run completes and the freshest matches form an ACTIVE
 * session (latest match within the 3h session gap of now), a
 * bottom-right toast tallies it: "Session so far: 3 matches · 2W-1L".
 * Auto-dismisses; stale history (re-parses of old backlogs) never
 * toasts. Driven over the SSE mock: parse-complete → refetch → toast.
 */
import type { Page, Route } from '@playwright/test'

import { test, expect } from './_fixtures'

type MockListener = (e: MessageEvent) => void

async function installSSEMock(page: Page) {
  await page.addInitScript(() => {
    const handlers: Record<string, MockListener[]> = {}
    class MockEventSource {
      static readonly CONNECTING = 0
      static readonly OPEN = 1
      static readonly CLOSED = 2
      url: string
      readyState = 1
      onerror: ((e: Event) => void) | null = null
      onmessage: ((e: MessageEvent) => void) | null = null
      onopen: ((e: Event) => void) | null = null
      constructor(url: string) { this.url = url }
      addEventListener(name: string, fn: MockListener) {
        if (!handlers[name]) handlers[name] = []
        handlers[name].push(fn)
      }
      removeEventListener(name: string, fn: MockListener) {
        const arr = handlers[name]
        if (!arr) return
        const i = arr.indexOf(fn)
        if (i >= 0) arr.splice(i, 1)
      }
      close() { this.readyState = 2 }
      dispatchEvent(_e: Event): boolean { return true }
    }
    ;(window as unknown as { EventSource: typeof EventSource }).EventSource =
      MockEventSource as unknown as typeof EventSource
    ;(window as unknown as { __recallSSE: { emit: (n: string, d?: unknown) => void } }).__recallSSE = {
      emit(name: string, data?: unknown) {
        const arr = handlers[name]
        if (!arr) return
        const payload = data === undefined ? '' : JSON.stringify(data)
        for (const fn of arr) fn(new MessageEvent(name, { data: payload }))
      },
    }
  })
}

// Local-date fixtures (never toISOString — the UTC date can differ).
function localStamp(minutesAgo: number) {
  const d = new Date(Date.now() - minutesAgo * 60_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    key: `match-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}-${pad(d.getMinutes())}-00`,
  }
}

function rec(minutesAgo: number, result: string) {
  const s = localStamp(minutesAgo)
  return {
    match_key: s.key,
    source_files: [`${s.key}.png`],
    data: {
      map: 'rialto', playlist: 'competitive', hero: 'lucio', result,
      date: s.date, finished_at: s.time, eliminations: 10, assists: 2, deaths: 4,
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
    await expect(page.locator('#tab-matches')).toBeVisible()
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

  test('stale history never toasts', async ({ page }) => {
    await installSSEMock(page)
    let batch: unknown[] = []
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(batch) })
    })

    await page.goto('/')
    await expect(page.locator('#tab-matches')).toBeVisible()

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
