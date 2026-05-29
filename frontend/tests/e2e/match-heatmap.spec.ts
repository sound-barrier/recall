/**
 * Campaign Log header E2E — calendar heatmap (left) + brushable
 * sparkline (right), sharing one trailing 3/6/12-month window and
 * writing to the same useMatchFilters refs.
 *
 * Implements UI_RECOMMENDATIONS item #2 (brushable timeline +
 * sparkline header). Bundled into one feature surface so the two
 * viz share data, layout, and the picker.
 */
import { test, expect } from './_fixtures'
import type { Route } from '@playwright/test'

interface Stub {
  match_key: string
  date: string
  result: 'victory' | 'defeat' | 'draw'
}

function record(s: Stub, idx: number) {
  return {
    match_key: s.match_key,
    source_files: [`${s.match_key}.png`],
    source_types: { [`${s.match_key}.png`]: 'summary' },
    data: {
      map: 'rialto', mode: 'competitive', type: 'control', role: 'support', hero: 'lucio',
      result: s.result,
      date: s.date, finished_at: `${String(20 + (idx % 4)).padStart(2, '0')}:${String((idx * 7) % 60).padStart(2, '0')}`,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '10:00' }],
    },
    parsed_at: `${s.date}T22:30:00Z`,
  }
}

const STUBS: Stub[] = [
  { match_key: 'm1', date: '2026-05-10', result: 'victory' },
  { match_key: 'm2', date: '2026-05-10', result: 'victory' },
  { match_key: 'm3', date: '2026-05-10', result: 'victory' },
  { match_key: 'm4', date: '2026-05-11', result: 'defeat' },
  { match_key: 'm5', date: '2026-05-11', result: 'defeat' },
  { match_key: 'm6', date: '2026-05-12', result: 'victory' },
  { match_key: 'm7', date: '2026-05-12', result: 'defeat' },
  { match_key: 'm8', date: '2026-05-14', result: 'victory' },
]
const CORPUS = STUBS.map((s, i) => record(s, i))

test.describe('campaign-log header', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CORPUS) })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.leaf-row')).toHaveCount(CORPUS.length)
  })

  test('mounts the wrapper with both viz below the FilterRail + AggregateStats', async ({ page }) => {
    const timeline = page.locator('.match-timeline')
    await expect(timeline).toBeVisible()
    // Both children are present.
    await expect(timeline.locator('.match-heatmap')).toBeVisible()
    await expect(timeline.locator('.match-sparkline')).toBeVisible()

    const timelineBox = await timeline.boundingBox()
    const railBox = await page.locator('.filter-rail').boundingBox()
    const statsBox = await page.locator('.agg-stats').boundingBox()
    expect(timelineBox!.y).toBeGreaterThan(railBox!.y)
    expect(timelineBox!.y).toBeGreaterThan(statsBox!.y)
  })

  test('default 6M window → heatmap has ~182 cells, sparkline matches', async ({ page }) => {
    const heatmapCells = await page.locator('.heatmap-cell').count()
    expect(heatmapCells).toBeGreaterThanOrEqual(175)
    expect(heatmapCells).toBeLessThanOrEqual(189)
    const bars = await page.locator('.sparkline-bar').count()
    expect(bars).toBe(heatmapCells)
    // 6M is the active picker choice on first visit.
    await expect(page.locator('.window-btn.active')).toHaveText('6M')
  })

  test('picker flips to 3M and the cell count shrinks accordingly', async ({ page }) => {
    await page.locator('.window-btn', { hasText: '3M' }).click()
    await expect(page.locator('.window-btn.active')).toHaveText('3M')
    const cells = await page.locator('.heatmap-cell').count()
    expect(cells).toBeGreaterThanOrEqual(84)
    expect(cells).toBeLessThanOrEqual(98)
  })

  test('window picker flips both viz to 12M and persists across reload', async ({ page }) => {
    await page.locator('.window-btn', { hasText: '12M' }).click()
    // Both viz rebuild to 52-week window.
    await expect(page.locator('.heatmap-cell')).toHaveCount(
      await page.locator('.sparkline-bar').count(),
    )
    const cells = await page.locator('.heatmap-cell').count()
    expect(cells).toBeGreaterThanOrEqual(357)
    expect(cells).toBeLessThanOrEqual(371)

    await page.reload()
    await expect(page.locator('.match-timeline')).toBeVisible()
    await expect(page.locator('.window-btn.active')).toHaveText('12M')
  })

  test('heatmap cell aria-label encodes the day record (W-L + W%)', async ({ page }) => {
    const winDay = page.locator('.heatmap-cell[data-date="2026-05-10"]')
    await expect(winDay).toHaveAttribute('aria-label', /3 wins, 0 losses.*100%/)
    const lossDay = page.locator('.heatmap-cell[data-date="2026-05-11"]')
    await expect(lossDay).toHaveAttribute('aria-label', /0 wins, 2 losses.*0%/)
  })

  test('a no-match day is tagged empty in the heatmap', async ({ page }) => {
    const emptyDay = page.locator('.heatmap-cell[data-date="2026-05-13"]')
    await expect(emptyDay).toBeVisible()
    await expect(emptyDay).toHaveAttribute('data-empty', 'true')
  })

  test('clicking a heatmap cell sets a single-day filter; clicking the active cell again clears', async ({ page }) => {
    const cell = page.locator('.heatmap-cell[data-date="2026-05-10"]')
    await cell.click()
    await expect(page.locator('.leaf-row')).toHaveCount(3)
    await cell.click()
    await expect(page.locator('.leaf-row')).toHaveCount(CORPUS.length)
  })

  test('sparkline brush — drag across bars sets a date range; the active range renders as a selection band', async ({ page }) => {
    // The sparkline sits below the fold at the default 1280×720
    // viewport (after masthead + FilterRail + AggregateStats +
    // heatmap). Scroll the strip into view so pointer events
    // actually land on the SVG — Playwright doesn't auto-scroll
    // for raw mouse.move().
    const startBar = page.locator('.sparkline-bar[data-date="2026-05-10"]')
    await startBar.scrollIntoViewIfNeeded()
    const endBar   = page.locator('.sparkline-bar[data-date="2026-05-12"]')
    const startBox = await startBar.boundingBox()
    const endBox   = await endBar.boundingBox()
    expect(startBox).not.toBeNull()
    expect(endBox).not.toBeNull()

    const startX = startBox!.x + startBox!.width / 2
    const endX   = endBox!.x + endBox!.width / 2
    const y      = startBox!.y + startBox!.height / 2

    await page.mouse.move(startX, y)
    await page.mouse.down()
    await page.mouse.move(endX, y, { steps: 8 })
    await page.mouse.up()

    await expect(page.locator('.leaf-row')).toHaveCount(7)
    await expect(page.locator('.selection-band')).toBeVisible()
  })

  test('sparkline brush — click without dragging clears the date filter', async ({ page }) => {
    await page.locator('.heatmap-cell[data-date="2026-05-10"]').click()
    await expect(page.locator('.leaf-row')).toHaveCount(3)

    const bar = page.locator('.sparkline-bar[data-date="2026-05-14"]')
    await bar.scrollIntoViewIfNeeded()
    const box = await bar.boundingBox()
    const x = box!.x + box!.width / 2
    const y = box!.y + box!.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.up()
    await expect(page.locator('.leaf-row')).toHaveCount(CORPUS.length)
  })

  // ─── Bug coverage: reactivity + clear-filters round-trips ──────

  test('only one heatmap cell stays active when the user clicks through different days', async ({ page }) => {
    const day1 = page.locator('.heatmap-cell[data-date="2026-05-10"]')
    const day2 = page.locator('.heatmap-cell[data-date="2026-05-11"]')

    await day1.click()
    await expect(day1).toHaveClass(/active/)
    await expect(page.locator('.heatmap-cell.active')).toHaveCount(1)

    await day2.click()
    await expect(day2).toHaveClass(/active/)
    await expect(day1).not.toHaveClass(/active/)
    await expect(page.locator('.heatmap-cell.active')).toHaveCount(1)
  })

  test('Clear Filters in the FilterRail clears the date filter AND the heatmap/sparkline active state', async ({ page }) => {
    // Set the date filter via the heatmap.
    await page.locator('.heatmap-cell[data-date="2026-05-10"]').click()
    await expect(page.locator('.heatmap-cell.active')).toHaveCount(1)
    await expect(page.locator('.leaf-row')).toHaveCount(3)

    // FilterRail's "Clear Filters" button appears only when a
    // filter is active and resets every filter incl. date range.
    const clearBtn = page.locator('button', { hasText: 'Clear Filters' })
    await expect(clearBtn).toBeVisible()
    await clearBtn.click()

    // The heatmap's active cell stops glowing; the sparkline's
    // selection band disappears; the list expands to the full
    // corpus; and the Clear button stops rendering because no
    // filter is active.
    await expect(page.locator('.heatmap-cell.active')).toHaveCount(0)
    await expect(page.locator('.selection-band')).toHaveCount(0)
    await expect(page.locator('.leaf-row')).toHaveCount(CORPUS.length)
    await expect(clearBtn).toHaveCount(0)
  })

  test('Clear Filters stays hidden on first visit when nothing has been touched', async ({ page }) => {
    // No clicks, no brushes — anyFilter must be false.
    await expect(page.locator('button', { hasText: 'Clear Filters' })).toHaveCount(0)
  })

  test('a single-day heatmap click does NOT spawn a date-range pill in the filter rail', async ({ page }) => {
    // The heatmap + sparkline are their own active-range
    // indicators; the date pill is redundant noise and was
    // deliberately removed.
    await page.locator('.heatmap-cell[data-date="2026-05-10"]').click()
    await expect(page.locator('.leaf-row')).toHaveCount(3)
    await expect(page.locator('.filter-pills')).toHaveCount(0)
  })

  test('sparkline brush range lights up every heatmap cell within the range', async ({ page }) => {
    // Brush a 3-day range (5/10 → 5/12) on the sparkline. The
    // heatmap should highlight ALL three days, not just the
    // endpoints — `isActive(cell)` returns true for every cell whose
    // date falls inside [filterFrom, filterTo].
    const startBar = page.locator('.sparkline-bar[data-date="2026-05-10"]')
    await startBar.scrollIntoViewIfNeeded()
    const endBar = page.locator('.sparkline-bar[data-date="2026-05-12"]')
    const startBox = await startBar.boundingBox()
    const endBox   = await endBar.boundingBox()

    const startX = startBox!.x + startBox!.width / 2
    const endX   = endBox!.x + endBox!.width / 2
    const y      = startBox!.y + startBox!.height / 2

    await page.mouse.move(startX, y)
    await page.mouse.down()
    await page.mouse.move(endX, y, { steps: 8 })
    await page.mouse.up()

    // All three days inside the range light up; days outside don't.
    await expect(page.locator('.heatmap-cell[data-date="2026-05-10"]')).toHaveClass(/active/)
    await expect(page.locator('.heatmap-cell[data-date="2026-05-11"]')).toHaveClass(/active/)
    await expect(page.locator('.heatmap-cell[data-date="2026-05-12"]')).toHaveClass(/active/)
    await expect(page.locator('.heatmap-cell[data-date="2026-05-09"]')).not.toHaveClass(/active/)
    await expect(page.locator('.heatmap-cell[data-date="2026-05-13"]')).not.toHaveClass(/active/)
    // Three active cells total (matching the range, ignoring the
    // 1-day-only gap on 5/13).
    expect(await page.locator('.heatmap-cell.active').count()).toBe(3)
  })

  test('clicking a heatmap cell that is inside a brushed range narrows the range to that day (does NOT clear)', async ({ page }) => {
    // Set a 5/10 → 5/12 range via the brush.
    const startBar = page.locator('.sparkline-bar[data-date="2026-05-10"]')
    await startBar.scrollIntoViewIfNeeded()
    const endBar = page.locator('.sparkline-bar[data-date="2026-05-12"]')
    const startBox = await startBar.boundingBox()
    const endBox   = await endBar.boundingBox()
    await page.mouse.move(startBox!.x + startBox!.width / 2, startBox!.y + startBox!.height / 2)
    await page.mouse.down()
    await page.mouse.move(endBox!.x + endBox!.width / 2, endBox!.y + endBox!.height / 2, { steps: 8 })
    await page.mouse.up()
    await expect(page.locator('.heatmap-cell.active')).toHaveCount(3)

    // Click 5/11 — should narrow to that single day, NOT clear.
    await page.locator('.heatmap-cell[data-date="2026-05-11"]').click()
    await expect(page.locator('.heatmap-cell.active')).toHaveCount(1)
    await expect(page.locator('.heatmap-cell[data-date="2026-05-11"]')).toHaveClass(/active/)
    await expect(page.locator('.leaf-row')).toHaveCount(2) // m4 + m5 on 5/11
  })

  test('the FilterRail date inputs round-trip into the heatmap active state', async ({ page }) => {
    // Setting the date filter from outside the heatmap — e.g. via
    // the FilterRail's from/to inputs — should still light up the
    // matching cell. (datetime-local inputs have a `min` set to the
    // earliest match, so we have to use values within the corpus
    // range; 2026-05-12 has 1W 1L in the fixture.)
    const fromInput = page.locator('.range-label', { hasText: 'From' }).locator('input')
    const toInput   = page.locator('.range-label', { hasText: 'To' }).locator('input')
    await fromInput.fill('2026-05-12T00:00')
    await fromInput.dispatchEvent('change')
    await toInput.fill('2026-05-12T23:59')
    await toInput.dispatchEvent('change')
    await expect(page.locator('.heatmap-cell[data-date="2026-05-12"]')).toHaveClass(/active/)
    await expect(page.locator('.heatmap-cell.active')).toHaveCount(1)
  })
})
