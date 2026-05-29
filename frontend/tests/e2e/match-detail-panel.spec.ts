/**
 * Detail-panel keyboard ergonomics E2E.
 *
 * Drives the post-eval keybindings from the user's review:
 *
 *   ← / → → previous / next match (timeline metaphor)
 *   ↑ / ↓ → scroll panel body, NOT the page behind
 *   /     → focuses the match-search input; while the panel is open
 *           AND the search has any clauses, the panel selection
 *           tracks the first hit as the user types
 *   Enter in search (panel closed) → opens first hit in the panel
 */
import { test, expect } from './_fixtures'
import type { Route } from '@playwright/test'

function record(matchKey: string, opts: { note?: string; result?: string; finishedAt?: string } = {}) {
  return {
    match_key: matchKey,
    source_files: [`${matchKey}.png`],
    source_types: { [`${matchKey}.png`]: 'summary' },
    data: {
      map: 'rialto', mode: 'competitive', type: 'control', role: 'support', hero: 'lucio',
      result: opts.result ?? 'victory',
      date: '2026-05-10', finished_at: opts.finishedAt ?? '22:00',
      eliminations: 17, assists: 16, deaths: 11, damage: 7200,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '11:25' }],
    },
    parsed_at: `2026-05-10T${(opts.finishedAt ?? '22:30').slice(0, 2)}:30:00Z`,
    ...(opts.note ? { annotation: { note: opts.note } } : {}),
  }
}

// All on the same day so the Month→Week→Day grouping keeps every
// card visible; finished_at orders them within the day.
const CORPUS = [
  record('m1', { note: 'huge clutch second point', finishedAt: '22:00' }),
  record('m2', { result: 'defeat', finishedAt: '21:00' }),
  record('m3', { result: 'draw',   finishedAt: '20:00' }),
]

test.describe('match detail panel — keyboard ergonomics', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CORPUS) })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.match')).toHaveCount(3)
  })

  test('→ paginates to the next match; ← to the previous', async ({ page }) => {
    await page.locator('.match').first().locator('.chev-btn').click()
    await expect(page.locator('aside.detail-panel')).toBeVisible()
    // Position chip starts at "1 of 3" because newest-first sort puts
    // m1 (May 10) at the top.
    await expect(page.locator('.detail-pos strong')).toHaveText('1')

    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.detail-pos strong')).toHaveText('2')

    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.detail-pos strong')).toHaveText('3')

    // At the end, → is a no-op.
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.detail-pos strong')).toHaveText('3')

    await page.keyboard.press('ArrowLeft')
    await expect(page.locator('.detail-pos strong')).toHaveText('2')
  })

  test('↑ / ↓ scrolls the panel body, the page behind stays put', async ({ page }) => {
    await page.locator('.match').first().locator('.chev-btn').click()
    await expect(page.locator('aside.detail-panel')).toBeVisible()

    const initialWindowScroll = await page.evaluate(() => window.scrollY)

    // ↓ a few times — the panel body should scroll, not the window.
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('ArrowDown')
    }

    const afterWindowScroll = await page.evaluate(() => window.scrollY)
    expect(afterWindowScroll).toBe(initialWindowScroll)

    // Panel body scrolled — pin via the inner scroll position.
    const panelScroll = await page.evaluate(() => {
      const el = document.querySelector('.detail-body')
      return el ? (el as HTMLElement).scrollTop : -1
    })
    expect(panelScroll).toBeGreaterThan(0)
  })

  test('typing in search while panel is open jumps the panel to the first hit', async ({ page }) => {
    // Open the panel on m2 (defeat, no annotation).
    await page.locator('.match').nth(1).locator('.chev-btn').click()
    await expect(page.locator('aside.detail-panel')).toBeVisible()
    // Sanity-check that defeat result chip shows.
    await expect(page.locator('.detail-title-result')).toContainText(/defeat/i)

    // Now type a search that uniquely matches m1.
    await page.keyboard.press('/')
    await page.keyboard.type('clutch')
    // Panel content should follow — m1 is the only hit.
    await expect(page.locator('.detail-title-result')).toContainText(/victory/i)
  })

  test('Enter in match-search (panel closed) opens the first hit', async ({ page }) => {
    await expect(page.locator('aside.detail-panel')).toHaveCount(0)
    await page.keyboard.press('/')
    await page.keyboard.type('clutch')
    await page.keyboard.press('Enter')
    await expect(page.locator('aside.detail-panel')).toBeVisible()
    await expect(page.locator('.detail-title-result')).toContainText(/victory/i)
  })
})
