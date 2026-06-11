/**
 * Live-reflow drag UX.
 *
 * Three contracts to pin:
 *   1. The dragged source widget wears the `dashboard-widget-dragging`
 *      ghost class while a drag is in flight (highlighting the box
 *      being dragged).
 *   2. While the cursor is over a drop target, the dossier renders a
 *      PREVIEW layout — the dragged widget is rendered at the
 *      prospective drop position so the user sees exactly where it
 *      will land and the displaced widgets reflow around it.
 *   3. If the user releases the mouse without an intervening drop on
 *      a dossier cell (= released off-dossier), the layout snaps back
 *      to its pre-drag state.
 *
 * We exercise the contract by driving the DnD events programmatically
 * via page.dispatchEvent rather than relying on Playwright's
 * locator.dragTo, which doesn't always produce stable native drag
 * events in headless Chromium.
 */
import { test, expect } from './_fixtures'
import type { Route } from '@playwright/test'

function singleMatch() {
  return {
    match_key: 'm1',
    source_files: ['m1.png'],
    source_types: { 'm1.png': 'summary' },
    data: {
      map: 'rialto', playlist: 'competitive', type: 'control',
      role: 'support', hero: 'lucio',
      result: 'victory', date: '2026-05-10', finished_at: '22:00',
      eliminations: 17, assists: 16, deaths: 11,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '11:25' }],
    },
    parsed_at: '2026-05-10T22:30:00Z',
  }
}

async function widgetOrder(page: import('@playwright/test').Page, rowIdx: number): Promise<string[]> {
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
      if (el.classList.contains('dashboard-widget-leave-active')) continue
      const id = el.getAttribute('data-widget-id')
      if (id) out.push(id)
    }
    return out
  }, rowIdx)
}

// Drive a programmatic dragstart on the source widget. Returns the
// DataTransfer-equivalent the rest of the helpers reuse.
async function startDrag(page: import('@playwright/test').Page, srcId: string) {
  await page.evaluate((id) => {
    const root = document.querySelector(`[data-widget-id="${id}"]`)
    if (!root) throw new Error(`source widget ${id} not found`)
    const dt = new DataTransfer()
    const ev = new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt })
    root.dispatchEvent(ev)
    ;(window as unknown as { __dragDT?: DataTransfer }).__dragDT = dt
  }, srcId)
}

async function dragOver(page: import('@playwright/test').Page, targetId: string) {
  await page.evaluate((id) => {
    const root = document.querySelector(`[data-widget-id="${id}"]`)
    if (!root) throw new Error(`target widget ${id} not found`)
    const dt = (window as unknown as { __dragDT?: DataTransfer }).__dragDT ?? new DataTransfer()
    const ev = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })
    root.dispatchEvent(ev)
  }, targetId)
}

async function endDrag(page: import('@playwright/test').Page, srcId: string) {
  await page.evaluate((id) => {
    const root = document.querySelector(`[data-widget-id="${id}"]`)
    if (!root) return
    const dt = (window as unknown as { __dragDT?: DataTransfer }).__dragDT ?? new DataTransfer()
    const ev = new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt })
    root.dispatchEvent(ev)
  }, srcId)
}

test.describe('dashboard live-reflow drag', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([singleMatch()]),
      })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
  })

  test('source widget wears the ghost class while a drag is in flight', async ({ page }) => {
    const source = page.locator('[data-widget-id="winrate"]')
    await expect(source).not.toHaveClass(/dashboard-widget-dragging/)

    await startDrag(page, 'winrate')
    await expect(source).toHaveClass(/dashboard-widget-dragging/)

    await endDrag(page, 'winrate')
    await expect(source).not.toHaveClass(/dashboard-widget-dragging/)
  })

  test('dragging over a sibling reflows the row so the dragged widget sits at the drop position', async ({ page }) => {
    // Initial: row 1 = winrate, avg-kda, total-time, …
    const before = await widgetOrder(page, 1)
    expect(before[0]).toBe('winrate')
    expect(before[1]).toBe('avg-kda')

    await startDrag(page, 'winrate')
    // Hover total-time (originally at idx 2). The preview should
    // place winrate at idx 2 of the row, with avg-kda + total-time
    // shifting left to fill the gap.
    await dragOver(page, 'total-time')

    const preview = await widgetOrder(page, 1)
    expect(preview.indexOf('winrate')).toBe(2)
    // avg-kda used to be at idx 1; it should now be at idx 0 (after
    // winrate's source slot vanished).
    expect(preview[0]).toBe('avg-kda')

    await endDrag(page, 'winrate')
  })

  test('ending the drag off the dossier reverts the layout to its pre-drag state', async ({ page }) => {
    const before = await widgetOrder(page, 1)

    await startDrag(page, 'winrate')
    await dragOver(page, 'total-time')
    // No drop event — just dragend (mimics releasing outside any drop target).
    await endDrag(page, 'winrate')

    const after = await widgetOrder(page, 1)
    expect(after).toEqual(before)
    // localStorage still holds the original layout.
    const stored = await page.evaluate(() => localStorage.getItem('recall.dashboard.layout'))
    if (stored !== null) {
      const parsed = JSON.parse(stored) as Record<string, string[]>
      // winrate should not have moved in storage.
      expect(parsed['1']?.[0]).toBe('winrate')
    }
  })
})
