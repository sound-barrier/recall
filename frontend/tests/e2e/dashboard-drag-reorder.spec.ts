/**
 * Drag-to-reorder + cross-row dashboard widgets.
 *
 * There is no edit mode — every widget always carries a drag handle.
 * Every reorder path — native HTML5 drag, same-row keyboard, cross-row
 * keyboard — pipes through useDragReorder → useDashboardLayout →
 * `recall.dashboard.layout` localStorage. The persisted JSON is
 * row-keyed so cross-row moves are atomic.
 */
import { test, expect } from './_fixtures'
import type { Route } from '@playwright/test'

function singleMatch() {
  return {
    match_key: 'm1',
    source_files: ['m1.png'],
    source_types: { 'm1.png': 'summary' },
    data: {
      map: 'rialto', playlist: 'competitive', game_mode: 'control',
      role: 'support', hero: 'lucio',
      result: 'victory', date: '2026-05-10', finished_at: '22:00',
      eliminations: 17, assists: 16, deaths: 11,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '11:25' }],
    },
    parsed_at: '2026-05-10T22:30:00Z',
  }
}

async function widgetOrder(page: import('@playwright/test').Page, rowIdx: number): Promise<string[]> {
  // Wait until the TransitionGroup's leave-active class is no
  // longer present on any widget in the row — otherwise a row
  // walk done mid-transition will still see the leaving widget.
  await page.waitForFunction((r) => {
    const row = document.querySelector(`.dashboard-row[data-row="${r}"]`)
    if (!row) return true
    return row.querySelectorAll('.dashboard-widget-leave-active').length === 0
  }, rowIdx, { timeout: 2000 })
  return await page.evaluate((r) => {
    const row = document.querySelector(`.dashboard-row[data-row="${r}"]`)
    if (!row) return []
    const out: string[] = []
    for (const el of Array.from(row.querySelectorAll('[data-widget-id]'))) {
      // Belt-and-suspenders: even if the wait above didn't catch it
      // (e.g. reduced-motion strips transitions and the class never
      // appears), skip widgets in their leave phase. DOM-present but
      // no longer logically in the row.
      if (el.classList.contains('dashboard-widget-leave-active')) continue
      const id = el.getAttribute('data-widget-id')
      if (id) out.push(id)
    }
    return out
  }, rowIdx)
}

test.describe('dashboard drag-reorder', () => {

  // goto + open Matches + wait for the widget grid to hydrate. focus() and
  // page.evaluate don't auto-wait the way locators do, so every test must
  // gate on a rendered widget before driving the keyboard/DOM (retries are
  // 0 — one lost race reds the whole job; this spec flaked twice on CI).
  async function openDashboard(page: import('@playwright/test').Page) {
    await page.goto('/')
    await page.getByRole('tab', { name: /^Matches/ }).click()
    await expect(page.locator('[data-widget-id="winrate"]')).toBeVisible()
  }

  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([singleMatch()]),
      })
    })
  })

  test('drag handles are always present (no edit mode)', async ({ page }) => {
    await openDashboard(page)
    await expect(page.locator('.set-dossier')).toBeVisible()

    // Always-on chrome — a handle on every widget, no mode to enter.
    await expect(page.locator('[data-drag-handle]').first()).toBeVisible()
    await expect(page.locator('[data-drag-handle="winrate"]')).toHaveCount(1)
  })

  test('keyboard ArrowRight on a focused handle reorders within the row', async ({ page }) => {
    await openDashboard(page)

    const initial = await widgetOrder(page, 1)
    expect(initial[0]).toBe('winrate')
    expect(initial[1]).toBe('form-delta')

    // Focus the Winrate handle and press ArrowRight.
    await page.locator('[data-drag-handle="winrate"]').focus()
    await page.keyboard.press('ArrowRight')

    // Winrate should now be at idx 1, Avg K/D/A at idx 0.
    const afterMove = await widgetOrder(page, 1)
    expect(afterMove[0]).toBe('form-delta')
    expect(afterMove[1]).toBe('winrate')
  })

  test('keyboard ArrowDown moves the widget into the row below', async ({ page }) => {
    await openDashboard(page)
    // Winrate starts in row 1; press ArrowDown on its handle.
    await page.locator('[data-drag-handle="winrate"]').focus()
    await page.keyboard.press('ArrowDown')

    // Winrate now lives in row 2 alongside the breakdowns. Row 1
    // shrinks by one cell.
    const row1 = await widgetOrder(page, 1)
    const row2 = await widgetOrder(page, 2)
    expect(row1).not.toContain('winrate')
    expect(row2).toContain('winrate')
  })

  test('reorder persists across reload via recall.dashboard.layout', async ({ page }) => {
    await openDashboard(page)
    // Move Winrate one slot to the right — and see the reorder land
    // BEFORE reloading, so the persisted write provably happened.
    await page.locator('[data-drag-handle="winrate"]').focus()
    await page.keyboard.press('ArrowRight')
    await expect.poll(async () => (await widgetOrder(page, 1))[0]).toBe('form-delta')

    // Reload + reopen Matches tab, gating on hydration again.
    await page.reload()
    await page.getByRole('tab', { name: /^Matches/ }).click()
    await expect(page.locator('[data-widget-id="winrate"]')).toBeVisible()

    const afterReload = await widgetOrder(page, 1)
    expect(afterReload[0]).toBe('form-delta')
    expect(afterReload[1]).toBe('winrate')

    // localStorage carries the row-keyed JSON shape.
    const stored = await page.evaluate(() => localStorage.getItem('recall.dashboard.layout'))
    expect(stored).not.toBeNull()
    const parsed = JSON.parse(stored!) as Record<string, string[]>
    expect(parsed['1']![0]).toBe('form-delta')
    expect(parsed['1']![1]).toBe('winrate')
  })

  test('drag-handle exposes an aria-label naming the widget + keyboard contract', async ({ page }) => {
    await openDashboard(page)
    const handle = page.locator('[data-drag-handle="winrate"]')
    const label = await handle.getAttribute('aria-label')
    expect(label).toContain('winrate')
    expect(label?.toLowerCase()).toContain('arrow')
  })
})
