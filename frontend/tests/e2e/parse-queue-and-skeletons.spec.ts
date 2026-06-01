/**
 * Background parse-queue visualisation + animated skeleton loaders.
 *
 * Two related features land in the same spec because they share the
 * "first paint shouldn't feel empty" framing from FEATURES.md:
 *
 *   - Masthead parse-queue chip — shows `12 / 47` when a parse run
 *     is in flight, driven off the existing `parse-progress` SSE
 *     event. Visible from every tab so the user sees ingest activity
 *     without scanning to the status bar at the bottom.
 *
 *   - Matches skeleton rows — first paint of the Matches view, while
 *     `GetMatchResults` is still in flight, renders skeleton
 *     leaf-rows that mirror the real `.leaf-row` grid. Replaces the
 *     prior "blank panel → content pops in a beat later" feel.
 *
 * SSE: the server mode wires parse-progress through EventSource on
 * `/api/v1/events`. We swap `window.EventSource` with a controllable
 * mock via `addInitScript` so the spec can dispatch named events
 * deterministically — no race between page.route streaming and the
 * client's open().
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

// ────────────────────────────────────────────────────────────────────
// SSE mock — injected at navigation time so window.EventSource is the
// stub before App.vue mounts. The mock keeps a per-event-name handler
// registry; the test drives ticks via `page.evaluate` against the
// global `__recallSSE.emit(name, data)` shim.
// ────────────────────────────────────────────────────────────────────
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

test.describe('masthead parse-queue chip', () => {
  test('shows 12 / 47 counter when parse-progress event lands; jumps to Parse tab on click', async ({ page }) => {
    await installSSEMock(page)
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })

    await page.goto('/')

    // No chip before any parse-progress event fires.
    await expect(page.locator('.masthead-parse-chip')).toHaveCount(0)

    // Emit a parse-progress event partway through a 47-file batch.
    await page.evaluate(() => {
      ;(window as unknown as { __recallSSE: { emit: (n: string, d: unknown) => void } }).__recallSSE.emit(
        'parse-progress',
        { done: 12, total: 47, filename: 'overwatch-12.png', screenshot_type: 'summary' },
      )
    })

    // Chip surfaces with "12 / 47".
    const chip = page.locator('.masthead-parse-chip')
    await expect(chip).toBeVisible()
    await expect(chip).toContainText('12')
    await expect(chip).toContainText('47')

    // Click jumps to the Parse tab (the detailed log lives there).
    await chip.click()
    await expect(page.locator('#tab-ingest')).toHaveAttribute('aria-selected', 'true')
  })

  test('chip disappears once done === total and a settle window passes', async ({ page }) => {
    await installSSEMock(page)
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })

    await page.goto('/')

    // Mid-batch — chip is visible.
    await page.evaluate(() => {
      ;(window as unknown as { __recallSSE: { emit: (n: string, d: unknown) => void } }).__recallSSE.emit(
        'parse-progress',
        { done: 1, total: 3, filename: 'a.png', screenshot_type: 'summary' },
      )
    })
    await expect(page.locator('.masthead-parse-chip')).toBeVisible()

    // Final tick — done === total. The chip lingers briefly so the
    // user can read the closing 3 / 3, then disappears.
    await page.evaluate(() => {
      ;(window as unknown as { __recallSSE: { emit: (n: string, d: unknown) => void } }).__recallSSE.emit(
        'parse-progress',
        { done: 3, total: 3, filename: 'c.png', screenshot_type: 'summary' },
      )
    })
    await expect(page.locator('.masthead-parse-chip')).toContainText('3')
    // After the settle window (component-owned timer), the chip is
    // gone. Generous timeout — the component picks a value, we just
    // verify the eventual state.
    await expect(page.locator('.masthead-parse-chip')).toHaveCount(0, { timeout: 4000 })
  })
})

test.describe('matches skeleton loaders on first paint', () => {
  test('renders skeleton leaf-rows until /api/v1/matches resolves', async ({ page }) => {
    let releaseMatches: (() => void) | null = null
    const matchesPending = new Promise<void>((resolve) => { releaseMatches = resolve })

    await page.route('**/api/v1/matches', async (route: Route) => {
      await matchesPending
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            match_key: 'match:2026-05-10T22:00:00',
            source_files: ['match:2026-05-10T22:00:00.png'],
            data: {
              map: 'rialto', mode: 'competitive', type: 'control', role: 'support',
              hero: 'lucio', result: 'victory', date: '2026-05-10', finished_at: '22:00',
              eliminations: 17, assists: 16, deaths: 11, damage: 7200,
              heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '11:25' }],
            },
            parsed_at: '2026-05-10T22:30:00Z',
          },
        ]),
      })
    })

    await page.goto('/')
    // Matches tab is the default landing, so skeleton rows should be
    // present immediately. The aria-busy hook on the list lets
    // assistive tech announce "loading".
    const skeletons = page.locator('.leaf-skeleton')
    await expect(skeletons.first()).toBeVisible()
    expect(await skeletons.count()).toBeGreaterThanOrEqual(3)

    // The leaves list announces busy state while skeletons are up.
    await expect(page.locator('[data-matches-loading="true"]').first()).toBeVisible()

    // Real records arrive — skeletons disappear, a real .leaf-row
    // appears in their place.
    releaseMatches!()
    await expect(page.locator('.leaf-row')).toHaveCount(1)
    await expect(page.locator('.leaf-skeleton')).toHaveCount(0)
  })
})
