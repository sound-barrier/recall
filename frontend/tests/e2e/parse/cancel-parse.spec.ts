/**
 * Cancel-in-flight parse.
 *
 * Real-browser proof of the full chain:
 *
 *   user clicks Stop
 *     → DELETE /api/v1/parses/active hits the server
 *     → SSE run-finished (outcome canceled) fires
 *     → useEventStream calls onParseCanceled
 *     → App.vue clears cancelingParse + reloads records
 *     → IngestView's Stop button flips back to Run
 *
 * The POST /parses mock never resolves (keeps parseBusy=true) so
 * the spec can deterministically exercise the Stop affordance.
 * The SSE mock from parse-queue-and-skeletons.spec.ts is reused
 * to drive the run-finished event after the DELETE lands.
 */
import type { Route } from '@playwright/test'

import { test, expect } from '../_fixtures'

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
  test('Stop click fires DELETE + flips the button back on the canceled run-finished', async ({ page }) => {
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
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count: 5, parked: 0 }) })
    })

    // POST /api/v1/parses answers 202 with the run's id; the run stays
    // in flight until the test fires its run-finished.
    await page.route('**/api/v1/parses', async (route: Route) => {
      await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ run_id: 1 }) })
    })

    // DELETE /api/v1/parses/active — count the calls + return 202.
    let deleteCount = 0
    await page.route('**/api/v1/parses/active', async (route: Route) => {
      // DELETE = Stop (counted). GET = the parse-recovery resync poll —
      // answer idle so it's a no-op and doesn't inflate the count.
      if (route.request().method() === 'DELETE') {
        deleteCount++
        await route.fulfill({ status: 202 })
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: 'idle' }) })
      }
    })

    await page.goto('/')
    await page.getByRole('tab', { name: 'Parse' }).click()

    // Click Run Parse — the run is in flight; the Stop button replaces
    // Run Parse (held for a beat, so click() waits until it is enabled).
    const runBtn = page.locator('button.btn.primary.big').filter({ hasText: 'Run Parse' })
    await runBtn.click()

    const stopBtn = page.getByTestId('cancel-parse-btn')
    await expect(stopBtn).toBeVisible()
    await expect(stopBtn).toContainText('Stop Parse')

    // Click Stop — DELETE fires once; button copy flips to
    // "Canceling…" + the button disables itself.
    await stopBtn.click()
    await expect.poll(() => deleteCount).toBe(1)
    await expect(stopBtn).toContainText('Canceling…')
    await expect(stopBtn).toBeDisabled()

    // The run's run-finished (outcome canceled) returns it to idle.
    // Run Parse comes back.
    await page.evaluate(() => {
      ;(window as unknown as { __recallSSE: { emit: (n: string, d?: unknown) => void } }).__recallSSE
        .emit('run-finished', { run_id: 1, kind: 'parse', outcome: 'canceled' })
    })

    await expect(page.getByTestId('cancel-parse-btn')).toHaveCount(0)
    await expect(page.locator('button.btn.primary.big').filter({ hasText: 'Run Parse' })).toBeVisible()
  })

  test('Stop button is absent when no parse is in flight', async ({ page }) => {
    await installSSEMock(page)
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })

    await page.goto('/')
    await page.getByRole('tab', { name: 'Parse' }).click()

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
      // DELETE = Stop (counted). GET = the parse-recovery resync poll —
      // answer idle so it's a no-op and doesn't inflate the count.
      if (route.request().method() === 'DELETE') {
        deleteCount++
        await route.fulfill({ status: 202 })
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: 'idle' }) })
      }
    })

    await page.goto('/')
    // Stay on Matches (the default landing) — the whole point of
    // the bar's button is "kill the parse without navigating."
    await expect(page.getByRole('tab', { name: /^Matches/ })).toHaveAttribute('aria-selected', 'true')

    // Drive a parse-progress event through the SSE mock — the bar
    // appears, the ABORT tile mounts with it.
    await page.evaluate(() => {
      ;(window as unknown as { __recallSSE: { emit: (n: string, d?: unknown) => void } }).__recallSSE.emit(
        'parse-progress',
        { run_id: 1, done: 5, total: 20, filename: 'mid.png', screenshot_type: 'summary' },
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
    await expect(page.getByRole('tab', { name: /^Matches/ })).toHaveAttribute('aria-selected', 'true')
  })

  // Stop takes Run's place on the same spot: the second click of a
  // double-click on Run used to land on Stop and cancel the fresh run.
  test('a double-click on Run Parse does not cancel the run it starts', async ({ page }) => {
    await installSSEMock(page)
    await bootParseReady(page)
    let deleteCount = 0
    await page.route('**/api/v1/parses', async (route: Route) => {
      await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ run_id: 1 }) })
    })
    await page.route('**/api/v1/parses/active', async (route: Route) => {
      if (route.request().method() === 'DELETE') deleteCount++
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: 'idle' }) })
    })

    await page.goto('/')
    await page.getByRole('tab', { name: 'Parse' }).click()
    // A person's double-click: the second press lands on the same spot a
    // beat later — after the POST has answered and Stop has taken Run's place.
    const box = await page.getByTestId('run-parse-btn').boundingBox()
    if (!box) throw new Error('Run Parse has no box')
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await page.mouse.click(x, y)
    await expect(page.getByTestId('cancel-parse-btn')).toContainText('Stop Parse')
    await page.mouse.click(x, y)

    await page.waitForTimeout(300)
    expect(deleteCount).toBe(0)
  })

  // A restore or a profile switch holds the same run slot. A client that
  // loads mid-restore used to read it as a parse, offer Stop, and sit on
  // "Canceling…" forever after a cancel the server ignored.
  test('a store swap holding the slot shows a disabled Busy…, not Stop', async ({ page }) => {
    await installSSEMock(page)
    await bootParseReady(page)
    await page.route('**/api/v1/parses/active', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ state: 'running', run_id: 4, kind: 'restore', done: 0, total: 0 }),
      })
    })

    await page.goto('/')
    await page.getByRole('tab', { name: 'Parse' }).click()

    const busy = page.getByTestId('cancel-parse-btn')
    await expect(busy).toContainText('Busy…')
    await expect(busy).toBeDisabled()

    await page.evaluate(() => {
      ;(window as unknown as { __recallSSE: { emit: (n: string, d?: unknown) => void } }).__recallSSE
        .emit('run-finished', { run_id: 4, kind: 'restore', outcome: 'completed' })
    })
    await expect(page.getByTestId('run-parse-btn')).toBeVisible()
  })
})

// Clean records, a configured folder, a found Tesseract and pending files,
// so Run Parse is enabled.
async function bootParseReady(page: import('@playwright/test').Page) {
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
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count: 5, parked: 0 }) })
  })
}
