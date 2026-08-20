/**
 * 07 Reviews — the home of the review cycle.
 *
 * Coaching had every entry point except a place: a profile-menu item, a
 * bulk-bar modal toggle, two "Import…" buttons, a keyboard chord and a
 * banner. This tab is where reviewing lives — your own, a coach's, and
 * coaching someone else — and the Film Room now renders INSIDE it rather
 * than as a view outside the tablist.
 *
 * What this spec proves: the tab exists as the seventh, is reachable every
 * way a tab is (click, `g r`, End on the tablist), its index shows the two
 * sections that need no data (from a coach · for someone else), and while a
 * coaching session is open the tab shows the room, not the index.
 */
import { test, expect } from '../_fixtures'
import {
  COACH_NAME,
  RESURFACED_NOTES,
  RETURN_SHEET_FIXTURE,
  filmRoom,
  loanSlip,
  mockCoachSession,
  mockInbox,
  mockMatchesWithCoachNotes,
  pinSessionResume,
  seedCoachOwnMatches,
} from '../_coach'
import { seedProfiles, silenceParseEvents } from '../_theme-matrix'

// Anchored: the tab's accessible name grows a suffix when coach notes are
// waiting ("Reviews 3"), the way Unknown's grows a count and Matches' a dot.
const tab = (page: import('@playwright/test').Page) => page.getByRole('tab', { name: /^Reviews/ })
const panel = (page: import('@playwright/test').Page) => page.locator('#panel-reviews')

test.describe('07 Reviews — the tab', () => {
  test.beforeEach(async ({ page }) => {
    await silenceParseEvents(page)
    await seedProfiles(page)
    await seedCoachOwnMatches(page)
  })

  test('is the seventh tab, numbered, and reachable by click', async ({ page }) => {
    await page.goto('/')
    await expect(tab(page)).toBeVisible()
    await tab(page).click()
    await expect(tab(page)).toHaveAttribute('aria-selected', 'true')
    await expect(panel(page)).toBeVisible()
    // The number is derived from the tab's position, so it reads 07 by
    // being seventh, not by being typed.
    await expect(tab(page)).toContainText('07')
  })

  test('is where End on the tablist lands', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('tab', { name: 'Settings' }).click()
    await page.getByRole('tab', { name: 'Settings' }).press('End')
    await expect(tab(page)).toHaveAttribute('aria-selected', 'true')
  })

  test('answers g r from anywhere', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('tab', { name: /^Matches/ }).click()
    await page.keyboard.press('g')
    await page.keyboard.press('r')
    await expect(tab(page)).toHaveAttribute('aria-selected', 'true')
  })

  test('shows the coaching sections with their actions before any data exists', async ({ page }) => {
    await page.goto('/')
    await tab(page).click()
    // The page is named for what it holds — every review, in all three
    // directions — not for one section's question.
    await expect(panel(page).getByRole('heading', { name: 'Your reviews' })).toBeVisible()
    // Sections are numbered because they are an arc: you → a coach → someone
    // else. Each carries its action whether or not it is empty.
    await expect(panel(page).getByRole('heading', { name: 'From a coach' })).toBeVisible()
    await expect(panel(page).getByRole('button', { name: /share with a coach/i })).toBeVisible()
    // The other way notes arrive is permanent, not a hint that deletes
    // itself after the first review.
    await expect(panel(page).getByRole('button', { name: /open a notes file/i })).toBeVisible()
    await expect(panel(page).getByRole('heading', { name: 'For someone else' })).toBeVisible()
    await expect(panel(page).getByRole('button', { name: /open a player.s bundle/i })).toBeVisible()
    // 03 says what its emptiness means, like its siblings.
    await expect(panel(page).getByText(/No one has sent you a bundle yet/)).toBeVisible()
  })

  // Sharing is called what the dialog calls it, and the button carries the
  // live count of what would be shared — the set is decided on Matches, and
  // a player who has not looked deserves to know how big it is BEFORE the
  // dialog. It lands on Matches (the narrow the dialog counts is only
  // visible there) and the dialog opens ALREADY in share mode — the same
  // one action the palette runs, so neither can drift.
  test('Share with a coach carries the live count and lands on Matches with the share dialog open', async ({ page }) => {
    await page.goto('/')
    await tab(page).click()
    const share = panel(page).getByRole('button', { name: /share with a coach/i })
    await expect(share).toContainText('(2 showing on Matches)')
    await share.click()

    await expect(page.getByRole('tab', { name: /^Matches/ })).toHaveAttribute('aria-selected', 'true')
    const dialog = page.getByRole('dialog', { name: 'Share with a coach' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('checkbox', { name: /Share with a coach/ })).toBeChecked()
    await expect(dialog.getByLabel('Your handle (required)')).toBeVisible()

    // A coach reviews by WATCHING the replay: the fixture's matches carry
    // no replay codes, so the share refuses with the reason and the
    // matches that need one. (Self reviews never need a code — nothing is
    // watched remotely there.)
    await dialog.getByLabel('Your handle (required)').fill('Sable')
    await expect(dialog.getByTestId('export-submit')).toBeDisabled()
    await expect(dialog.getByText(/no replay code/)).toBeVisible()
  })

  // Notes waiting on a decision are the shelf's own rows here — one per
  // sheet, the banner's shape and button — and the app-chrome banner steps
  // aside on this tab so the same sentence is not announced twice.
  test('lists notes waiting on a decision as rows, and the chrome banner steps aside', async ({ page }) => {
    await mockInbox(page, [{ ...RETURN_SHEET_FIXTURE, decisions: {} }])
    await page.goto('/')
    const banner = page.getByRole('status').filter({ hasText: new RegExp(`from ${COACH_NAME} waiting`) })
    await expect(banner).toBeVisible()

    await tab(page).click()
    await expect(banner).toHaveCount(0)
    const rows = panel(page).getByRole('list', { name: 'Notes waiting on a decision' }).getByRole('listitem')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText(`3 notes from ${COACH_NAME}`)
    // "Read the notes", not "Review" — this button opens a decision sheet,
    // and "Review…" on this tab is reserved for starting one of your own.
    await rows.first().getByRole('button', { name: 'Read the notes' }).click()
    await expect(page.getByRole('dialog', { name: new RegExp(`Notes from ${COACH_NAME}`) })).toBeVisible()
  })

  // The waiting rows are the one time-sensitive thing on the tab, so they
  // sit directly under the intro — above section 01, which may be
  // permanently empty for a player who only ever receives.
  test('waiting rows sit above section 01', async ({ page }) => {
    await mockInbox(page, [{ ...RETURN_SHEET_FIXTURE, decisions: {} }])
    await page.goto('/')
    await tab(page).click()
    const waiting = panel(page).getByRole('list', { name: 'Notes waiting on a decision' })
    await expect(waiting).toBeVisible()
    const order = await panel(page).evaluate((el) => {
      const rows = el.querySelector('[aria-label="Notes waiting on a decision"]')
      const own = el.querySelector('#sec-your-own-reviews')
      if (!rows || !own) return 'missing'
      return rows.compareDocumentPosition(own) & Node.DOCUMENT_POSITION_FOLLOWING ? 'waiting-first' : 'own-first'
    })
    expect(order).toBe('waiting-first')
  })

  // A received review is a card: the coach's name is its title, the tallies
  // its label line, and its door shows the matches it touched — a narrowed
  // Matches list, not a deep link to one match with the filters silently
  // reset under it.
  test('a received review card shows these matches as a narrowed set', async ({ page }) => {
    await mockMatchesWithCoachNotes(page)
    await page.goto('/')
    await tab(page).click()
    const card = panel(page).getByRole('list', { name: 'Reviews you have received' }).getByRole('listitem').first()
    await expect(card.getByRole('heading', { name: COACH_NAME })).toBeVisible()
    await expect(card).toContainText(/2 notes/)
    await card.getByRole('button', { name: /^Show these matches/ }).click()
    await expect(page.getByRole('tab', { name: /^Matches/ })).toHaveAttribute('aria-selected', 'true')
    // Only the review's matches are showing, and a visible strip says why —
    // with the way back out.
    await expect(page.locator('.leaf-row')).toHaveCount(2)
    await expect(page.getByText(new RegExp(`notes from ${COACH_NAME}`))).toBeVisible()
    await page.getByRole('button', { name: 'Show everything' }).click()
    await expect(page.locator('.leaf-row')).toHaveCount(6)
  })

  // Sharing used to leave no trace: the moment the file was saved, 02 read
  // exactly as before ("No coach has looked yet"). The sent ledger is the
  // receipt — and it pairs with the answer when one arrives.
  test('a sent share is listed, and pairs with the return that answers it', async ({ page }) => {
    const keys = RETURN_SHEET_FIXTURE.notes.map((n) => n.match_key)
    await page.route('**/api/v1/shares', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([
          { id: 2, handle: 'Sable', message: '', exported_at: '2026-08-18T20:00:00Z', match_keys: ['some-other-key'] },
          { id: 1, handle: 'Sable', message: 'watch my ults', exported_at: '2026-08-14T20:00:00Z', match_keys: keys },
        ]),
      })
    })
    await mockInbox(page, [{ ...RETURN_SHEET_FIXTURE, decisions: {} }])
    await page.goto('/')
    await tab(page).click()

    const sentRows = panel(page).getByRole('list', { name: 'Matches you have sent out' }).getByRole('listitem')
    await expect(sentRows).toHaveCount(2)
    // Newest first: the unanswered one still says so.
    await expect(sentRows.nth(0)).toContainText(/Sent 1 match ·/)
    await expect(sentRows.nth(0)).toContainText(/nothing back yet/)
    // The older one overlaps the return sheet's matches — answered.
    await expect(sentRows.nth(1)).toContainText(/Sent 3 matches ·/)
    await expect(sentRows.nth(1)).toContainText(new RegExp(`answered by ${COACH_NAME}`))
  })

  // The coach's summary — the one thing they wrote about the whole set —
  // used to be readable exactly once: while a note was still undecided.
  // Now it lives on the received card, and the notes reopen from there.
  test('a received card carries the coach summary and reopens the notes', async ({ page }) => {
    await mockMatchesWithCoachNotes(page)
    const decided = Object.fromEntries(RETURN_SHEET_FIXTURE.notes.map((n) => [n.note_id, 'accepted' as const]))
    await mockInbox(page, [{ ...RETURN_SHEET_FIXTURE, decisions: decided }])
    await page.goto('/')
    await tab(page).click()

    const card = panel(page).getByRole('list', { name: 'Reviews you have received' }).getByRole('listitem').first()
    await expect(card).toContainText(/Ult economy first, positioning second/)
    await card.getByRole('button', { name: 'Read the notes again' }).click()
    await expect(page.getByRole('dialog', { name: new RegExp(`Notes from ${COACH_NAME}`) })).toBeVisible()
  })

  // A review the player skipped landed nowhere — but it still happened, and
  // 'No coach has looked yet' would be a lie. It stays listed, quietly.
  test('a fully skipped review stays listed and can be read again', async ({ page }) => {
    const decided = Object.fromEntries(RETURN_SHEET_FIXTURE.notes.map((n) => [n.note_id, 'skipped' as const]))
    await mockInbox(page, [{ ...RETURN_SHEET_FIXTURE, decisions: decided }])
    await page.goto('/')
    await tab(page).click()

    await expect(panel(page).getByText(/No coach has looked yet/)).toHaveCount(0)
    const row = panel(page).getByText(/None of these notes are on your matches/)
    await expect(row).toBeVisible()
    await panel(page).getByRole('button', { name: 'Read again' }).click()
    await expect(page.getByRole('dialog', { name: new RegExp(`Notes from ${COACH_NAME}`) })).toBeVisible()
  })

  // 03 used to list nothing — a coach's proof of work vanished with each
  // session even though the notes persist. The roster is that proof.
  test('03 lists the players this user has coached', async ({ page }) => {
    await page.route('**/api/v1/coach/players', async (route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([
          { id: 2, handle: 'Sable', note_count: 12, last_note_at: '2026-08-14T20:00:00Z', summary: 'Ult economy first.' },
          { id: 1, handle: 'Kestrel', note_count: 3, last_note_at: '2026-07-01T20:00:00Z' },
        ]),
      })
    })
    await page.goto('/')
    await tab(page).click()

    const rows = panel(page).getByRole('list', { name: 'Players you have coached' }).getByRole('listitem')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText(/Sable/)
    await expect(rows.nth(0)).toContainText(/12 notes/)
    await expect(rows.nth(0)).toContainText(/Ult economy first/)
    await expect(rows.nth(1)).toContainText(/Kestrel/)
    // The way to resume is stated, not implied.
    await expect(panel(page).getByText(/Open their next bundle and the notes resurface/)).toBeVisible()
  })

  test('hosts the film room while a coaching session is open', async ({ page }) => {
    await mockCoachSession(page, { notes: RESURFACED_NOTES, active: true })
    await pinSessionResume(page)
    await page.goto('/')

    // A resumed session lands on the Reviews tab, and the room is inside it.
    await expect(tab(page)).toHaveAttribute('aria-selected', 'true')
    await expect(filmRoom(page)).toBeVisible()
    await expect(panel(page).locator('#film-room')).toBeVisible()
    await expect(loanSlip(page)).toBeVisible()
    // The index is not shown underneath the room.
    await expect(panel(page).getByRole('heading', { name: 'From a coach' })).toHaveCount(0)
  })
})
