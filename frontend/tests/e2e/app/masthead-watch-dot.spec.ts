/**
 * Masthead watch-dot E2E.
 *
 * With folder-watch enabled, a small dim-green "WATCHING" dot sits in
 * the masthead so the watcher's state is visible from every tab. When
 * the watcher sees new screenshots (a `watch-activity` event with a
 * pending count), the dot reads "WATCHING · N NEW" and its tooltip
 * carries the most recent activity timestamp. While a parse is in
 * flight the existing accent-pulsing parse chip takes over and the dot
 * yields. Watch disabled → no dot at all.
 *
 * Same MockEventSource + __recallSSE pattern as
 * parse-queue-and-skeletons.spec.ts.
 */
import type { Page, Route } from '@playwright/test'

import { test, expect } from '../_fixtures'

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
    ;(window as unknown as { __recallSSE: { emit: (n: string, d: unknown) => void } }).__recallSSE = {
      emit(name: string, data: unknown) {
        const arr = handlers[name]
        if (!arr) return
        const payload = data === undefined ? '' : JSON.stringify(data)
        const evt = new MessageEvent(name, { data: payload })
        for (const fn of arr) fn(evt)
      },
    }
  })
}

function emitSSE(page: Page, name: string, data: unknown) {
  return page.evaluate(([n, d]) => {
    ;(window as unknown as { __recallSSE: { emit: (n: string, d: unknown) => void } }).__recallSSE.emit(
      n as string, d,
    )
  }, [name, data])
}

async function mockBackend(page: Page, watchEnabled: boolean) {
  await page.route('**/api/v1/matches', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
  await page.route('**/api/v1/settings/watcher', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ enabled: watchEnabled }),
    })
  })
}

test.describe('masthead watch dot', () => {
  test('idle dot when watching; pending count + tooltip on watch-activity', async ({ page }) => {
    await installSSEMock(page)
    await mockBackend(page, true)
    await page.goto('/')

    // Idle state: dot present, no count, no parse chip.
    const dot = page.locator('.masthead-watch-dot')
    await expect(dot).toBeVisible()
    await expect(dot).toContainText(/watching/i)
    await expect(dot).not.toContainText(/new/i)

    // Watcher sees two new screenshots.
    await emitSSE(page, 'watch-activity', { pending: 2, last_seen_at: '2026-05-10T22:31:00Z' })
    await expect(dot).toContainText(/2 new/i)
    await expect(dot).toHaveAttribute('title', /last new screenshot/i)

    // The debounced parse consumed them — count clears, dot stays.
    await emitSSE(page, 'watch-activity', { pending: 0, last_seen_at: '2026-05-10T22:31:00Z' })
    await expect(dot).not.toContainText(/new/i)
    await expect(dot).toContainText(/watching/i)
  })

  test('dot yields to the parse chip while a parse is in flight', async ({ page }) => {
    await installSSEMock(page)
    await mockBackend(page, true)
    await page.goto('/')

    await expect(page.locator('.masthead-watch-dot')).toBeVisible()

    await emitSSE(page, 'parse-progress', {
      done: 3, total: 12, filename: 'ow-3.png', screenshot_type: 'summary',
    })
    await expect(page.locator('.masthead-parse-chip')).toBeVisible()
    await expect(page.locator('.masthead-watch-dot')).toHaveCount(0)
  })

  test('no dot when folder-watch is disabled', async ({ page }) => {
    await installSSEMock(page)
    await mockBackend(page, false)
    await page.goto('/')

    // The masthead is up (nav renders) but no watch dot.
    await expect(page.getByRole('tab', { name: /^Matches/ })).toBeVisible()
    await expect(page.locator('.masthead-watch-dot')).toHaveCount(0)
  })
})
