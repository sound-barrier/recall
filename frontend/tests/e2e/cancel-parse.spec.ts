/**
 * Cancel-in-flight parse (TECHNICAL_DEBT.md item 15).
 *
 * Real-browser proof of the full chain:
 *
 *   user clicks Stop
 *     → DELETE /api/v1/parses/active hits the server
 *     → SSE parse-cancelled fires
 *     → useEventStream calls onParseCancelled
 *     → App.vue clears cancellingParse + reloads records
 *     → IngestView's Stop button flips back to Run
 *
 * The POST /parses mock never resolves (keeps parseBusy=true) so
 * the spec can deterministically exercise the Stop affordance.
 * The SSE mock from parse-queue-and-skeletons.spec.ts is reused
 * to drive the parse-cancelled event after the DELETE lands.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

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

test.describe('cancel-parse — Stop affordance + SSE confirmation', () => {
  test('Stop click fires DELETE + flips the button back on parse-cancelled', async ({ page }) => {
    await installSSEMock(page)

    // Boot mocks: clean records, configured screenshots dir, found
    // tesseract, one screenshot pending so Run Parse is enabled.
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
    await page.route('**/api/v1/settings/screenshots-folder', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ path: '/srv/recall' }) })
    })
    await page.route('**/api/v1/settings/tesseract', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ path: '/usr/local/bin/tesseract', found: true, version: '5.5.0', supported: true, error: '', default: '/usr/local/bin/tesseract', platform: 'darwin' }),
      })
    })
    await page.route('**/api/v1/screenshots/pending-count', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count: 5 }) })
    })

    // POST /api/v1/parses never resolves — keeps parseBusy=true so
    // the Stop button stays visible for the test's lifetime. The
    // pending request gets cleaned up when the page tears down.
    let parsePending: () => void = () => undefined
    await page.route('**/api/v1/parses', async (route: Route) => {
      await new Promise<void>((resolve) => {
        parsePending = resolve
      })
      await route.fulfill({ status: 202 })
    })

    // DELETE /api/v1/parses/active — count the calls + return 202.
    let deleteCount = 0
    await page.route('**/api/v1/parses/active', async (route: Route) => {
      deleteCount++
      await route.fulfill({ status: 202 })
    })

    await page.goto('/')
    await page.locator('#tab-ingest').click()

    // Click Run Parse — POST stays pending; parseBusy flips true;
    // the Stop button replaces Run Parse.
    const runBtn = page.locator('button.btn.primary.big').filter({ hasText: 'Run Parse' })
    await runBtn.click()

    const stopBtn = page.getByTestId('cancel-parse-btn')
    await expect(stopBtn).toBeVisible()
    await expect(stopBtn).toContainText('Stop Parse')

    // Click Stop — DELETE fires once; button copy flips to
    // "Cancelling…" + the button disables itself.
    await stopBtn.click()
    await expect.poll(() => deleteCount).toBe(1)
    await expect(stopBtn).toContainText('Cancelling…')
    await expect(stopBtn).toBeDisabled()

    // Server fires parse-cancelled over SSE → App.vue clears
    // cancellingParse + parseBusy via the onParseCancelled hook
    // (which calls load()). Run Parse comes back.
    await page.evaluate(() => {
      ;(window as unknown as { __recallSSE: { emit: (n: string, d?: unknown) => void } }).__recallSSE.emit('parse-cancelled')
    })
    // Release the pending POST so the runParse() finally block fires.
    parsePending()

    await expect(page.getByTestId('cancel-parse-btn')).toHaveCount(0)
    await expect(page.locator('button.btn.primary.big').filter({ hasText: 'Run Parse' })).toBeVisible()
  })

  test('Stop button is absent when no parse is in flight', async ({ page }) => {
    await installSSEMock(page)
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })

    await page.goto('/')
    await page.locator('#tab-ingest').click()

    // Bare boot: no Stop affordance anywhere.
    await expect(page.getByTestId('cancel-parse-btn')).toHaveCount(0)
    await expect(page.getByTestId('status-bar-cancel-btn')).toHaveCount(0)
  })

  test('Status-bar ABORT also drives the cancel chain — from any tab', async ({ page }) => {
    await installSSEMock(page)
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
    let deleteCount = 0
    await page.route('**/api/v1/parses/active', async (route: Route) => {
      deleteCount++
      await route.fulfill({ status: 202 })
    })

    await page.goto('/')
    // Stay on Matches (the default landing) — the whole point of
    // the bar's button is "kill the parse without navigating."
    await expect(page.locator('#tab-matches')).toHaveAttribute('aria-selected', 'true')

    // Drive a parse-progress event through the SSE mock — the bar
    // appears, the ABORT tile mounts with it.
    await page.evaluate(() => {
      ;(window as unknown as { __recallSSE: { emit: (n: string, d?: unknown) => void } }).__recallSSE.emit(
        'parse-progress',
        { done: 5, total: 20, filename: 'mid.png', screenshot_type: 'summary' },
      )
    })

    const abort = page.getByTestId('status-bar-cancel-btn')
    await expect(abort).toBeVisible()
    await expect(abort).toContainText('ABORT')

    // Click ABORT — DELETE fires once + the button flips to
    // ABORTING + disables itself.
    await abort.click()
    await expect.poll(() => deleteCount).toBe(1)
    await expect(abort).toContainText('ABORTING')
    await expect(abort).toBeDisabled()

    // Confirm the click was NOT also interpreted as a
    // jump-to-Ingest by the bar's outer handler (regression guard
    // for data-no-jump + @click.stop).
    await expect(page.locator('#tab-matches')).toHaveAttribute('aria-selected', 'true')
  })
})
