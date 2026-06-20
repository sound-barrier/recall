/**
 * Campaign Log header E2E — calendar heatmap (left) + brushable
 * sparkline (right), sharing one trailing 3/6/12-month window.
 *
 * Both viz live inside `MatchTimelineHeader` and reach the same
 * `useMatchesNarrow` customFrom / customTo refs so flipping one
 * updates the other's selection band.
 *
 * Pre-redesign this spec also covered `.filter-rail` / `.agg-stats`
 * integration and a "Clear Filters" button — all retired in favour
 * of the Narrow panel + the `.active-chip.clear` rail chip.
 */
import { test, expect } from './_fixtures'
import type { Route, Page } from '@playwright/test'

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
      map: 'rialto', playlist: 'competitive', game_mode: 'control', role: 'support', hero: 'lucio',
      result: s.result,
      date: s.date, finished_at: `${String(20 + (idx % 4)).padStart(2, '0')}:${String((idx * 7) % 60).padStart(2, '0')}`,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '10:00' }],
    },
    parsed_at: `${s.date}T22:30:00Z`,
  }
}

// Dates intentionally close to "today" so the trailing-N-month
// window includes them. The component reads today's date from
// new Date() — pinning relative-to-now keeps the heatmap surface
// stable without needing fake timers.
const todayISO = new Date().toISOString().slice(0, 10)
function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

const STUBS: Stub[] = [
  { match_key: 'm1', date: daysAgo(2),  result: 'victory' },
  { match_key: 'm2', date: daysAgo(2),  result: 'victory' },
  { match_key: 'm3', date: daysAgo(2),  result: 'victory' },
  { match_key: 'm4', date: daysAgo(1),  result: 'defeat' },
  { match_key: 'm5', date: daysAgo(1),  result: 'defeat' },
  { match_key: 'm6', date: todayISO,    result: 'victory' },
  { match_key: 'm7', date: todayISO,    result: 'defeat' },
  { match_key: 'm8', date: daysAgo(7),  result: 'victory' },
]
const CORPUS = STUBS.map((s, i) => record(s, i))

test.describe('campaign-log header', () => {
  test.beforeEach(async ({ page }) => {
    // The window-months preference persists across reloads via
    // localStorage. Clear it so every test starts in the default 6M
    // state — otherwise an earlier 12M test bleeds into the next.
    await page.addInitScript(() => {
      try { localStorage.removeItem('recall.timelineWindowMonths') } catch (_) { /* ignore */ }
    })
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CORPUS) })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.leaf-row')).toHaveCount(CORPUS.length)
  })

  test('mounts the wrapper with both viz inside the Matches view', async ({ page }) => {
    const timeline = page.locator('.match-timeline')
    await expect(timeline).toBeVisible()
    await expect(timeline.locator('.match-heatmap')).toBeVisible()
    await expect(timeline.locator('.match-sparkline')).toBeVisible()
  })

  test('default 6M window → heatmap renders ~182 cells (26 weeks × 7 days)', async ({ page }) => {
    const heatmapCells = await page.locator('.heatmap-cell').count()
    // 26 weeks × 7 days = 182 cells with ±1 week slack for week-edge
    // alignment.
    expect(heatmapCells).toBeGreaterThanOrEqual(175)
    expect(heatmapCells).toBeLessThanOrEqual(189)
    // 6M is the default + the active window-btn.
    await expect(page.locator('.window-btn.active')).toHaveText('6M')
  })

  test('window picker flips to 3M and the cell count shrinks accordingly', async ({ page }) => {
    await page.locator('.window-btn', { hasText: '3M' }).click()
    await expect(page.locator('.window-btn.active')).toHaveText('3M')
    const cells = await page.locator('.heatmap-cell').count()
    // 13 weeks × 7 days = 91 cells with ±1 week slack.
    expect(cells).toBeGreaterThanOrEqual(84)
    expect(cells).toBeLessThanOrEqual(98)
  })

  test('window picker flips to 1M and the cell count shrinks accordingly', async ({ page }) => {
    await page.locator('.window-btn', { hasText: '1M' }).click()
    await expect(page.locator('.window-btn.active')).toHaveText('1M')
    const cells = await page.locator('.heatmap-cell').count()
    // 5 weeks × 7 days = 35 cells with ±1 week slack.
    expect(cells).toBeGreaterThanOrEqual(28)
    expect(cells).toBeLessThanOrEqual(42)
  })

  test('window picker flips to 12M and persists across reload', async ({ page, context }) => {
    await page.locator('.window-btn', { hasText: '12M' }).click()
    const cells = await page.locator('.heatmap-cell').count()
    // 52 × 7 = 364 ± 1 week slack.
    expect(cells).toBeGreaterThanOrEqual(357)
    expect(cells).toBeLessThanOrEqual(371)

    // The outer beforeEach's addInitScript clears the window-months
    // preference on every navigation, which would also fire on
    // `page.reload()` and break the persistence assertion this test
    // is making. Clear the init scripts for this test before
    // reloading so the actual localStorage write survives.
    await context.clearCookies()
    await page.evaluate(() => {
      // The persisted state lives in localStorage; reloading on the
      // same origin keeps it. We only need to make sure no
      // beforeEach-style clear re-runs on the upcoming nav.
    })
    // Replace any init scripts that mutate the timeline window
    // preference. `addInitScript` doesn't expose a remove API; the
    // simplest workaround is to add a counter-script that re-asserts
    // the persisted value back into place AFTER the clearing script
    // runs. They execute in registration order on every navigation.
    await page.addInitScript(() => {
      try { localStorage.setItem('recall.timelineWindowMonths', '12') } catch (_) { /* ignore */ }
    })

    await page.reload()
    await expect(page.locator('.match-timeline')).toBeVisible()
    await expect(page.locator('.window-btn.active')).toHaveText('12M')
  })

  test('heatmap cell aria-label encodes the day record (W-L + W%)', async ({ page }) => {
    const winDay = page.locator(`.heatmap-cell[data-date="${daysAgo(2)}"]`)
    await expect(winDay).toHaveAttribute('aria-label', /3 wins?, 0 losses?.*100%/)
    const lossDay = page.locator(`.heatmap-cell[data-date="${daysAgo(1)}"]`)
    await expect(lossDay).toHaveAttribute('aria-label', /0 wins?, 2 losses?.*0%/)
  })

  test('a no-match day is tagged empty in the heatmap', async ({ page }) => {
    // 6 days ago has no match in the corpus → empty cell.
    const emptyDay = page.locator(`.heatmap-cell[data-date="${daysAgo(6)}"]`)
    await expect(emptyDay).toBeVisible()
    await expect(emptyDay).toHaveAttribute('data-empty', 'true')
  })

  test('clicking a heatmap cell sets a single-day filter; clicking the active cell again clears', async ({ page }) => {
    const cell = page.locator(`.heatmap-cell[data-date="${daysAgo(2)}"]`)
    await cell.click()
    await expect(page.locator('.leaf-row')).toHaveCount(3)
    await cell.click()
    await expect(page.locator('.leaf-row')).toHaveCount(CORPUS.length)
  })

  test('Shift+click extends the date range from the anchor (Excel range)', async ({ page }) => {
    // Anchor on 2 days ago (single day → 3 matches)…
    await page.locator(`.heatmap-cell[data-date="${daysAgo(2)}"]`).click()
    await expect(page.locator('.leaf-row')).toHaveCount(3)
    // …Shift+click 1 day ago → range [2d ago .. 1d ago] = m1-m3 + m4-m5 = 5.
    await page.locator(`.heatmap-cell[data-date="${daysAgo(1)}"]`).click({ modifiers: ['Shift'] })
    await expect(page.locator('.leaf-row')).toHaveCount(5)
    await expect(page.locator('.heatmap-cell.active')).toHaveCount(2)
  })

  test('clicking an empty day resets the date filter', async ({ page }) => {
    await page.locator(`.heatmap-cell[data-date="${daysAgo(2)}"]`).click()
    await expect(page.locator('.leaf-row')).toHaveCount(3)
    // 6 days ago has no match → clicking it clears the filter (back to all).
    await page.locator(`.heatmap-cell[data-date="${daysAgo(6)}"]`).click()
    await expect(page.locator('.leaf-row')).toHaveCount(CORPUS.length)
  })

  test('the Campaign Log header Reset clears the date filter without scrolling', async ({ page }) => {
    await expect(page.locator('[data-timeline-reset]')).toHaveCount(0) // hidden when no filter
    await page.locator(`.heatmap-cell[data-date="${daysAgo(2)}"]`).click()
    await expect(page.locator('.leaf-row')).toHaveCount(3)
    await expect(page.locator('[data-timeline-reset]')).toBeVisible()
    await page.locator('[data-timeline-reset]').click()
    await expect(page.locator('.leaf-row')).toHaveCount(CORPUS.length)
    await expect(page.locator('[data-timeline-reset]')).toHaveCount(0)
  })

  test('only one heatmap cell stays active when the user clicks through different days', async ({ page }) => {
    const day1 = page.locator(`.heatmap-cell[data-date="${daysAgo(2)}"]`)
    const day2 = page.locator(`.heatmap-cell[data-date="${daysAgo(1)}"]`)

    await day1.click()
    await expect(day1).toHaveClass(/active/)
    await expect(page.locator('.heatmap-cell.active')).toHaveCount(1)

    await day2.click()
    await expect(day2).toHaveClass(/active/)
    await expect(day1).not.toHaveClass(/active/)
    await expect(page.locator('.heatmap-cell.active')).toHaveCount(1)
  })

  test('active-chip rail surfaces the date range and clears it when × is clicked', async ({ page }) => {
    // Set a date filter via the heatmap.
    await page.locator(`.heatmap-cell[data-date="${daysAgo(2)}"]`).click()
    await expect(page.locator('.heatmap-cell.active')).toHaveCount(1)
    await expect(page.locator('.leaf-row')).toHaveCount(3)

    // The active-chips rail shows a range chip; its × clears.
    const rangeChip = page.locator('.active-chip.range')
    await expect(rangeChip).toBeVisible()
    await rangeChip.locator('.chip-x').click()

    // Heatmap active state clears; the leaves list expands back.
    await expect(page.locator('.heatmap-cell.active')).toHaveCount(0)
    await expect(page.locator('.leaf-row')).toHaveCount(CORPUS.length)
  })

  // Press-drag-release across day cells to select a contiguous date range.
  async function dragDays(page: Page, fromDate: string, toDate: string) {
    const a = page.locator(`.heatmap-cell[data-date="${fromDate}"]`)
    const b = page.locator(`.heatmap-cell[data-date="${toDate}"]`)
    // The calendar sits below the fold; raw mouse coordinates must be on-screen.
    await a.scrollIntoViewIfNeeded()
    const ab = await a.boundingBox()
    const bb = await b.boundingBox()
    if (!ab || !bb) throw new Error('heatmap cell not found for drag')
    await page.mouse.move(ab.x + ab.width / 2, ab.y + ab.height / 2)
    await page.mouse.down()
    await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 12 })
    await page.mouse.up()
  }

  test('dragging across days selects the inclusive date range between them', async ({ page }) => {
    await dragDays(page, daysAgo(2), daysAgo(1))
    // [2 days ago .. 1 day ago] → m1-m3 (3 wins) + m4-m5 (2 losses) = 5 matches.
    await expect(page.locator('.leaf-row')).toHaveCount(5)
    await expect(page.locator('.heatmap-cell.active')).toHaveCount(2)
  })

  test('a diagonal drag over empty days still selects one contiguous block', async ({ page }) => {
    await dragDays(page, daysAgo(7), todayISO)
    // The whole corpus falls inside [7 days ago .. today].
    await expect(page.locator('.leaf-row')).toHaveCount(CORPUS.length)
    // Every day in the span is part of the block — including the no-match day
    // 6 days ago (it stays an empty cell but reads as selected, not a blue box).
    const gapDay = page.locator(`.heatmap-cell[data-date="${daysAgo(6)}"]`)
    await expect(gapDay).toHaveClass(/active/)
    await expect(gapDay).toHaveAttribute('data-empty', 'true')
    expect(await page.locator('.heatmap-cell.active').count()).toBeGreaterThan(3)
  })

  test('clicking an empty day cancels the active range', async ({ page }) => {
    await page.locator(`.heatmap-cell[data-date="${daysAgo(2)}"]`).click()
    await expect(page.locator('.leaf-row')).toHaveCount(3)
    // A bare click on a no-match day clears the selection.
    await page.locator(`.heatmap-cell[data-date="${daysAgo(6)}"]`).click()
    await expect(page.locator('.heatmap-cell.active')).toHaveCount(0)
    await expect(page.locator('.leaf-row')).toHaveCount(CORPUS.length)
  })

  test('the dossier Reset filter button clears the date range without opening the panel', async ({ page }) => {
    await page.locator(`.heatmap-cell[data-date="${daysAgo(2)}"]`).click()
    await expect(page.locator('.leaf-row')).toHaveCount(3)

    const reset = page.locator('[data-reset-filter]')
    await expect(reset).toBeVisible()
    await reset.click()

    await expect(page.locator('.heatmap-cell.active')).toHaveCount(0)
    await expect(page.locator('.leaf-row')).toHaveCount(CORPUS.length)
    await expect(reset).toHaveCount(0)
  })
})

// ── Month select ─────────────────────────────────────────────────────
// Clicking a MONTH label (not a day-of-week) picks that whole calendar month.
// Its own corpus + describe so the recent-day tests above stay undisturbed.
test.describe('campaign-log header — month select', () => {
  // 40 days ago is reliably a PRIOR calendar month (months are ≤31 days) and
  // well inside the default 6M window, so its month label always renders.
  const ANCHOR = daysAgo(40)
  const ANCHOR_MONTH = ANCHOR.slice(0, 7) // YYYY-MM
  const MONTH_CORPUS = [
    record({ match_key: 'a1', date: ANCHOR, result: 'victory' }, 0),
    record({ match_key: 'a2', date: ANCHOR, result: 'defeat' }, 1),
    record({ match_key: 'r1', date: daysAgo(2), result: 'victory' }, 2),
    record({ match_key: 'r2', date: todayISO, result: 'defeat' }, 3),
  ]

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.removeItem('recall.timelineWindowMonths') } catch (_) { /* ignore */ }
    })
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MONTH_CORPUS) })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.leaf-row')).toHaveCount(MONTH_CORPUS.length)
  })

  test('clicking a month label filters to that whole calendar month; clicking it again clears', async ({ page }) => {
    const monthBtn = page.locator(`.match-heatmap [data-month="${ANCHOR_MONTH}"]`)
    await expect(monthBtn).toHaveCount(1)

    await monthBtn.click()
    await expect(monthBtn).toHaveClass(/active/)
    // Only the two matches that fall in that month survive (the recent ones drop).
    await expect(page.locator('.leaf-row')).toHaveCount(2)
    await expect(page.locator('.active-chip.range')).toBeVisible()

    // Toggle the same month off → back to the full corpus.
    await monthBtn.click()
    await expect(monthBtn).not.toHaveClass(/active/)
    await expect(page.locator('.leaf-row')).toHaveCount(MONTH_CORPUS.length)
  })

  test('only month labels are pick targets — the day-of-week labels are not', async ({ page }) => {
    // Month labels carry data-month; the Mon/Wed/Fri day labels carry none.
    await expect(page.locator('.match-heatmap .month-labels [data-month]').first()).toBeVisible()
    await expect(page.locator('.match-heatmap .day-labels [data-month]')).toHaveCount(0)
  })
})
