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

function record(matchKey: string, opts: { note?: string; result?: string; finishedAt?: string; withRank?: boolean; finalScore?: string } = {}) {
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
      final_score: opts.finalScore ?? '3-2',
      ...(opts.withRank ? { rank: 'diamond', level: '3', rank_progress: 42, change_percent: 24 } : {}),
    },
    parsed_at: `2026-05-10T${(opts.finishedAt ?? '22:30').slice(0, 2)}:30:00Z`,
    ...(opts.note ? { annotation: { note: opts.note } } : {}),
  }
}

// All on the same day so the Month→Week→Day grouping keeps every
// card visible; finished_at orders them within the day.
const CORPUS = [
  record('m1', { note: 'huge clutch second point', finishedAt: '22:00', withRank: true }),
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

  test('panel body sections appear in the documented order', async ({ page }) => {
    // m1 has rank data, an annotation, and a final score — the only
    // match in the corpus that exercises every section, so we open
    // it to compare the rendered order against the contract.
    await page.locator('.match').first().locator('.chev-btn').click()
    await expect(page.locator('aside.detail-panel')).toBeVisible()

    // Top-of-panel meta strip: date + final score. Rendered as its
    // own block right under the toolbar, NOT buried below the stats.
    await expect(page.locator('.detail-body .detail-meta-strip').first()).toBeVisible()

    // Walk the panel body and read each top-level child's selector
    // signature. We assert the ORDER of major sections:
    //   1. .detail-meta-strip  (date + final score)
    //   2. .match-journal      (note / replay / squad / tags)
    //   3. .leaver-chooser     (Leaver? scenario chips)
    //   4. .stats              (Match Stats grid)
    //   5. .rank-block         (rank — only when present)
    //   6. .heroes-played      (Heroes Played list)
    //   7. .sources-block      (Source Screenshots)
    const order = await page.evaluate(() => {
      const body = document.querySelector('.detail-body')
      if (!body) return []
      const interesting = ['detail-meta-strip', 'match-journal', 'leaver-chooser', 'stats', 'rank-block', 'heroes-played', 'sources-block']
      const out: string[] = []
      const seen = new Set<string>()
      const walker = body.querySelectorAll('*')
      for (const el of Array.from(walker)) {
        for (const cls of interesting) {
          if (el.classList.contains(cls) && !seen.has(cls)) {
            seen.add(cls)
            out.push(cls)
          }
        }
      }
      return out
    })
    expect(order).toEqual([
      'detail-meta-strip',
      'match-journal',
      'leaver-chooser',
      'stats',
      'rank-block',
      'heroes-played',
      'sources-block',
    ])

    // Stats block carries a "Match Stats" eyebrow now (it used to be
    // unlabeled). User-facing label so the section reads as a card
    // header, not a free-floating digits row.
    await expect(page.locator('.match-stats-block .block-eyebrow')).toHaveText(/match stats/i)

    // Rank block is decorated as a rare/important section. We assert
    // the marker class — a non-default visual treatment that signals
    // "this match included a rank update."
    await expect(page.locator('.rank-block.rare')).toBeVisible()
  })

  test('Heroes Played starts expanded for every match, even after a collapse on a sibling', async ({ page }) => {
    await page.locator('.match').first().locator('.chev-btn').click()
    await expect(page.locator('aside.detail-panel')).toBeVisible()

    // First match: heroes-played panel is open by default.
    const heroesItems = page.locator('.heroes-played-items')
    await expect(heroesItems).toBeVisible()
    await expect(page.locator('.heroes-played-toggle')).toHaveAttribute('aria-expanded', 'true')

    // User collapses it on this card.
    await page.locator('.heroes-played-toggle').click()
    await expect(heroesItems).toHaveCount(0)
    await expect(page.locator('.heroes-played-toggle')).toHaveAttribute('aria-expanded', 'false')

    // Paginate to the next match — the new card should auto-expand
    // the section again so the user lands on full context, not on
    // the collapsed summary they were just on.
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.detail-pos strong')).toHaveText('2')
    await expect(page.locator('.heroes-played-items')).toBeVisible()
    await expect(page.locator('.heroes-played-toggle')).toHaveAttribute('aria-expanded', 'true')
  })
})
