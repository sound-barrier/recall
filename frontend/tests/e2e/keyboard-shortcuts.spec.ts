/**
 * Keyboard-shortcuts E2E.
 *
 * Exercises the user-facing contract of `useKeyboardShortcuts` +
 * `KeyboardShortcutsModal`:
 *
 *   `?`               opens the cheatsheet; `Esc` closes it.
 *   `/`               focuses the FilterRail's note-search input.
 *   `g` then `s/m/u`  navigates between views; the `g`-prefix
 *                     expires after the SEQUENCE_TIMEOUT_MS window.
 *   `j` / `k`         move card focus on the Matches view (no wrap
 *                     at ends).
 *   `e`               toggles expand on the focused card.
 *   typing `j` in an  input does NOT navigate cards (input-gating).
 *
 * Mocks `/api/v1/matches` with three seeded records so j/k/e have
 * something to navigate. Same `page.route()` pattern as
 * match-tags.spec.ts.
 */
import { test, expect, type Route } from '@playwright/test'

function record(matchKey: string, hero: string) {
  return {
    match_key:    matchKey,
    source_files: [`${matchKey}.png`],
    data: {
      map: 'rialto', mode: 'competitive', type: 'control',
      role: 'support', hero, result: 'victory',
      date: '2026-05-10', finished_at: '22:00',
      eliminations: 17, assists: 16, deaths: 11, damage: 7200,
      heroes_played: [{ hero, percent_played: 100, play_time: '11:25' }],
    },
    parsed_at: '2026-05-10T22:30:00Z',
  }
}

const RECORDS = [
  record('match:2026-05-10T22:00:00', 'lucio'),
  record('match:2026-05-10T22:15:00', 'juno'),
  record('match:2026-05-10T22:30:00', 'kiriko'),
]

async function seed(page: import('@playwright/test').Page) {
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
      body: JSON.stringify({ heroes_by_role: {}, maps_by_type: {} }),
    })
  })
}

test.describe('keyboard shortcuts — cheatsheet modal', () => {
  test('? opens the cheatsheet; Esc closes', async ({ page }) => {
    await seed(page)
    await page.goto('/')
    const sheet = page.locator('[data-testid="kbd-shortcuts-modal"]')
    await expect(sheet).toBeHidden()

    await page.keyboard.press('?')
    await expect(sheet).toBeVisible()
    await expect(sheet).toContainText(/keyboard shortcuts/i)
    await expect(sheet).toContainText('Focus the note-search input')

    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()
  })

  test('cheatsheet lists every binding group (Global + Matches + Tablist + modals)', async ({ page }) => {
    await seed(page)
    await page.goto('/')
    await page.keyboard.press('?')
    const sheet = page.locator('[data-testid="kbd-shortcuts-modal"]')
    await expect(sheet).toContainText('Global')
    await expect(sheet).toContainText('Matches view')
    await expect(sheet).toContainText('Tablist + modals')
  })
})

test.describe('keyboard shortcuts — global bindings', () => {
  test('/ focuses the note-search input', async ({ page }) => {
    await seed(page)
    await page.goto('/')
    await page.locator('#tab-matches').click()

    // Focus must not start in an input — click the masthead brand.
    await page.locator('.brand').first().click()
    await page.keyboard.press('/')
    const focusedId = await page.evaluate(() => document.activeElement?.id)
    expect(focusedId).toBe('note-search')
  })

  test('g then s switches to the Settings view', async ({ page }) => {
    await seed(page)
    await page.goto('/')
    await page.keyboard.press('g')
    await page.keyboard.press('s')
    await expect(page.locator('#tab-settings')).toHaveAttribute('aria-selected', 'true')
  })

  test('g then m switches to the Matches view', async ({ page }) => {
    await seed(page)
    await page.goto('/')
    await page.locator('#tab-settings').click()
    await expect(page.locator('#tab-settings')).toHaveAttribute('aria-selected', 'true')

    await page.keyboard.press('g')
    await page.keyboard.press('m')
    await expect(page.locator('#tab-matches')).toHaveAttribute('aria-selected', 'true')
  })

  test('g prefix expires after timeout — slow follow-up does NOT navigate', async ({ page }) => {
    await seed(page)
    await page.goto('/')
    await page.locator('#tab-matches').click()

    await page.keyboard.press('g')
    await page.waitForTimeout(1200) // SEQUENCE_TIMEOUT_MS (1000) + 200ms slack
    await page.keyboard.press('s')

    // Still on Matches — `s` alone is not a registered shortcut.
    await expect(page.locator('#tab-matches')).toHaveAttribute('aria-selected', 'true')
  })
})

test.describe('keyboard shortcuts — Matches view per-card', () => {
  test('j moves card focus through the list; no wrap at the end', async ({ page }) => {
    await seed(page)
    await page.goto('/')
    await page.locator('#tab-matches').click()

    // Click the panel surface so focus leaves the tab button.
    await page.locator('#panel-matches').click({ position: { x: 10, y: 10 } })

    // First `j` lands on card 0.
    await page.keyboard.press('j')
    await expect(page.locator('article.match[data-card-index="0"]')).toHaveAttribute('aria-current', 'true')

    // Each press advances; cap at the last card (index 2 here).
    await page.keyboard.press('j')
    await expect(page.locator('article.match[data-card-index="1"]')).toHaveAttribute('aria-current', 'true')
    await page.keyboard.press('j')
    await expect(page.locator('article.match[data-card-index="2"]')).toHaveAttribute('aria-current', 'true')
    await page.keyboard.press('j') // no-op, still on last
    await expect(page.locator('article.match[data-card-index="2"]')).toHaveAttribute('aria-current', 'true')
  })

  test('k steps backward; clamps at 0', async ({ page }) => {
    await seed(page)
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('#panel-matches').click({ position: { x: 10, y: 10 } })

    await page.keyboard.press('j') // → 0
    await page.keyboard.press('j') // → 1
    await page.keyboard.press('j') // → 2
    await page.keyboard.press('k') // → 1
    await expect(page.locator('article.match[data-card-index="1"]')).toHaveAttribute('aria-current', 'true')

    await page.keyboard.press('k') // → 0
    await page.keyboard.press('k') // clamp, stays on 0
    await expect(page.locator('article.match[data-card-index="0"]')).toHaveAttribute('aria-current', 'true')
  })

  test('e expands the focused card; e again collapses', async ({ page }) => {
    await seed(page)
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('#panel-matches').click({ position: { x: 10, y: 10 } })

    await page.keyboard.press('j')
    const card = page.locator('article.match[data-card-index="0"]')
    await expect(card).not.toHaveClass(/expanded/)

    await page.keyboard.press('e')
    await expect(card).toHaveClass(/expanded/)

    await page.keyboard.press('e')
    await expect(card).not.toHaveClass(/expanded/)
  })
})

test.describe('keyboard shortcuts — input gating', () => {
  test('j typed in the note-search input does NOT navigate cards', async ({ page }) => {
    await seed(page)
    await page.goto('/')
    await page.locator('#tab-matches').click()

    // Open the FilterRail note-search via the binding, then type `j`.
    await page.locator('.brand').first().click()
    await page.keyboard.press('/')
    await page.keyboard.type('j')

    // The input received the `j` character; no card focused.
    const value = await page.locator('#note-search').inputValue()
    expect(value).toBe('j')
    const focusedCount = await page.locator('article.match[aria-current="true"]').count()
    expect(focusedCount).toBe(0)
  })

  test('? typed in the note-search input STILL opens the cheatsheet (allowInInput)', async ({ page }) => {
    await seed(page)
    await page.goto('/')
    await page.locator('#tab-matches').click()

    await page.locator('.brand').first().click()
    await page.keyboard.press('/')
    // Now in the input.
    await page.keyboard.press('?')
    await expect(page.locator('[data-testid="kbd-shortcuts-modal"]')).toBeVisible()
  })
})
