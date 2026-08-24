/**
 * The return of notes — the PLAYER's side of a coaching session.
 *
 * The player imports the coach's notes ZIP through the same "Import
 * matches…" affordance a bundle uses; the server sniffs the archive and
 * answers with a staged return sheet instead of merge counts. The sheet
 * opens as a dialog with one card per note; the player accepts or skips
 * each, may "Decide later" (a banner on Matches keeps nagging until every
 * note is decided — and survives a reload, because the sheet is staged
 * server-side), and Finish writes the accepted notes onto their matches as
 * a distinct coach layer they can remove again.
 *
 * A normal bundle import must still report its counts — the union
 * response has two arms and both are exercised here.
 */
import type { Page, Route } from '@playwright/test'

import { must } from '../_capture'
import { test, expect } from '../_fixtures'
import {
  COACH_NAME,
  FAKE_ZIP,
  NOTED_MATCH,
  RETURN_SHEET_FIXTURE,
  mockInbox,
  mockMatchesWithCoachNotes,
  seedPlayerHistory,
  type CoachReturnSheet,
} from '../_coach'
import { seedProfiles, silenceParseEvents } from '../_theme-matrix'

const [NOTE_WITH_TAGS, REVIEWED_ONLY, TEXT_ONLY] = RETURN_SHEET_FIXTURE.notes

const sheetDialog = (page: Page) => page.getByRole('dialog', { name: new RegExp(`Notes from ${COACH_NAME}`) })
const cards = (page: Page) => sheetDialog(page).getByRole('radiogroup')
const inboxBanner = (page: Page) => page.getByRole('status').filter({ hasText: new RegExp(`from ${COACH_NAME} waiting`) })

/** Import through Settings → Backup & Restore; the mocked POST decides what comes back. */
async function importFromSettings(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Settings' }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /import matches/i }).click()
  await (await chooser).setFiles({ name: 'recall-coach-notes-sable.zip', mimeType: 'application/zip', buffer: FAKE_ZIP })
}

/** Stage the return sheet on import: the POST answers with it AND it lands in the inbox. */
async function mockNotesImport(page: Page, inbox: CoachReturnSheet[]): Promise<void> {
  await page.route('**/api/v1/imports', async (route: Route) => {
    const sheet: CoachReturnSheet = { ...RETURN_SHEET_FIXTURE, decisions: {} }
    inbox.push(sheet)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ kind: 'coach_notes', return: sheet }),
    })
  })
}

test.describe('return of notes — player side', () => {
  test.beforeEach(async ({ page }) => {
    await silenceParseEvents(page)
    await seedProfiles(page)
    await seedPlayerHistory(page)
  })

  test('import → decide → banner survives reload → finish → coach layer on the match → remove', async ({ page }) => {
    const inbox: CoachReturnSheet[] = []
    const returns = await mockInbox(page, inbox)
    await mockNotesImport(page, inbox)
    await page.goto('/')

    // The import opens the sheet — three cards, nothing decided.
    await importFromSettings(page)
    await expect(sheetDialog(page)).toBeVisible()
    await expect(cards(page)).toHaveCount(3)
    await expect(sheetDialog(page).getByText(must(NOTE_WITH_TAGS, 'note 1').text)).toBeVisible()
    await expect(sheetDialog(page).getByText(must(TEXT_ONLY, 'note 3').text)).toBeVisible()

    // Accept one, skip one, leave one — and put it off.
    await cards(page).nth(0).getByRole('radio', { name: 'Accept' }).click()
    await cards(page).nth(1).getByRole('radio', { name: 'Skip' }).click()
    await sheetDialog(page).getByRole('button', { name: 'Decide later' }).click()
    await expect(sheetDialog(page)).toBeHidden()

    await expect.poll(() => returns.decisionsPut.seen()).toBe(true)
    expect(returns.decisionsPut.get()).toEqual({
      decisions: {
        [must(NOTE_WITH_TAGS, 'note 1').note_id]: 'accepted',
        [must(REVIEWED_ONLY, 'note 2').note_id]: 'skipped',
      },
    })

    // One note still waits — Matches says so, and keeps saying so after a reload.
    await page.getByRole('tab', { name: /^Matches/ }).click()
    await expect(inboxBanner(page)).toContainText(`1 note from ${COACH_NAME} waiting`)
    await page.reload()
    await page.getByRole('tab', { name: /^Matches/ }).click()
    await expect(inboxBanner(page)).toContainText(`1 note from ${COACH_NAME} waiting`)

    // Review reopens with the earlier decisions intact.
    await inboxBanner(page).getByRole('button', { name: 'Read the notes' }).click()
    await expect(sheetDialog(page)).toBeVisible()
    await expect(cards(page).nth(0).getByRole('radio', { name: 'Accept' })).toHaveAttribute('aria-checked', 'true')
    await expect(cards(page).nth(1).getByRole('radio', { name: 'Skip' })).toHaveAttribute('aria-checked', 'true')
    await expect(cards(page).nth(2).getByRole('radio', { name: 'Accept' })).toHaveAttribute('aria-checked', 'false')
    await expect(cards(page).nth(2).getByRole('radio', { name: 'Skip' })).toHaveAttribute('aria-checked', 'false')

    // Accept all → Finish saves three; the banner is done.
    const layered = await mockMatchesWithCoachNotes(page)
    await sheetDialog(page).getByRole('button', { name: 'Accept all notes' }).click()
    await sheetDialog(page).getByRole('button', { name: /^Finish · 3 accepted/ }).click()
    await expect(sheetDialog(page)).toBeHidden()
    await expect.poll(() => returns.putCount()).toBe(2)
    expect(returns.decisionsPut.get()).toEqual({
      decisions: {
        [must(NOTE_WITH_TAGS, 'note 1').note_id]: 'accepted',
        [must(REVIEWED_ONLY, 'note 2').note_id]: 'accepted',
        [must(TEXT_ONLY, 'note 3').note_id]: 'accepted',
      },
    })
    await expect(inboxBanner(page)).toHaveCount(0)

    // The accepted note is a coach layer on the match — attributed, marked
    // reviewed-by-coach, and removable.
    await page.locator('.leaf-row', { hasText: /numbani/i }).click()
    const block = page.getByRole('region', { name: new RegExp(`Coach.s note from ${COACH_NAME}`) })
    await expect(block).toBeVisible()
    await expect(block).toContainText(must(NOTE_WITH_TAGS, 'note 1').text)
    await expect(block).toContainText('Reviewed by coach')
    await expect(block.getByText('positioning')).toBeVisible()
    await expect(block.getByText('06:40')).toBeVisible()

    // Armed: the first click asks with the cost, the second removes.
    await block.getByRole('button', { name: 'Remove this note' }).click()
    await block.getByRole('button', { name: 'Remove this note — moments go with it' }).click()
    await expect.poll(() => layered.deleted.seen()).toBe(true)
    expect(layered.deleted.get()).toEqual({ matchKey: NOTED_MATCH.match_key, noteId: 1 })
    await expect(block).toHaveCount(0)
  })

  test('a verdict shows on the card, and the keyboard can decide', async ({ page }) => {
    const inbox: CoachReturnSheet[] = []
    const returns = await mockInbox(page, inbox)
    await mockNotesImport(page, inbox)
    await page.goto('/')
    await importFromSettings(page)
    await expect(sheetDialog(page)).toBeVisible()

    // Undecided: exactly one radio per card is in the Tab order, so the
    // group is reachable without a mouse.
    const first = cards(page).nth(0)
    await expect(first.getByRole('radio', { name: 'Accept' })).toHaveAttribute('tabindex', '0')
    await expect(first.getByRole('radio', { name: 'Skip' })).toHaveAttribute('tabindex', '-1')

    // Clicking Accept must CHANGE THE PIXELS, not just an attribute — the
    // chosen chip fills, the unchosen one does not share its background.
    const accept = first.getByRole('radio', { name: 'Accept' })
    const skip = first.getByRole('radio', { name: 'Skip' })
    const bgOf = (loc: typeof accept) =>
      loc.evaluate((el) => getComputedStyle(el).backgroundColor)
    const before = await bgOf(accept)
    await accept.click()
    await expect(accept).toHaveAttribute('aria-checked', 'true')
    await expect.poll(() => bgOf(accept)).not.toBe(before)
    expect(await bgOf(accept)).not.toBe(await bgOf(skip))

    // Arrow keys move the verdict the way a radio group moves: from the
    // checked chip, ArrowRight lands on and selects Skip.
    await accept.press('ArrowRight')
    await expect(skip).toHaveAttribute('aria-checked', 'true')
    await expect(accept).toHaveAttribute('aria-checked', 'false')

    // The undecided sibling card is still reachable by keyboard alone.
    const second = cards(page).nth(1)
    await expect(second.getByRole('radio', { name: 'Accept' })).toHaveAttribute('tabindex', '0')
    await second.getByRole('radio', { name: 'Accept' }).press('Enter')
    await expect(second.getByRole('radio', { name: 'Accept' })).toHaveAttribute('aria-checked', 'true')

    // Finish with one note still undecided ARMS rather than closing —
    // the banner would keep nagging about the one left behind.
    await sheetDialog(page).getByRole('button', { name: /^Finish · 1 accepted · 1 skipped/ }).click()
    await expect(sheetDialog(page).getByText(/1 note is still undecided/)).toBeVisible()
    await sheetDialog(page).getByRole('button', { name: 'Finish anyway' }).click()
    await expect(sheetDialog(page)).toBeHidden()
    await expect.poll(() => returns.decisionsPut.seen()).toBe(true)
  })

  test('a plain bundle import still reports its counts', async ({ page }) => {
    await mockInbox(page, [])
    await page.route('**/api/v1/imports', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ kind: 'bundle', imported: 3, skipped: 1 }),
      })
    })
    await page.goto('/')
    await importFromSettings(page)

    await expect(page.getByText('Imported 3 matches, skipped 1 already present')).toBeVisible()
    await expect(sheetDialog(page)).toHaveCount(0)
  })
})

// ── The timestamped half of a review ──────────────────────────────────────

test.describe('return of notes — moments', () => {
  test.beforeEach(async ({ page }) => {
    await silenceParseEvents(page)
    await seedProfiles(page)
    await seedPlayerHistory(page)
  })

  // A player deciding whether to take a note has to see everything it
  // carries. When a review is timestamped, most of it IS the moments — a card
  // that hid them until after accepting would be asking for a decision about
  // content the reader cannot see.
  test('shows the moments before the player decides', async ({ page }) => {
    const inbox: CoachReturnSheet[] = []
    await mockInbox(page, inbox)
    await mockNotesImport(page, inbox)
    await page.goto('/')
    await importFromSettings(page)

    // The CARD, not the verdict widget cards() resolves to — the moments sit
    // above the radios.
    const card = sheetDialog(page).getByRole('article', { name: /king.s row/i })
    await expect(card).toContainText('03:23')
    await expect(card).toContainText('No off-angle — the tank ate the pressure alone.')
    await expect(card).toContainText('04:45')
    await expect(card).toContainText('Cassidy flanked behind you.')
  })

  // What this proves is the RENDERING end: an accepted note's moments reach
  // the journal, in order, with the replay code beside them.
  //
  // What it does NOT prove — and the comment here used to claim it did — is
  // the transport. This suite serves matches from a route mock, so the Go
  // accept path, the store and the aggregator are never in the loop: mutating
  // all three to drop moments entirely left this test green. Those links are
  // held by pkg/coachreturn (accept keeps a moments-only review), pkg/db (the
  // contract suite, both implementations) and pkg/aggregate (the conversion
  // onto the wire).
  test('renders the moments on the match once accepted', async ({ page }) => {
    const inbox: CoachReturnSheet[] = []
    await mockInbox(page, inbox)
    await mockNotesImport(page, inbox)
    await page.goto('/')
    await importFromSettings(page)

    await mockMatchesWithCoachNotes(page)
    await sheetDialog(page).getByRole('button', { name: 'Accept all notes' }).click()
    await sheetDialog(page).getByRole('button', { name: /^Finish/ }).click()
    await expect(sheetDialog(page)).toBeHidden()

    await page.getByRole('tab', { name: /^Matches/ }).click()
    await page.locator('.leaf-row', { hasText: /king.s row/i }).click()
    const block = page.getByRole('region', { name: new RegExp(`Coach.s note from ${COACH_NAME}`) })
    await expect(block).toContainText('03:23')
    await expect(block).toContainText('04:13')
    await expect(block).toContainText('Cassidy flanked behind you.')
    await expect(block.getByRole('button', { name: /copy replay code/i })).toBeVisible()
  })

  // The nag lived on Matches alone, so a player who imported notes and then
  // went to Settings, Parse or Unknown had no sign a review was waiting —
  // on three of the app's six tabs the coaching round trip was invisible.
  test('the waiting-notes banner follows the player onto every tab', async ({ page }) => {
    await mockInbox(page, [{ ...RETURN_SHEET_FIXTURE, decisions: {} }])
    await page.goto('/')
    await expect(inboxBanner(page)).toBeVisible()

    for (const tab of ['Settings', 'Parse', /^Unknown/, 'Compare', 'Elo Calculator'] as const) {
      await page.getByRole('tab', { name: tab }).click()
      await expect(inboxBanner(page)).toBeVisible()
    }
    // Reviews is the one exception: its shelf lists the same notes per coach
    // with the same Review button, so the banner steps aside there.
    await page.getByRole('tab', { name: /^Reviews/ }).click()
    await expect(inboxBanner(page)).toHaveCount(0)
    await expect(page.getByRole('list', { name: 'Notes waiting on a decision' })).toBeVisible()
  })

  // Importing the wrong file, or a review the player has decided they do not
  // want, left a sheet nagging from the banner with no way to be rid of it:
  // the server has had DELETE /coach/returns/{id} the whole time and nothing
  // in the app called it. Discarding is not "skip every note" — that writes
  // decisions and marks the matches reviewed. This drops the file.
  test('a staged sheet can be discarded, and the nagging stops', async ({ page }) => {
    const inbox = await mockInbox(page, [{ ...RETURN_SHEET_FIXTURE, decisions: {} }])
    await page.goto('/')
    await inboxBanner(page).getByRole('button', { name: 'Read the notes' }).click()

    await sheetDialog(page).getByRole('button', { name: /^Discard/ }).click()
    await page.getByRole('button', { name: /^Discard these notes/ }).click()

    await expect.poll(() => inbox.deletedIds).toEqual([RETURN_SHEET_FIXTURE.id])
    await expect(sheetDialog(page)).toHaveCount(0)
    await expect(inboxBanner(page)).toHaveCount(0)
    expect(inbox.decisionsPut.seen()).toBe(false)
  })
})
