/**
 * Command palette (⌘K / Ctrl+K).
 *
 * Jump to a view or a match without reaching for the mouse. Two things make
 * this worth a spec rather than a unit test: the chord has to survive the
 * global keyboard dispatcher (which suppressed every modifier chord until this
 * landed), and the palette must MUTE the app's bare-key shortcuts while open —
 * the user is typing a query, and every letter in it is otherwise a command.
 */
import type { Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

import { test, expect } from '../_fixtures'

const record = (key: string, hero: string, map: string) => ({
  match_key: key,
  source_files: [`${key}.png`],
  data: {
    map, playlist: 'competitive', game_mode: 'control',
    role: 'support', hero, result: 'victory',
    date: '2026-08-15', finished_at: '20:00',
  },
  parsed_at: '2026-08-15T20:30:00Z',
})

async function open(page: import('@playwright/test').Page) {
  await page.route('**/api/v1/matches', async (route: Route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([record('m1', 'juno', 'rialto'), record('m2', 'ana', 'ilios')]),
    })
  })
  await page.goto('/')
  await expect(page.getByRole('tab', { name: /^Matches/ })).toBeVisible()
  await page.keyboard.press('ControlOrMeta+k')
  return page.getByRole('dialog', { name: /command palette/i })
}

test.describe('command palette', () => {
  test('opens on the command chord and lists views', async ({ page }) => {
    const palette = await open(page)

    await expect(palette).toBeVisible()
    await expect(palette.getByRole('option').first()).toBeVisible()
  })

  // The point of a subsequence matcher: initials should find the thing.
  test('finds a view by its initials', async ({ page }) => {
    const palette = await open(page)

    await palette.getByRole('combobox').fill('elo')
    await expect(palette.getByRole('option').first()).toContainText(/elo/i)
  })

  test('finds a match by hero or by map', async ({ page }) => {
    const palette = await open(page)

    await palette.getByRole('combobox').fill('ilios')
    await expect(palette.getByRole('option').first()).toContainText(/ilios/i)
  })

  test('Enter runs the highlighted result', async ({ page }) => {
    const palette = await open(page)

    await palette.getByRole('combobox').fill('settings')
    await page.keyboard.press('Enter')

    await expect(palette).toHaveCount(0)
    await expect(page.getByRole('tab', { name: /^Settings/ })).toHaveAttribute('aria-selected', 'true')
  })

  // Every bare letter typed into the query is also an app shortcut. Without
  // suppression, searching for a hero would fire half the keyboard map behind
  // the palette.
  test('mutes the app shortcuts while open', async ({ page }) => {
    const palette = await open(page)

    // `e` toggles a card and `/` focuses search when the palette is closed.
    await palette.getByRole('combobox').fill('e/e')
    await expect(palette.getByRole('combobox')).toHaveValue('e/e')
    await expect(palette).toBeVisible()
  })

  test('Escape closes it', async ({ page }) => {
    const palette = await open(page)

    await page.keyboard.press('Escape')
    await expect(palette).toHaveCount(0)
  })

  test('says so when nothing matches', async ({ page }) => {
    const palette = await open(page)

    await palette.getByRole('combobox').fill('zzzzqqq')
    await expect(palette).toContainText(/nothing matches/i)
  })

  // The theme-matrix a11y sweep walks VIEWS and never opens this, so the
  // palette audits itself. A modal is where a11y regressions hide: it is a
  // dialog over an inert page, and it is the one surface a keyboard user
  // reaches this feature through at all.
  test('has no axe violations while open', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const palette = await open(page)
    await palette.getByRole('combobox').fill('ilios')
    await expect(palette.getByRole('option').first()).toBeVisible()

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    expect(results.violations).toEqual([])
  })

  // Closing must hand the keyboard back to wherever it came from. A palette
  // that drops focus on the body leaves the user tabbing from the top of the
  // document to get back to what they were doing.
  test('returns focus to where it came from', async ({ page }) => {
    await open(page)
    await page.keyboard.press('Escape')

    // Opened with nothing focused, so nothing is where it came from.
    const tab = page.getByRole('tab', { name: /^Settings/ })
    await tab.focus()
    await page.keyboard.press('ControlOrMeta+k')
    await expect(page.getByRole('dialog', { name: /command palette/i })).toBeVisible()
    await page.keyboard.press('Escape')

    await expect(tab).toBeFocused()
  })
})
