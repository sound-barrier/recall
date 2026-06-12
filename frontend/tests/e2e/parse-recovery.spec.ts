/**
 * Parse-stream recovery (server mode, REVIEW.md B1).
 *
 * The parse runs server-side as a background job; POST /parses returns
 * 202 up-front and the SSE stream carries progress + completion. Because
 * SSE isn't replayed on reconnect, the client resyncs against
 * GET /parses/active. This spec drives the three recovery paths:
 *
 *   1. reload mid-parse  → GET /parses/active (running) restores the panel
 *   2. SSE drop          → "Reconnecting…" indicator; reconnect resyncs
 *   3. stream stays down  → "Lost connection" + a manual Refresh
 *
 * The browser EventSource is replaced with a controllable mock so the
 * test can drop/reopen the connection deterministically.
 */
import type { Page, Route } from '@playwright/test'

import { test, expect } from './_fixtures'

async function installSSEMock(page: Page) {
  await page.addInitScript(() => {
    class MockEventSource {
      // Most-recently-constructed instance, so the __sse controls below
      // can drive connection state. Held on the class rather than aliased
      // from `this` into a closure var (@typescript-eslint/no-this-alias).
      static current: MockEventSource | null = null
      static readonly CONNECTING = 0
      static readonly OPEN = 1
      static readonly CLOSED = 2
      url: string
      readyState = 1
      onopen: ((e: Event) => void) | null = null
      onerror: ((e: Event) => void) | null = null
      private handlers: Record<string, ((e: MessageEvent) => void)[]> = {}
      constructor(url: string) { this.url = url; MockEventSource.current = this }
      addEventListener(name: string, fn: (e: MessageEvent) => void) { (this.handlers[name] ??= []).push(fn) }
      removeEventListener(name: string, fn: (e: MessageEvent) => void) {
        const a = this.handlers[name]; if (!a) return
        const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1)
      }
      close() { this.readyState = 2 }
      dispatchEvent() { return true }
      emit(name: string, data?: unknown) {
        for (const fn of this.handlers[name] ?? []) {
          fn(new MessageEvent(name, { data: data === undefined ? '' : JSON.stringify(data) }))
        }
      }
    }
    ;(window as unknown as { EventSource: unknown }).EventSource = MockEventSource
    ;(window as unknown as { __sse: unknown }).__sse = {
      drop() { const i = MockEventSource.current; if (i) { i.readyState = 0; i.onerror?.(new Event('error')) } },
      reconnect() { const i = MockEventSource.current; if (i) { i.readyState = 1; i.onopen?.(new Event('open')) } },
      emit(name: string, data?: unknown) { MockEventSource.current?.emit?.(name, data) },
    }
  })
}

// Mutable active-parse state the GET /parses/active route reflects, so a
// test can flip "running" between drop + reconnect.
type ActiveParse = { running: boolean; done: number; total: number; scope: string }

async function routeBackend(page: Page, active: () => ActiveParse) {
  await page.route('**/api/v1/matches', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  // Exact /parses (POST) — a trailing-** glob would also swallow
  // /parses/active and starve the resync of its JSON snapshot.
  await page.route('**/api/v1/parses', (r: Route) => r.fulfill({ status: 202 }))
  await page.route('**/api/v1/parses/active', (r: Route) => {
    if (r.request().method() !== 'GET') return r.fulfill({ status: 202 })
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(active()) })
  })
  await page.route('**/api/v1/settings/screenshots-folder', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ path: '/srv/recall' }) }))
  await page.route('**/api/v1/settings/tesseract', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ found: true, path: '/usr/bin/tesseract', version: '5.3.0', error: '' }) }))
  await page.route('**/api/v1/screenshots/pending-count', (r: Route) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count: 5 }) }))
}

const panel = '.parse-progress-panel'

test.describe('parse-stream recovery', () => {
  test('reload mid-parse restores the panel from GET /parses/active', async ({ page }) => {
    await installSSEMock(page)
    await routeBackend(page, () => ({ running: true, done: 6, total: 20, scope: 'new' }))
    await page.goto('/')
    await page.locator('#tab-ingest').click()
    // No Parse click — the panel comes back purely from the resync.
    await expect(page.locator(panel)).toBeVisible()
    await expect(page.locator('.pp-total')).toHaveText('20')
  })

  test('SSE drop shows reconnecting; reconnect clears it', async ({ page }) => {
    await installSSEMock(page)
    await routeBackend(page, () => ({ running: true, done: 6, total: 20, scope: 'new' }))
    await page.goto('/')
    await page.locator('#tab-ingest').click()
    await expect(page.locator(panel)).toBeVisible()

    await page.evaluate(() => (window as unknown as { __sse: { drop: () => void } }).__sse.drop())
    await expect(page.locator('[data-stream-reconnecting]')).toBeVisible()

    await page.evaluate(() => (window as unknown as { __sse: { reconnect: () => void } }).__sse.reconnect())
    await expect(page.locator('[data-stream-reconnecting]')).toHaveCount(0)
  })

  test('a stream that stays down escalates to a manual Refresh', async ({ page }) => {
    await page.clock.install()
    await installSSEMock(page)
    let running = true
    await routeBackend(page, () => ({ running, done: 6, total: 20, scope: 'new' }))
    await page.goto('/')
    await page.locator('#tab-ingest').click()
    await expect(page.locator(panel)).toBeVisible()

    await page.evaluate(() => (window as unknown as { __sse: { drop: () => void } }).__sse.drop())
    await expect(page.locator('[data-stream-reconnecting]')).toBeVisible()

    // Watchdog (8s) elapses with no reconnect → lost + Refresh.
    await page.clock.fastForward(9000)
    await expect(page.locator('[data-parse-stream-lost]')).toBeVisible()

    // The parse actually finished during the outage; Refresh resyncs to
    // the now-idle state and clears the panel.
    running = false
    await page.locator('[data-parse-refresh]').click()
    await expect(page.locator(panel)).toHaveCount(0)
  })
})
