/**
 * Vim-motion E2E — the keyboard additions on top of the existing
 * `g`-nav / j / k / e / t set:
 *
 *   gg / G            focus the FIRST / LAST match card.
 *   j / ArrowDown     focus the next card (arrow aliases the vim key).
 *   k / ArrowUp       focus the previous card.
 *   l / ArrowRight    open the detail panel for the focused card.
 *   h / ArrowLeft     (panel open) previous match — already covered by
 *                     keyboard-shortcuts.spec; here we assert the list
 *                     arrows alias j/k.
 *
 * Plus the Narrow-panel Tab rule: Tab from the (empty) #np-search input
 * lands on a toggle/chip, NOT the next text input.
 *
 * Mocks `/api/v1/matches` with several seeded records so the motions
 * have something to traverse. Same `page.route()` pattern as
 * keyboard-shortcuts.spec.ts.
 */
import type { Page, Route } from '@playwright/test'

import { test, expect } from './_fixtures'

function record(matchKey: string, hero: string, date: string) {
  return {
    match_key:    matchKey,
    source_files: [`${matchKey}.png`],
    data: {
      map: 'rialto', playlist: 'competitive', game_mode: 'control',
      role: 'support', hero, result: 'victory',
      date, finished_at: '22:00',
      eliminations: 17, assists: 16, deaths: 11, damage: 7200,
      heroes_played: [{ hero, percent_played: 100, play_time: '11:25' }],
    },
    parsed_at: `${date}T22:30:00Z`,
  }
}

const RECORDS = [
  record('match-2026-05-10T22-00-00', 'lucio', '2026-05-10'),
  record('match-2026-05-10T22-15-00', 'juno', '2026-05-10'),
  record('match-2026-05-10T22-30-00', 'kiriko', '2026-05-10'),
  record('match-2026-05-11T22-30-00', 'mercy', '2026-05-11'),
]

async function seed(page: Page) {
  await page.route('**/api/v1/matches', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(RECORDS),
    })
  })
  await page.route('**/api/v1/system/reference-data', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ heroes_by_role: {}, maps_by_game_mode: {} }),
    })
  })
}

// The flat index a leaf-row exposes via data-card-index, for the
// currently document.activeElement (or null when focus isn't on a row).
async function focusedCardIndex(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el || !el.classList.contains('leaf-row')) return null
    return el.getAttribute('data-card-index')
  })
}

// data-card-index of every rendered leaf-row, in DOM (rendered) order.
// data-card-index is the narrowed-set position, NOT the rendered
// position, so "first card" != index "0" under newest-first sort —
// the motions target rendered order, so the tests compare against it.
async function renderedIndices(page: Page): Promise<(string | null)[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('.leaf-row[data-card-index]')].map((r) =>
      r.getAttribute('data-card-index'),
    ),
  )
}

test.describe('vim motions — list navigation', () => {
  test('gg focuses the first card, G focuses the last', async ({ page }) => {
    await seed(page)
    await page.goto('/')
    await expect(page.locator('.leaf-row').first()).toBeVisible()
    const order = await renderedIndices(page)
    expect(order.length).toBeGreaterThan(1)

    // G → last rendered card.
    await page.keyboard.press('Shift+G')
    expect(await focusedCardIndex(page)).toBe(order[order.length - 1])

    // gg → first rendered card.
    await page.keyboard.press('g')
    await page.keyboard.press('g')
    expect(await focusedCardIndex(page)).toBe(order[0])
  })

  test('ArrowDown / ArrowUp alias j / k for card focus', async ({ page }) => {
    await seed(page)
    await page.goto('/')
    await expect(page.locator('.leaf-row').first()).toBeVisible()
    const order = await renderedIndices(page)

    await page.keyboard.press('ArrowDown')
    expect(await focusedCardIndex(page)).toBe(order[0])
    await page.keyboard.press('ArrowDown')
    expect(await focusedCardIndex(page)).toBe(order[1])
    await page.keyboard.press('ArrowUp')
    expect(await focusedCardIndex(page)).toBe(order[0])
  })

  test('l / ArrowRight opens the detail panel for the focused card', async ({ page }) => {
    await seed(page)
    await page.goto('/')
    await expect(page.locator('.leaf-row').first()).toBeVisible()
    const order = await renderedIndices(page)

    await page.keyboard.press('j')        // focus first rendered card
    expect(await focusedCardIndex(page)).toBe(order[0])
    await page.keyboard.press('l')        // drill in → detail panel
    await expect(page.locator('aside.detail-panel')).toBeVisible()
  })

  test('n / N jump between grouped sections', async ({ page }) => {
    await seed(page)
    await page.goto('/')
    // Default grouping is by day; the seed spans two dates → two sections.
    await expect(page.locator('.leaves-list .section-divider')).toHaveCount(2)

    // First leaf-row of each section, in DOM order.
    const anchors = await page.evaluate(() => {
      const list = document.querySelector('.leaves-list')
      const res: (string | null)[] = []
      let sawDivider = true
      for (const c of Array.from(list?.children ?? [])) {
        if (c.classList.contains('section-divider')) { sawDivider = true; continue }
        if (c.classList.contains('leaf-row') && c.getAttribute('data-card-index') != null) {
          if (sawDivider) { res.push(c.getAttribute('data-card-index')); sawDivider = false }
        }
      }
      return res
    })
    expect(anchors).toHaveLength(2)

    await page.keyboard.press('g')        // gg → first card (section 0 anchor)
    await page.keyboard.press('g')
    expect(await focusedCardIndex(page)).toBe(anchors[0])
    await page.keyboard.press('n')        // → next section anchor
    expect(await focusedCardIndex(page)).toBe(anchors[1])
    await page.keyboard.press('Shift+N')  // N → back to previous section anchor
    expect(await focusedCardIndex(page)).toBe(anchors[0])
  })
})

test.describe('vim motions — Narrow panel Tab rule', () => {
  test('Tab from the empty search input lands on a toggle, not a text input', async ({ page }) => {
    await seed(page)
    await page.goto('/')
    await page.locator('#tab-matches').click()
    // Park focus on a non-input first so `/` reaches the global
    // dispatcher cleanly (mirrors keyboard-shortcuts.spec).
    await page.locator('.brand').first().click()

    // `/` opens the Narrow panel + focuses #np-search.
    await page.keyboard.press('/')
    await expect(page.locator('#narrow-popover')).toBeVisible()
    await expect(page.locator('#np-search')).toBeFocused()

    // Tab from the empty search input should NOT move to another text
    // input — it should land on a toggle/button inside the panel.
    await page.keyboard.press('Tab')
    const tag = await page.evaluate(() => document.activeElement?.tagName ?? null)
    expect(tag).not.toBe('INPUT')
    // And focus must still be inside the narrow panel (no trap escape).
    const inPanel = await page.evaluate(() =>
      !!document.activeElement?.closest('#narrow-popover'),
    )
    expect(inPanel).toBe(true)
  })
})
