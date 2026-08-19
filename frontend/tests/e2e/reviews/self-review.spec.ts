/**
 * Self review — sit down with a set of your OWN matches and review them the
 * way a coach would, as a saved sitting.
 *
 * What this spec proves, through the real chain (bulk bar / shelf / room ↔
 * /api/v1/self-reviews ↔ the store ↔ the film room in SELF mode):
 *   - "Review these" on the Matches bulk bar opens a sitting over the ticked
 *     rows and lands in the film room inside the Reviews tab — your own
 *     data, so no loan slip, writes open, the reel titled for you.
 *   - notes and moments written in the room autosave to the sitting's routes;
 *     the sheet's title is editable; Finish posts /completion and returns to
 *     the shelf.
 *   - the shelf (section 01) lists sittings as cards, opens one back into the
 *     room, deletes one behind an armed confirmation, and invites action when
 *     empty.
 *   - a match carrying a self block shows "Your review" in its journal.
 */
import { test, expect } from '../_fixtures'
import type { Page } from '@playwright/test'
import { RESURFACED_NOTES, filmRoom, loanSlip, mockCoachSession, pinSessionResume } from '../_coach'
import {
  SITTING_ID, finishedSitting, mockSelfReviews,
} from '../_reviews'
import { seedProfiles, silenceParseEvents } from '../_theme-matrix'

const reviewsTab = (page: Page) => page.getByRole('tab', { name: /^Reviews/ })
const matchesTab = (page: Page) => page.getByRole('tab', { name: /^Matches/ })
const panel = (page: Page) => page.locator('#panel-reviews')
const shelf = (page: Page) => panel(page).getByRole('list', { name: 'Your own reviews' })
const sheet = (page: Page) => filmRoom(page).getByRole('complementary', { name: /review sheet/i })

async function tickFirstRows(page: Page, count: number): Promise<void> {
  await matchesTab(page).click()
  await expect(page.locator('.leaf-row').first()).toBeVisible()
  for (let i = 0; i < count; i++) {
    await page.locator('.leaf-row').nth(i).locator('.leaf-checkbox').click()
  }
}

test.describe('self review', () => {
  test.beforeEach(async ({ page }) => {
    await silenceParseEvents(page)
    await seedProfiles(page)
  })

  test('Review these opens a sitting over the ticked rows, in the room, in your own clock', async ({ page }) => {
    const mock = await mockSelfReviews(page)
    await page.goto('/')
    await tickFirstRows(page, 2)

    await page.getByRole('button', { name: /^Review these/ }).click()

    await expect(reviewsTab(page)).toHaveAttribute('aria-selected', 'true')
    await expect(filmRoom(page)).toBeVisible()
    expect(mock.created.get().match_keys).toHaveLength(2)
    // Your own data: no loan slip, and the reel is yours — nobody else's
    // clock is named anywhere in the room.
    await expect(loanSlip(page, 'Sable')).toHaveCount(0)
    await expect(filmRoom(page).getByRole('heading', { name: 'Your matches' })).toBeVisible()
    await expect(filmRoom(page).getByText(/'s clock/)).toHaveCount(0)
    // The room says what it is — the name three other surfaces send you to.
    await expect(filmRoom(page).getByText('Film room · your review')).toBeVisible()
    // The editor speaks in YOUR voice: the coach's placeholder and the
    // coach's 'Reviewed' switch have no place over your own matches.
    await expect(filmRoom(page).getByRole('textbox', { name: 'Note' }))
      .toHaveAttribute('placeholder', 'What will you do differently next time?')
    await expect(filmRoom(page).getByRole('switch', { name: 'Nothing to add' })).toBeVisible()
    // The card's clock eyebrow drops the possessive — the reel already did.
    await expect(filmRoom(page).getByText('When · your clock')).toHaveCount(0)
    // The sheet is the sitting's: a title to give it, and Finish.
    await expect(sheet(page).getByRole('textbox', { name: 'Title' })).toBeVisible()
    await expect(sheet(page).getByRole('button', { name: /^Finish review/ })).toBeVisible()
    // ONE header save, ONE status line saying so.
    await expect(sheet(page).getByText('Autosaves as you write')).toHaveCount(1)
    // And the shelf is not shown underneath the room.
    await expect(panel(page).getByRole('heading', { name: 'Your own reviews' })).toHaveCount(0)
  })

  test('notes, moments and the title autosave to the sitting; Finish returns to the shelf', async ({ page }) => {
    const mock = await mockSelfReviews(page)
    await page.goto('/')
    await tickFirstRows(page, 2)
    await page.getByRole('button', { name: /^Review these/ }).click()
    await expect(filmRoom(page)).toBeVisible()

    await sheet(page).getByRole('textbox', { name: 'Title' }).fill("Tuesday's Ana games")
    await expect.poll(() => mock.updatePut.seen()).toBe(true)
    expect(mock.updatePut.get().title).toBe("Tuesday's Ana games")

    await filmRoom(page).getByRole('textbox', { name: 'Note' }).fill('Held the choke, then chased.')
    await expect.poll(() => mock.notePut.seen()).toBe(true)
    expect(mock.notePut.get().text).toBe('Held the choke, then chased.')
    expect(mock.notePutKey.get()).toBe(mock.created.get().match_keys[0])

    await filmRoom(page).getByRole('button', { name: 'Mark a moment' }).click()
    const draft = () => filmRoom(page).getByRole('group', { name: /^New moment/ })
    await draft().getByLabel('Clock').fill('4:45')
    await draft().getByLabel('What happened').fill('peeled late')
    await expect.poll(() => mock.momentPut.seen()).toBe(true)
    expect(mock.momentPut.get().text).toBe('peeled late')

    await sheet(page).getByRole('button', { name: /^Finish review/ }).click()
    await expect.poll(() => mock.finished).toEqual([SITTING_ID])
    // Back on the shelf, the sitting is a card, finished, with its one written mark.
    await expect(shelf(page)).toBeVisible()
    const card = shelf(page).getByRole('article', { name: /Tuesday's Ana games/ })
    await expect(card).toBeVisible()
    await expect(card).toContainText(/finished/i)
    await expect(card).toContainText(/2 matches/)
  })

  test('the shelf reopens a sitting into the room and deletes one behind an armed confirmation', async ({ page }) => {
    const mock = await mockSelfReviews(page, { reviews: [finishedSitting()] })
    await page.goto('/')
    await reviewsTab(page).click()
    const card = shelf(page).getByRole('article', { name: /Tuesday's Ana games/ })
    await expect(card).toBeVisible()

    await card.getByRole('button', { name: /^Open/ }).click()
    await expect(filmRoom(page)).toBeVisible()
    await expect(sheet(page).getByRole('textbox', { name: 'Title' })).toHaveValue("Tuesday's Ana games")
    // The room hydrated the sitting's note onto its match.
    await expect(filmRoom(page).getByRole('textbox', { name: 'Note' })).toHaveValue('Held the choke, then chased.')

    // A finished sitting greets you with its state, not a repeat of the
    // primary verb: the chip sits above the actions, going back is the
    // primary, and re-finishing is the quiet edge case it is.
    await expect(sheet(page).getByText(/Finished · /)).toBeVisible()
    const refinish = sheet(page).getByRole('button', { name: 'Re-finish' })
    await expect(refinish).toHaveAttribute('title', /nothing else changes/)
    await sheet(page).getByRole('button', { name: '← Back to reviews' }).click()
    await expect(shelf(page)).toBeVisible()

    // Delete is armed: the first click asks, the second does.
    await card.getByRole('button', { name: /^Delete/ }).click()
    expect(mock.deleted).toEqual([])
    await card.getByRole('button', { name: /^Delete this review/ }).click()
    await expect.poll(() => mock.deleted).toEqual([SITTING_ID])
    await expect(card).toHaveCount(0)
    await expect(panel(page).getByText(/Nothing reviewed yet/)).toBeVisible()
  })

  test('the empty shelf invites the first sitting and points at Matches', async ({ page }) => {
    await mockSelfReviews(page)
    await page.goto('/')
    await reviewsTab(page).click()
    await expect(panel(page).getByRole('heading', { name: 'Your own reviews' })).toBeVisible()
    await expect(panel(page).getByText(/Nothing reviewed yet/)).toBeVisible()
    // "Pick matches…" walks you to the list AND says what to do there —
    // the checkbox it points at only appears on hover, so without the hint
    // the trail goes cold on arrival.
    await panel(page).getByRole('button', { name: /^Pick matches/ }).click()
    await expect(matchesTab(page)).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText(/Tick the matches you want to review/)).toBeVisible()
  })

  // The tab named for reviews can start one itself: the last session in one
  // click, without a trip through Matches.
  test('Review my last session opens a sitting over the newest session without leaving the tab', async ({ page }) => {
    const mock = await mockSelfReviews(page)
    await page.goto('/')
    await reviewsTab(page).click()
    const start = panel(page).getByRole('button', { name: /^Review my last session/ })
    // The label carries the count — the fixture's newest three games sit
    // within the session gap — so the click is informed.
    await expect(start).toContainText('(3)')
    await start.click()
    await expect(filmRoom(page)).toBeVisible()
    await expect(reviewsTab(page)).toHaveAttribute('aria-selected', 'true')
    expect(mock.created.get().match_keys).toHaveLength(3)
  })

  test('Review my last N opens a sitting over the newest N matches', async ({ page }) => {
    const mock = await mockSelfReviews(page)
    await page.goto('/')
    await reviewsTab(page).click()
    // The fixture holds six matches; the trailing session is three, so the
    // wider start offers all six.
    await panel(page).getByRole('button', { name: /^Review my last 6/ }).click()
    await expect(filmRoom(page)).toBeVisible()
    expect(mock.created.get().match_keys).toHaveLength(6)
  })

  // The bulk button says what it will do — one match or N — sits with the
  // constructive actions (left of Hide), and spends the selection it acts
  // on: a second press must not mint a twin.
  test('Review these is count-aware, clears the selection, and reopens the identical unfinished sitting', async ({ page }) => {
    const mock = await mockSelfReviews(page)
    await page.goto('/')
    await tickFirstRows(page, 1)
    await expect(page.getByRole('button', { name: 'Review this match' })).toBeVisible()
    await page.locator('.leaf-row').nth(1).locator('.leaf-checkbox').click()

    const bar = page.getByRole('region', { name: 'Bulk action bar' })
    const review = bar.getByRole('button', { name: 'Review these (2)' })
    // Constructive placement: Review sits before Hide in the bar.
    const order = await bar.evaluate((el) => {
      const buttons = [...el.querySelectorAll('button')].map((b) => b.textContent ?? '')
      return buttons.findIndex((t) => t.includes('Review th')) < buttons.findIndex((t) => t.includes('Hide'))
    })
    expect(order).toBe(true)
    await review.click()
    await expect(filmRoom(page)).toBeVisible()
    const firstKeys = mock.created.get().match_keys

    // Leave the room; the selection was spent — no bulk bar on return.
    await sheet(page).getByRole('button', { name: /All reviews|Back to reviews/ }).click()
    await matchesTab(page).click()
    await expect(bar).toHaveCount(0)

    // The same two rows again: the identical unfinished sitting reopens
    // instead of a twin being minted.
    await tickFirstRows(page, 2)
    await page.getByRole('button', { name: 'Review these (2)' }).click()
    await expect(filmRoom(page)).toBeVisible()
    expect(mock.reviews()).toHaveLength(1)
    expect(mock.created.get().match_keys).toEqual(firstKeys)
  })

  test('a row context menu can start a review of that one match', async ({ page }) => {
    const mock = await mockSelfReviews(page)
    await page.goto('/')
    await matchesTab(page).click()
    await expect(page.locator('.leaf-row').first()).toBeVisible()
    await page.locator('.leaf-row').first().click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Review this match' }).click()
    await expect(filmRoom(page)).toBeVisible()
    expect(mock.created.get().match_keys).toHaveLength(1)
  })

  test('the palette can start a review of the last session', async ({ page }) => {
    const mock = await mockSelfReviews(page)
    await page.goto('/')
    await matchesTab(page).click()
    await expect(page.locator('.leaf-row').first()).toBeVisible()
    await page.keyboard.press('ControlOrMeta+k')
    const palette = page.getByRole('dialog', { name: /command palette/i })
    await palette.getByRole('combobox').fill('review my last')
    await palette.getByRole('option', { name: /Review my last session/ }).click()
    await expect(filmRoom(page)).toBeVisible()
    expect(mock.created.get().match_keys).toHaveLength(3)
  })

  // Finish on a nameless sitting nudges once for a name — the shelf card
  // otherwise falls back to 'Review of <date>', which nobody finds later —
  // and the second press goes through as asked.
  test('Finish nudges once for a title, then finishes', async ({ page }) => {
    const mock = await mockSelfReviews(page)
    await page.goto('/')
    await tickFirstRows(page, 1)
    await page.getByRole('button', { name: 'Review this match' }).click()
    await expect(filmRoom(page)).toBeVisible()

    await sheet(page).getByRole('button', { name: 'Finish review' }).click()
    await expect(sheet(page).getByText(/Give it a name so you can find it later/)).toBeVisible()
    expect(mock.finished).toEqual([])

    await sheet(page).getByRole('button', { name: 'Finish review' }).click()
    await expect.poll(() => mock.finished.length).toBe(1)
  })

  test('a match carrying a self block shows "Your review" in its journal', async ({ page }) => {
    await mockSelfReviews(page, { reviews: [finishedSitting()] })
    await page.goto('/')
    await matchesTab(page).click()
    await page.locator('.leaf-row').first().click()

    const block = page.getByRole('region', { name: 'Your review' })
    await expect(block).toBeVisible()
    await expect(block).toContainText('Held the choke, then chased.')
    await expect(block).toContainText("Tuesday's Ana games")
    await expect(block).toContainText('04:45')
  })

  // The block and the sitting point at each other: the signature reopens
  // the sitting, and removing the note is ARMED — a note plus its moments
  // must not die to one stray click (the shelf card's Delete already asks).
  test('the journal block reopens its sitting, and removing a note asks first', async ({ page }) => {
    const mock = await mockSelfReviews(page, { reviews: [finishedSitting()] })
    await page.goto('/')
    await matchesTab(page).click()
    await page.locator('.leaf-row').first().click()
    const block = page.getByRole('region', { name: 'Your review' })
    await expect(block).toBeVisible()

    await block.getByRole('button', { name: 'Remove from this review' }).click()
    expect(mock.reviews()[0]!.notes).not.toEqual({})
    await block.getByRole('button', { name: 'Keep it' }).click()
    await expect(block.getByRole('button', { name: 'Remove from this review' })).toBeVisible()

    await block.getByRole('button', { name: /Tuesday's Ana games/ }).click()
    await expect(filmRoom(page)).toBeVisible()
    await expect(sheet(page).getByRole('textbox', { name: 'Title' })).toHaveValue("Tuesday's Ana games")
  })

  // The shelf card names the sitting in its own face, says its state in
  // words ('with notes', not 'noted'), shows the set it marked, and its
  // armed Delete warns in the body — the footer must not reflow under the
  // pointer between the first click and the second.
  test('the shelf card shows these matches and arms Delete without moving the footer', async ({ page }) => {
    await mockSelfReviews(page, { reviews: [finishedSitting()] })
    await page.goto('/')
    await reviewsTab(page).click()
    const card = shelf(page).getByRole('article', { name: /Tuesday's Ana games/ })
    await expect(card).toContainText('1 with notes')

    await card.getByRole('button', { name: 'Delete' }).click()
    await expect(card.getByText(/Notes and moments go with it/)).toBeVisible()
    await expect(card.getByRole('button', { name: 'Open →' })).toBeVisible()
    await card.getByRole('button', { name: 'Keep it' }).click()

    await card.getByRole('button', { name: /^Show these matches/ }).click()
    await expect(matchesTab(page)).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.leaf-row')).toHaveCount(2)
    await expect(page.getByText(/review .Tuesday's Ana games./)).toBeVisible()
  })

  test('is unavailable while a coaching session is open', async ({ page }) => {
    await mockSelfReviews(page)
    await mockCoachSession(page, { notes: RESURFACED_NOTES, active: true })
    await pinSessionResume(page)
    await page.goto('/')
    await tickFirstRows(page, 1)
    const review = page.getByRole('button', { name: /^Review th/ })
    await expect(review).toBeDisabled()
    // And the reason is the loan, not the generic session lock.
    await expect(review).toHaveAttribute('title', /on loan/)
  })
})
