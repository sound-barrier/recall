/**
 * The end-of-run outcome toast.
 *
 * parse-complete carries the run's own tally now
 * ({files_parsed, files_failed, matches_updated}); the toast reports it
 * from ANY tab (the watcher can finish a run while the user is
 * elsewhere), with a "View failed" affordance landing on the Unknown
 * tab when anything failed. A payload-less legacy event must neither
 * toast nor crash.
 */
import type { Route } from '@playwright/test'

import { test, expect } from '../_fixtures'

declare global {
  interface Window {
    __recallSSE: { emit: (name: string, data?: unknown) => void }
  }
}

async function installSSEMock(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    interface MockListener { (e: MessageEvent): void }
    const handlers: Record<string, MockListener[]> = {}
    class MockEventSource {
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
        const evt = new MessageEvent(name, { data: payload })
        for (const fn of arr) fn(evt)
      },
    }
  })
}

async function boot(page: import('@playwright/test').Page) {
  await installSSEMock(page)
  await page.route('**/api/v1/matches', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
  await page.route('**/api/v1/screenshots/pending-count', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count: 0, parked: 0 }) })
  })
  await page.goto('/')
}

test.describe('parse outcome toast', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
  })

  test('reports the tally with a View failed door when anything failed to read', async ({ page }) => {
    await boot(page)
    // The Matches tab is the landing view — the toast must reach the
    // user wherever the watcher-finished run finds them.
    await page.evaluate(() => {
      window.__recallSSE.emit('parse-complete', { files_parsed: 4, files_failed: 2, matches_updated: 3 })
    })

    const toast = page.getByRole('status').filter({ hasText: /4 read/ })
    await expect(toast).toContainText(/4 read · 2 failed to read/)
    await toast.getByRole('button', { name: /View failed/ }).click()
    await expect(page.getByRole('tab', { name: /^Unknown/ })).toHaveAttribute('aria-selected', 'true')
  })

  test('a clean run drops the failure clause', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => {
      window.__recallSSE.emit('parse-complete', { files_parsed: 5, files_failed: 0, matches_updated: 5 })
    })

    const toast = page.getByRole('status').filter({ hasText: /5 read/ })
    await expect(toast).toBeVisible()
    await expect(toast).not.toContainText(/failed/)
    await expect(toast.getByRole('button', { name: /View failed/ })).toHaveCount(0)
  })

  test('a payload-less legacy event neither toasts nor crashes', async ({ page }) => {
    await boot(page)
    await page.evaluate(() => {
      window.__recallSSE.emit('parse-complete')
    })

    await expect(page.getByRole('status').filter({ hasText: /read/ })).toHaveCount(0)
    // The app is still alive and interactive.
    await page.getByRole('tab', { name: 'Parse' }).click()
    await expect(page.getByTestId('run-parse-btn')).toBeVisible()
  })
})
