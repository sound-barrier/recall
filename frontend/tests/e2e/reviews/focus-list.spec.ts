/**
 * "What you're working on" — the focus list, end to end.
 *
 * The list is the point of the whole review cycle: a sitting or a coach's
 * archive produces items, and this band is where the player meets them.
 * What the specs pin is the part no unit test can: GET /api/v1/focus →
 * the band, and the two moves back out as PUT /focus/{id}/status.
 *
 * The move that ISN'T here is the one that matters most. There is no deny
 * and no delete: an item a coach sent is live the moment it lands, so the
 * player's choice is when to say they have read it — not whether to let it
 * in. A player can disagree with their coach; they still have to hear it.
 */
import { type Page } from '@playwright/test'

import { test, expect } from '../_fixtures'
import { seedCoachOwnMatches } from '../_coach'
import { finishedSitting, mockFocus, mockSelfReviews, type FocusEntryWire } from '../_reviews'
import { seedProfiles, silenceParseEvents } from '../_theme-matrix'

const tab = (page: Page) => page.getByRole('tab', { name: /^Reviews/ })
const band = (page: Page) => page.getByRole('region', { name: "What you're working on" })

const FROM_COACH: FocusEntryWire = {
  item_id: 'c0000000-0000-4000-8000-000000000001',
  text: 'Hold the high ground until the second bubble.',
  status: 'new', source: 'coach', coach_name: 'Ordo', from: '2026-05-09',
}
const FROM_SELF: FocusEntryWire = {
  item_id: 'c0000000-0000-4000-8000-000000000002',
  text: 'Ult economy on control.',
  status: 'working', source: 'self', from: '2026-05-10',
}

async function openTab(page: Page): Promise<void> {
  await page.goto('/')
  await tab(page).click()
  await expect(page.locator('#panel-reviews')).toBeVisible()
}

test.describe("07 Reviews — what you're working on", () => {
  test.beforeEach(async ({ page }) => {
    await silenceParseEvents(page)
    await seedProfiles(page)
    await seedCoachOwnMatches(page)
  })

  test('reads the list off the server and says where each item came from', async ({ page }) => {
    await mockFocus(page, [FROM_COACH, FROM_SELF])
    await openTab(page)

    const rows = band(page).getByRole('listitem')
    await expect(rows).toHaveCount(2)
    // The server hands the order — coach first — and the band must not
    // re-sort it, or the band and the live readout disagree.
    await expect(rows.nth(0)).toContainText('Hold the high ground')
    await expect(rows.nth(0)).toContainText('Ordo')
    await expect(rows.nth(1)).toContainText('Ult economy on control')
    await expect(rows.nth(1)).toContainText('you')
  })

  test('invites you to start when the list is empty', async ({ page }) => {
    await mockFocus(page, [])
    await openTab(page)
    await expect(band(page)).toContainText(/Finish a review, or open a coach's notes/)
  })

  test('Accept acknowledges a coach item and the row stops saying new', async ({ page }) => {
    const focus = await mockFocus(page, [FROM_COACH])
    await openTab(page)

    const row = band(page).getByRole('listitem').first()
    await expect(row).toContainText('new')
    await row.getByRole('button', { name: 'Accept' }).click()

    await expect.poll(() => focus.moves).toEqual([
      { itemID: FROM_COACH.item_id, status: 'working' },
    ])
    // The band refetches, so the acknowledged row loses both its badge and
    // its Accept without a reload.
    await expect(row).not.toContainText('new')
    await expect(row.getByRole('button', { name: 'Accept' })).toHaveCount(0)
  })

  test('an item you wrote yourself is never offered an Accept', async ({ page }) => {
    await mockFocus(page, [FROM_SELF])
    await openTab(page)
    await expect(band(page).getByRole('button', { name: 'Accept' })).toHaveCount(0)
    await expect(band(page).getByRole('button', { name: 'Got this' })).toBeVisible()
  })

  // There is no deny. Nothing on this band refuses an item a coach sent.
  test('offers no way to refuse what a coach sent', async ({ page }) => {
    await mockFocus(page, [FROM_COACH])
    await openTab(page)
    await expect(
      band(page).getByRole('button', { name: /deny|reject|skip|dismiss|delete|remove/i }),
    ).toHaveCount(0)
  })

  test('"Got this" retires an item behind a count rather than deleting it', async ({ page }) => {
    const focus = await mockFocus(page, [FROM_COACH, FROM_SELF])
    await openTab(page)

    await band(page).getByRole('listitem').nth(1)
      .getByRole('button', { name: 'Got this' }).click()

    await expect.poll(() => focus.moves).toEqual([
      { itemID: FROM_SELF.item_id, status: 'done' },
    ])
    // Off the live list, still on the record.
    await expect(band(page).getByText('Ult economy on control.')).toHaveCount(0)
    const toggle = band(page).getByRole('button', { name: "Show 1 you've got" })
    await expect(toggle).toBeVisible()
    await toggle.click()
    await expect(band(page).getByText('Ult economy on control.')).toBeVisible()
  })

  test('a sitting writes its list through PUT /self-reviews/{id}/focus-items', async ({ page }) => {
    await mockFocus(page, [])
    const reviews = await mockSelfReviews(page, { reviews: [finishedSitting()] })
    await openTab(page)

    await page.getByRole('article', { name: /Tuesday's Ana games/ })
      .getByRole('button', { name: /^Open/ }).click()
    await page.getByRole('button', { name: '+ Add an item' }).click()
    await page.getByRole('textbox', { name: 'What to work on, item 1' })
      .fill('Stop chasing flanks')

    await expect.poll(() => reviews.focusPut.seen()).toBe(true)
    const sent = reviews.focusPut.get().items
    expect(sent).toHaveLength(1)
    expect(sent[0]?.text).toBe('Stop chasing flanks')
  })
})
