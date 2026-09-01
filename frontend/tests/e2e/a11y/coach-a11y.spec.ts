/**
 * Accessibility audits via axe-core for the coaching surfaces — every
 * THEME × the Film Room, the in-session Matches view (loan slip + session
 * rule over the ordinary chrome), and the player's return sheet.
 *
 * The room is paper-on-surface: a new token family (`--paper*`, `--ink*`)
 * that has to clear AA on cream (Day) and on black (high contrast) as well
 * as the two dark themes — the exact place a palette bug hides when only
 * one theme is looked at. Same tags + baseline policy as a11y.spec.ts:
 * zero violations, no rules silenced.
 */
import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'

import { test, expect } from '../_fixtures'
import {
  COACH_NAME,
  RETURN_SHEET_FIXTURE,
  loanSlip,
  mockInbox,
  openCoachRoom,
  seedPlayerHistory,
} from '../_coach'
import { THEMES, pinTheme, seedProfiles, settleLayout, settleView, silenceParseEvents } from '../_theme-matrix'

// Reduced motion for every audit — see a11y.spec.ts for why
// page.emulateMedia() is the only lever that takes.
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
})

async function runAx(page: Page) {
  return new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
}

/** axe's violation list, pretty-printed as the assertion message when it isn't empty. */
async function violations(page: Page) {
  const results = await runAx(page)
  return { list: results.violations, detail: JSON.stringify(results.violations, null, 2) }
}

for (const theme of THEMES) {
  test(`a11y: film room (${theme} theme) has no axe violations`, async ({ page }) => {
    await openCoachRoom(page, theme)
    const found = await violations(page)
    expect(found.list, found.detail).toEqual([])
  })

  // The coach's note expanded. It teleports to <body>, which leaves `.paper`
  // behind — the writer carries the class itself so the ink palette travels,
  // and this is what proves the traveled version still reads. The journal's
  // expanded writer is scanned in a11y.spec.ts; that one is `surface="plain"`
  // and exercises none of the paper tokens.
  test(`a11y: expanded coach note on paper (${theme} theme) has no axe violations`, async ({ page }) => {
    await openCoachRoom(page, theme)
    await page.getByRole('button', { name: /^Expand / }).first().click()
    await expect(page.getByRole('dialog')).toBeVisible()
    const found = await violations(page)
    expect(found.list, found.detail).toEqual([])
  })

  test(`a11y: in-session Matches with the loan slip (${theme} theme) has no axe violations`, async ({ page }) => {
    await openCoachRoom(page, theme)
    await page.getByRole('tab', { name: /^Matches/ }).click()
    await expect(loanSlip(page)).toBeVisible()
    await expect(page.locator('[data-coach-session-rule]')).toBeVisible()
    await settleView(page, 'tab-matches')
    await settleLayout(page)
    const found = await violations(page)
    expect(found.list, found.detail).toEqual([])
  })

  test(`a11y: return sheet (${theme} theme) has no axe violations`, async ({ page }) => {
    await pinTheme(page, theme)
    await silenceParseEvents(page)
    await seedProfiles(page)
    await seedPlayerHistory(page)
    await mockInbox(page, [{ ...RETURN_SHEET_FIXTURE, decisions: {} }])
    await page.goto('/')
    await settleView(page, 'tab-matches')

    const banner = page.getByRole('status').filter({ hasText: new RegExp(`from ${COACH_NAME} waiting`) })
    await banner.getByRole('button', { name: 'Read the notes' }).click()
    const dialog = page.getByRole('dialog', { name: new RegExp(`Notes from ${COACH_NAME}`) })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('radiogroup')).toHaveCount(RETURN_SHEET_FIXTURE.notes.length)
    await settleLayout(page)
    const found = await violations(page)
    expect(found.list, found.detail).toEqual([])
  })
}
