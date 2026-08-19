/**
 * Self review — axe across the four themes, on the two surfaces the
 * reviews-index matrix cannot reach: the film room in the player's OWN
 * voice (title input, "Your matches" reel, desk with "Already said" quotes,
 * the sitting's sheet) and the shelf with a card on it (the decorative rail,
 * the armed Delete). WCAG 2.1 A/AA, zero violations, no rules silenced.
 */
import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'

import { test, expect } from '../_fixtures'
import { filmRoom } from '../_coach'
import { finishedSitting, mockSelfReviews } from '../_reviews'
import { THEMES, pinTheme, seedProfiles, settleLayout, settleView, silenceParseEvents } from '../_theme-matrix'

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
})

async function violations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  return { list: results.violations, detail: JSON.stringify(results.violations, null, 2) }
}

for (const theme of THEMES) {
  test(`a11y: the shelf with a sitting on it (${theme} theme) has no axe violations`, async ({ page }) => {
    await pinTheme(page, theme)
    await silenceParseEvents(page)
    await seedProfiles(page)
    await mockSelfReviews(page, { reviews: [finishedSitting()] })
    await page.goto('/')
    await page.getByRole('tab', { name: /^Reviews/ }).click()
    await settleView(page, 'tab-reviews')
    const card = page.getByRole('article', { name: /Tuesday's Ana games/ })
    await expect(card).toBeVisible()
    // Arm the delete so the armed state is scanned too.
    await card.getByRole('button', { name: 'Delete' }).click()
    await settleLayout(page)
    const found = await violations(page)
    expect(found.list, found.detail).toEqual([])
  })

  test(`a11y: the film room over your own matches (${theme} theme) has no axe violations`, async ({ page }) => {
    await pinTheme(page, theme)
    await silenceParseEvents(page)
    await seedProfiles(page)
    await mockSelfReviews(page, { reviews: [finishedSitting()] })
    await page.goto('/')
    await page.getByRole('tab', { name: /^Reviews/ }).click()
    await page.getByRole('article', { name: /Tuesday's Ana games/ }).getByRole('button', { name: /^Open/ }).click()
    await expect(filmRoom(page)).toBeVisible()
    await expect(filmRoom(page).getByRole('textbox', { name: 'Note' })).toBeVisible()
    await settleLayout(page)
    const found = await violations(page)
    expect(found.list, found.detail).toEqual([])
  })
}
