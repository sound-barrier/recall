/**
 * Keyboard-shortcuts E2E.
 *
 * Exercises the user-facing contract of `useKeyboardShortcuts` +
 * `KeyboardShortcutsModal`:
 *
 *   `?`               opens the cheatsheet; `Esc` closes it.
 *   `/`               opens the Narrow panel + focuses the
 *                     `#np-search` input.
 *   `g` then `s/m/u`  navigates between views; the `g`-prefix
 *                     expires after the SEQUENCE_TIMEOUT_MS window.
 *   `j` / `k`         move card focus on the Matches view (no wrap
 *                     at ends).
 *   `e`               toggles the detail panel on the focused card.
 *   typing `j` in an  input does NOT navigate cards (input-gating).
 *
 * Mocks `/api/v1/matches` with three seeded records so j/k/e have
 * something to navigate. Same `page.route()` pattern as
 * match-tags.spec.ts.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

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
  record('match-2026-05-10T22-00-00', 'lucio'),
  record('match-2026-05-10T22-15-00', 'juno'),
  record('match-2026-05-10T22-30-00', 'kiriko'),
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
    await expect(page.locator('[data-testid="kbd-shortcuts-modal"]')).toHaveCount(0)

    await page.keyboard.press('?')
    const sheet = page.locator('[data-testid="kbd-shortcuts-modal"]')
    await expect(sheet).toBeVisible()
    await expect(sheet).toContainText(/keyboard shortcuts/i)

    await page.keyboard.press('Escape')
    await expect(page.locator('[data-testid="kbd-shortcuts-modal"]')).toHaveCount(0)
  })

  // Regression: useModalFocusTrap used to mutate `toRef(props, 'open').value`
  // directly on Esc. That writes to the prop locally but never propagates
  // back to the parent's `openCheatsheet` ref via the `@close` channel —
  // so after Esc the parent's state was stuck `true` and pressing `?`
  // again was a no-op. The mouse-click close button worked because it
  // emits `close`. Per-press toggle behaviour is the contract the test
  // pins.
  test('? then Esc reopens via ? again (no stuck-true parent state)', async ({ page }) => {
    await seed(page)
    await page.goto('/')

    // First cycle.
    await page.keyboard.press('?')
    await expect(page.locator('[data-testid="kbd-shortcuts-modal"]')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-testid="kbd-shortcuts-modal"]')).toHaveCount(0)

    // Second cycle — the bug: parent ref stayed true after Esc, so this
    // press was a no-op and the modal never reopened.
    await page.keyboard.press('?')
    await expect(page.locator('[data-testid="kbd-shortcuts-modal"]')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-testid="kbd-shortcuts-modal"]')).toHaveCount(0)

    // Third — make sure repeated cycles keep working.
    await page.keyboard.press('?')
    await expect(page.locator('[data-testid="kbd-shortcuts-modal"]')).toBeVisible()
  })
})

test.describe('keyboard shortcuts — global bindings', () => {
  test('/ opens the Narrow panel and focuses #np-search', async ({ page }) => {
    await seed(page)
    await page.goto('/')
    await page.locator('#tab-matches').click()

    // Focus must not start in an input — click the brand link.
    await page.locator('.brand').first().click()
    await page.keyboard.press('/')

    // The narrow popover opens and the search input gets focus.
    await expect(page.locator('#narrow-popover')).toBeVisible()
    await expect(page.locator('#np-search')).toBeFocused()
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

test.describe('keyboard shortcuts — Matches view per-row', () => {
  test('j moves leaf-row focus through the list; no wrap at the end', async ({ page }) => {
    await seed(page)
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.leaf-row')).toHaveCount(3)

    // Focus must not start in an input — click the brand link.
    await page.locator('.brand').first().click()

    // First `j` lands on the row at narrowedRecords[0].
    await page.keyboard.press('j')
    await expect(page.locator('.leaf-row[data-card-index="0"]')).toHaveAttribute('aria-current', 'true')

    // Each press advances; cap at the last row (index 2 here).
    await page.keyboard.press('j')
    await expect(page.locator('.leaf-row[data-card-index="1"]')).toHaveAttribute('aria-current', 'true')
    await page.keyboard.press('j')
    await expect(page.locator('.leaf-row[data-card-index="2"]')).toHaveAttribute('aria-current', 'true')
    await page.keyboard.press('j') // no-op, still on last
    await expect(page.locator('.leaf-row[data-card-index="2"]')).toHaveAttribute('aria-current', 'true')
  })

  test('k steps backward; clamps at 0', async ({ page }) => {
    await seed(page)
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('.brand').first().click()

    await page.keyboard.press('j') // → 0
    await page.keyboard.press('j') // → 1
    await page.keyboard.press('j') // → 2
    await page.keyboard.press('k') // → 1
    await expect(page.locator('.leaf-row[data-card-index="1"]')).toHaveAttribute('aria-current', 'true')

    await page.keyboard.press('k') // → 0
    await page.keyboard.press('k') // clamp, stays on 0
    await expect(page.locator('.leaf-row[data-card-index="0"]')).toHaveAttribute('aria-current', 'true')
  })

  // Regression: j/k previously walked narrowedRecords order, which
  // only matched the visible list when Sort=Newest. Flipping Sort
  // to Oldest left the rendered order ascending by date but j still
  // advanced through data-card-index 0 → 1 → 2 (which is the
  // chronologically-newest-first sequence). Item 18 swapped to a
  // DOM-order walk so the FIRST rendered row gets focus regardless
  // of sort. Pinned here.
  test('j respects Sort=Oldest (focus follows rendered order, not narrowedRecords order)', async ({ page }) => {
    await seed(page)
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.leaf-row')).toHaveCount(3)

    // Open the narrow panel and flip Sort=Oldest. The button lives
    // inside the narrow popover (the rail trigger is the dossier
    // header chip).
    await page.locator('.seg-btn').filter({ hasText: /Oldest/i }).click()

    // The first rendered leaf-row is now the oldest match
    // (data-card-index="2" — narrowedRecords is date-desc, the row
    // at slot 2 is the earliest). Press j; aria-current MUST land
    // on the row the user sees as "first".
    await page.locator('.brand').first().click()
    await page.keyboard.press('j')

    // First rendered .leaf-row carries aria-current.
    const firstRendered = page.locator('.leaf-row').first()
    await expect(firstRendered).toHaveAttribute('aria-current', 'true')
  })

  test('e opens the detail panel for the focused row; e again closes it', async ({ page }) => {
    await seed(page)
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('.brand').first().click()

    await page.keyboard.press('j')
    await expect(page.locator('aside.detail-panel')).toHaveCount(0)

    await page.keyboard.press('e')
    await expect(page.locator('aside.detail-panel')).toBeVisible()

    // Pressing e again while the panel is open closes it (via the
    // selection.close() branch in App.vue's e handler).
    await page.keyboard.press('e')
    await expect(page.locator('aside.detail-panel')).toHaveCount(0)
  })
})

test.describe('keyboard shortcuts — input gating', () => {
  test('j typed in the np-search input does NOT navigate rows', async ({ page }) => {
    await seed(page)
    await page.goto('/')
    await page.locator('#tab-matches').click()

    // Open the narrow panel + focus the search via the / binding,
    // then type `j`.
    await page.locator('.brand').first().click()
    await page.keyboard.press('/')
    await expect(page.locator('#np-search')).toBeFocused()
    await page.keyboard.type('j')

    // The input received the `j` character; no row got aria-current.
    const value = await page.locator('#np-search').inputValue()
    expect(value).toBe('j')
    const focusedRows = await page.locator('.leaf-row[aria-current="true"]').count()
    expect(focusedRows).toBe(0)
  })

  test('? typed in the np-search input STILL opens the cheatsheet (allowInInput)', async ({ page }) => {
    await seed(page)
    await page.goto('/')
    await page.locator('#tab-matches').click()

    await page.locator('.brand').first().click()
    await page.keyboard.press('/')
    await expect(page.locator('#np-search')).toBeFocused()
    // Inside the input — `?` should still pop the cheatsheet.
    await page.keyboard.press('?')
    await expect(page.locator('[data-testid="kbd-shortcuts-modal"]')).toBeVisible()
  })
})
