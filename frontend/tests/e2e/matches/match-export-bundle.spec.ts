/**
 * Export bundle flow E2E.
 *
 * Drives the full contract through the real browser:
 *   1. Three visible matches load.
 *   2. User ticks two checkboxes → bulk-action bar appears with the
 *      "Export backup…" button.
 *   3. Click → ExportBundleModal opens with:
 *        - "Selected matches: 2"
 *        - filename input defaulted to recall-bundle-<timestamp>.zip
 *        - hidden + unknown count toggles
 *   4. Click Export → POST /api/v1/exports/bundle fires with the
 *      ticked match_keys + the toggle values, server returns a ZIP
 *      body, browser saves it.
 */
import type { Route } from '@playwright/test'

import { routeCapture } from '../_capture'
import { test, expect } from '../_fixtures'

const KEYS = [
  'match-2026-05-10T22-00-00',
  'match-2026-05-10T22-30-00',
  'match-2026-05-10T23-00-00',
] as const

const HEROES = ['lucio', 'ana', 'mercy'] as const

function record(i: number) {
  return {
    match_key: KEYS[i],
    source_files: [`${KEYS[i]}.png`],
    data: {
      map: 'rialto',
      playlist: 'competitive',
      game_mode: 'control',
      role: 'support',
      hero: HEROES[i],
      result: 'victory',
      date: '2026-05-10',
      finished_at: ['22:00', '22:30', '23:00'][i],
      eliminations: 10 + i,
      assists: 5,
      deaths: 3,
      damage: 5000,
      heroes_played: [{ hero: HEROES[i], percent_played: 100, play_time: '10:00' }],
    },
    parsed_at: '2026-05-10T23:30:00Z',
  }
}

test.describe('matches — export bundle', () => {
  test('selection + modal + export call shape', async ({ page }) => {
    const bundleBody = routeCapture<{
      match_keys?: string[]
      include_unknown?: boolean
      include_hidden?: boolean
    }>('export-bundle POST body')

    await page.route('**/api/v1/matches', async (route: Route) => {
      const records = KEYS.map((_, i) => record(i))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(records),
      })
    })
    await page.route('**/api/v1/exports/bundle', async (route: Route) => {
      bundleBody.set(JSON.parse(route.request().postData() ?? '{}'))
      // Respond with a minimal valid ZIP (just the local-header magic
      // bytes + central-directory end record). The browser only sees
      // bytes + Content-Disposition; the bundle's correctness is
      // covered by the Go tests.
      await route.fulfill({
        status:  200,
        headers: {
          'Content-Type':        'application/zip',
          'Content-Disposition': 'attachment; filename="recall-bundle-test.zip"',
        },
        body: Buffer.from([
          0x50, 0x4b, 0x05, 0x06, // PK\x05\x06 (empty ZIP "End of central directory")
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ]),
      })
    })

    await page.goto('/')
    await page.getByRole('tab', { name: /^Matches/ }).click()
    await expect(page.locator('.leaf-row')).toHaveCount(3)

    // Tick the first two rows. Use `.leaf-checkbox` — the same
    // selector match-bulk-hide-drawer uses for the visible-list
    // checkbox affordance.
    await page.locator('.leaf-row').nth(0).locator('.leaf-checkbox').click()
    await page.locator('.leaf-row').nth(1).locator('.leaf-checkbox').click()

    // The bulk-action bar shows the new Export backup button.
    const exportBtn = page.getByTestId('bulk-export-bundle')
    await expect(exportBtn).toBeVisible()
    await exportBtn.click()

    // Modal opens with the selected count.
    const modal = page.getByTestId('export-bundle-modal')
    await expect(modal).toBeVisible()
    await expect(modal.locator('.export-bundle-value')).toContainText('2')

    // Filename default matches the recall-backup-<timestamp>.zip pattern.
    const filenameInput = modal.getByTestId('filename')
    await expect(filenameInput).toHaveValue(/^recall-backup-\d{8}-\d{6}\.zip$/)

    // Click Export. The POST /api/v1/exports/bundle handler records
    // the body so we can assert match_keys + the toggle values.
    await modal.getByTestId('export-submit').click()

    await expect.poll(() => bundleBody.seen()).toBe(true)
    // Rendered order is newest-first (Sort=Newest default), so the
    // ticked first-two rows are the LATER two keys. Assert without
    // ordering — selection semantics, not list order.
    const exported = bundleBody.get()
    expect(exported.match_keys?.length).toBe(2)
    expect(new Set(exported.match_keys ?? [])).toEqual(new Set([KEYS[1], KEYS[2]]))
    expect(exported.include_unknown).toBe(false)
    expect(exported.include_hidden).toBe(false)

    // Modal closes on success.
    await expect(modal).toBeHidden()
  })
})

/**
 * The dialog has to fit the window, or be scrollable to.
 *
 * It was neither. Flex-centered with no `max-height`, a box taller than the
 * viewport overflowed symmetrically — and the TOP half of an
 * `align-items: center` overflow is unreachable by any means. Nothing in the
 * stack scrolled either: `useScrollLock` cancels every wheel that does not
 * land in an `overflow-y: auto` element, and there was none. The desktop
 * window floor is 768px (pkg/cmd/window_size.go) and the user can drag it
 * smaller than that, so "it fits on my monitor" was never the contract.
 */
test.describe('export bundle — the dialog fits the window', () => {
  async function openModal(page: import('@playwright/test').Page) {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(KEYS.map((_, i) => record(i))),
      })
    })
    await page.goto('/')
    await page.getByRole('tab', { name: /^Matches/ }).click()
    await expect(page.locator('.leaf-row')).toHaveCount(3)
    await page.locator('.leaf-row').nth(0).locator('.leaf-checkbox').click()
    await page.getByTestId('bulk-export-bundle').click()
    const modal = page.getByTestId('export-bundle-modal')
    await expect(modal).toBeVisible()
    return modal
  }

  // 700 is below the app's own 768px window floor — the case a laptop user
  // actually hits. 420 is the extreme that proves the head and the actions
  // row are genuinely pinned rather than merely fitting.
  for (const height of [700, 420]) {
  test(`starts on screen and scrolls its body at ${height}px`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height })
    const modal = await openModal(page)
    const box = modal.locator('.sheet-box')

    const bb = (await box.boundingBox())!
    expect(bb.y, 'the top of the dialog is on screen').toBeGreaterThanOrEqual(-1)
    expect(bb.y + bb.height, 'the bottom of the dialog is on screen').toBeLessThanOrEqual(height + 1)

    // Whatever the actions row sits below has to be reachable. Asserted only
    // if there IS an overflow, so the case cannot pass vacuously.
    const body = modal.locator('.sheet-body')
    const overflows = await body.evaluate((el) => el.scrollHeight > el.clientHeight + 4)
    if (overflows) {
      // The wheel is the assertion that matters: useScrollLock cancels any
      // wheel that does not land in an `overflow-y: auto` element, so a
      // max-height with no scroller would satisfy every other check here
      // and still be completely inert under the mouse.
      await body.hover()
      await page.mouse.wheel(0, 400)
      await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)

      // And the title stays put while the body moves.
      const titleTop = async () => (await modal.locator('.export-bundle-title').boundingBox())!.y
      const before = await titleTop()
      await body.evaluate((el) => { el.scrollTop = el.scrollHeight })
      expect(await titleTop(), 'the title is pinned').toBeCloseTo(before, 0)
    }

    // The way out is always visible — a dialog you cannot cancel is a trap.
    const cancel = modal.getByRole('button', { name: 'Cancel' })
    const cb = (await cancel.boundingBox())!
    expect(cb.y, 'Cancel is on screen').toBeGreaterThanOrEqual(0)
    expect(cb.y + cb.height, 'Cancel is fully on screen').toBeLessThanOrEqual(height + 1)
  })
  }

  test('grows no scrollbar when it already fits', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 })
    const modal = await openModal(page)
    const body = modal.locator('.sheet-body')
    expect(
      await body.evaluate((el) => el.scrollHeight <= el.clientHeight + 4),
      'a dialog that fits does not scroll',
    ).toBe(true)
  })
})
