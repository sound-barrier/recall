/**
 * The cue strip — a match's own timeline, on the desk.
 *
 * The reel is the session's timeline; this is one match's. A coach watching a
 * replay says several things at several times ("3:23 no off-angle, 4:13 no ult
 * tracking, 4:45 the flanking Cassidy"), and until moments existed the note
 * carried one clock, so two of those three pointed at nothing.
 *
 * What this spec holds down is the part a unit test cannot: that a moment
 * survives the round trip through the transport, that the strip reads down the
 * match no matter what order it was written in, and that the replay code
 * travels beside each one — a timestamp the reader cannot act on is trivia.
 */
import { test, expect } from '../_fixtures'
import {
  KINGS_ROW_MATCH, enterFilmRoom, filmRoom, loanSlip, mockCoachSession,
  openSessionViaReviewsTab, seedCoachOwnMatches,
} from '../_coach'
import { seedProfiles, silenceParseEvents } from '../_theme-matrix'

const strip = (page: import('@playwright/test').Page) =>
  page.getByRole('region', { name: 'Moments' })

async function openDeskOn(page: import('@playwright/test').Page, mapName: string) {
  await silenceParseEvents(page)
  await seedProfiles(page)
  await seedCoachOwnMatches(page)
  const mock = await mockCoachSession(page)
  await page.goto('/')
  await openSessionViaReviewsTab(page)
  await expect(loanSlip(page)).toBeVisible()
  await enterFilmRoom(page)
  await filmRoom(page).getByRole('button', { name: new RegExp(mapName, 'i') }).first().click()
  return mock
}

// The row is named "New moment" only until it says enough to be one; naming
// it by its time is the point of the label, so the locator is re-resolved
// after each fill rather than held across the rename.
async function markMoment(
  page: import('@playwright/test').Page, clock: string, text: string,
) {
  await strip(page).getByRole('button', { name: 'Mark a moment' }).click()
  const draft = () => strip(page).getByRole('group', { name: /^New moment/ })
  // Digits only — the field is always MM:SS, so there is no colon to type.
  await draft().getByLabel('Clock').pressSequentially(clock.replace(/\D/g, '').padStart(4, '0'))
  await draft().getByLabel('What happened').fill(text)
}

test.describe('cue strip', () => {
  test('invites the first mark when a match has none', async ({ page }) => {
    await openDeskOn(page, "king's row")

    await expect(strip(page)).toContainText(/no moments yet/i)
    await expect(strip(page).getByRole('button', { name: 'Mark a moment' })).toBeVisible()
  })

  test('keeps a marked moment', async ({ page }) => {
    const mock = await openDeskOn(page, "king's row")

    await markMoment(page, '4:45', 'Cassidy flanked behind you.')

    // In the FIELD, not printed beside it — a moment used to show its time
    // twice, side by side.
    await expect(strip(page).getByLabel('Clock').first()).toHaveValue('04:45')
    // The text lives in the row's editable field — the strip is written in, not
    // just read — so this reads its value rather than the region's text.
    await expect(
      strip(page).getByRole('group', { name: /Moment 1 of 1, at 04:45/ }).getByLabel('What happened'),
    ).toHaveValue('Cassidy flanked behind you.')
    // The write is debounced, so the transport is polled rather than assumed —
    // and it IS asserted: an optimistic strip renders the moment whether or
    // not it ever reached the server.
    await expect.poll(() => mock.momentPut.seen()).toBe(true)
    expect(mock.momentPut.get().match_clock).toBe('04:45')
    expect(mock.momentPutKey.get()).toBe(KINGS_ROW_MATCH.match_key)
  })

  // The whole reason the strip exists. Written out of order on purpose:
  // a coach scrubbing a replay does not find things in sequence.
  test('reads down the match however it was written', async ({ page }) => {
    await openDeskOn(page, "king's row")

    await markMoment(page, '4:45', 'Cassidy flanked behind you.')
    await markMoment(page, '3:23', 'No off-angle — the tank ate the pressure.')
    await markMoment(page, '10:02', 'Held the last point well.')

    // The clock lives in its FIELD now — a moment used to print it a second
    // time immediately beside it. Read the values in DOM order.
    const clocks = await strip(page).getByLabel('Clock')
      .evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value))
    expect(clocks).toEqual(['03:23', '04:45', '10:02'])
  })

  // NOT tested here: that ordering is by seconds rather than by the clock's
  // spelling. It cannot fail at this level — the field pads a single-digit
  // minute the moment it is typed, and the server pads again on save, so by
  // the time anything renders "09:00" and "10:00" sort the same either way.
  // Mutating sortMoments to a plain string compare leaves all of these green.
  // The property is real and is held by coach-moments.test.ts, which calls
  // sortMoments with the unpadded values only it can produce.

  // Recall cannot drive the game, so this is as actionable as a timestamp
  // gets: the code to paste into the replay viewer, beside the moment it
  // belongs to.
  test('carries the replay code the moment needs to be acted on', async ({ page }) => {
    await openDeskOn(page, "king's row")
    await markMoment(page, '4:45', 'Cassidy flanked behind you.')

    const row = strip(page).getByRole('group', { name: /Moment 1 of 1, at 04:45/ })
    await expect(row).toContainText('RPL45X')
    await expect(row.getByRole('button', { name: /copy replay code/i })).toBeVisible()
  })

  // A stamp past the end of the match is a typo — 45:12 on a nine-minute game.
  // It warns rather than refuses: the match length is OCR-derived and often
  // absent, so treating it as authority would reject good notes.
  test('warns when a stamp lands past the end of the match', async ({ page }) => {
    await openDeskOn(page, "king's row")

    await markMoment(page, '45:12', 'Well past the end.')

    await expect(strip(page)).toContainText(/longer than this match/i)
    await expect(strip(page).getByLabel('Clock').first()).toHaveValue('45:12')
  })

  test('refuses a clock it cannot read, and says so', async ({ page }) => {
    const mock = await openDeskOn(page, "king's row")

    await strip(page).getByRole('button', { name: 'Mark a moment' }).click()
    // 0475 is what a coach types on the way to 04:75 — seconds past 59, which
    // is not a clock. The field shows it (correcting mid-keystroke would make
    // the NEXT digit land somewhere they did not ask for) and refuses to save
    // it.
    // Type on past a legal clock into an illegal one. The field is addressed
    // directly rather than through its row, because the row is renamed the
    // moment it holds something savable — which, with digits shifting in from
    // the right, happens before the coach has finished typing.
    const clock = strip(page).getByLabel('Clock').first()
    await clock.pressSequentially('0475')

    await expect(clock).toHaveValue('04:75')
    await expect(clock).toHaveAttribute('aria-invalid', 'true')
    // And nothing was saved: a moment needs both a readable clock and
    // something to say, and this has neither.
    expect(mock.momentPut.seen()).toBe(false)
  })

  test('drops a moment the coach takes back', async ({ page }) => {
    const mock = await openDeskOn(page, "king's row")
    await markMoment(page, '4:45', 'Cassidy flanked behind you.')
    await expect.poll(() => mock.momentPut.seen()).toBe(true)

    await strip(page).getByRole('group', { name: /Moment 1 of 1, at 04:45/ })
      .getByRole('button', { name: /remove/i }).click()

    await expect(strip(page).getByTestId('moment-clock')).toHaveCount(0)
    await expect(strip(page)).toContainText(/no moments yet/i)
    // The row vanishing locally proves nothing about the server. Without this
    // the moment survives on it, comes back on the next open, and travels into
    // an archive the coach believes it left.
    await expect.poll(() => mock.momentDeletes.length).toBe(1)
  })

  // A draft the coach abandons was never stored, so there is nothing to
  // delete — asking would 404 on a row that never existed.
  test('sends no delete for a draft that was never saved', async ({ page }) => {
    const mock = await openDeskOn(page, "king's row")
    await strip(page).getByRole('button', { name: 'Mark a moment' }).click()
    await strip(page).getByRole('group', { name: /^New moment/ }).getByLabel('Clock').fill('4:45')

    await strip(page).getByRole('group', { name: /^New moment/ })
      .getByRole('button', { name: /remove/i }).click()

    await expect(strip(page).getByRole('group', { name: /^New moment/ })).toHaveCount(0)
    expect(mock.momentDeletes).toEqual([])
  })

  // A moment that WAS saved and then had its text cleared is still on the
  // server. Reading the row's current shape to decide whether to delete left
  // it stranded there — the one place the optimistic strip and the database
  // could quietly disagree forever.
  test('still deletes a saved moment whose text was cleared', async ({ page }) => {
    const mock = await openDeskOn(page, "king's row")
    await markMoment(page, '4:45', 'Cassidy flanked behind you.')
    await expect.poll(() => mock.momentPut.seen()).toBe(true)

    const row = strip(page).getByRole('group', { name: /Moment 1 of 1, at 04:45/ })
    await row.getByLabel('What happened').fill('')
    await strip(page).getByRole('group', { name: /^New moment/ })
      .getByRole('button', { name: /remove/i }).click()

    await expect.poll(() => mock.momentDeletes.length).toBe(1)
  })
})
