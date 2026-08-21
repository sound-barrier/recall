/**
 * Writing a note and SEEING it.
 *
 * The note has always been markdown, written into a bare textarea — you typed
 * `**hold the angle**` and looked at asterisks, and the only way to find out
 * what your coach actually received was to leave the room and open the note
 * block. The toolbar made that worse rather than better: pressing Title
 * inserted a `#` and nothing on screen changed.
 *
 * So the editor renders as you type, and the raw markdown is one click away.
 * What it renders is the SAME grammar the exported ledger renders — the load
 * path runs through the app's own parser, so the editor cannot show something
 * the coach will not receive.
 */
import type { Page } from '@playwright/test'

import { test, expect } from '../_fixtures'
import {
  KINGS_ROW_MATCH,
  enterFilmRoom,
  loanSlip,
  mockCoachSession,
  openSessionViaReviewsTab,
  seedCoachOwnMatches,
  type CoachSessionMockOptions,
} from '../_coach'
import { seedProfiles, silenceParseEvents } from '../_theme-matrix'

const KINGS_ROW_DISPLAY = "King's Row"

const reel = (page: Page) => page.getByRole('list', { name: /Sable.s matches/ })
const frames = (page: Page) => reel(page).getByRole('button')
const note = (page: Page) => page.getByRole('textbox', { name: 'Note' })
const modeGroup = (page: Page) => page.getByRole('group', { name: 'Note format' })
const rawBtn = (page: Page) => modeGroup(page).getByRole('button', { name: 'Markdown' })
const richBtn = (page: Page) => modeGroup(page).getByRole('button', { name: 'Formatted' })

async function openRoomOnAMatch(page: Page, opts: CoachSessionMockOptions = {}) {
  await silenceParseEvents(page)
  await seedProfiles(page)
  await seedCoachOwnMatches(page)
  const session = await mockCoachSession(page, opts)
  await page.goto('/')
  await openSessionViaReviewsTab(page)
  await expect(loanSlip(page)).toBeVisible()
  await enterFilmRoom(page)
  await frames(page).filter({ hasText: KINGS_ROW_DISPLAY }).click()
  return session
}

test.describe('a note you can see', () => {
  // TYPED, not filled. `fill()` sets a contenteditable's content wholesale and
  // never fires an input rule, so it would leave the markers sitting there as
  // text — which is precisely the old behaviour this feature replaces. Only
  // real keystrokes exercise what a person actually does.
  test('emphasis renders as you type, and the asterisks are gone', async ({ page }) => {
    await openRoomOnAMatch(page)
    await note(page).click()
    await page.keyboard.type('Hold **the high ground** first.')

    // The point of the whole feature: the markers did their job and left.
    await expect(note(page).getByText('the high ground')).toHaveRole('strong')
    await expect(note(page)).not.toContainText('**')
  })

  test('a heading is a heading, and a bullet is a bullet', async ({ page }) => {
    await openRoomOnAMatch(page)
    await note(page).click()
    await page.keyboard.type('# Ult economy')
    await page.keyboard.press('Enter')
    await page.keyboard.type('- hold it for the dive')
    await page.keyboard.press('Enter')
    await page.keyboard.type('count their suzu')

    await expect(note(page).getByRole('heading', { name: 'Ult economy' })).toBeVisible()
    await expect(note(page).getByRole('listitem')).toHaveCount(2)
    await expect(note(page)).not.toContainText('#')
  })

  test('the raw markdown is one click away, and it is what gets stored', async ({ page }) => {
    const session = await openRoomOnAMatch(page)
    await note(page).fill('Hold **the high ground** first.')
    await expect.poll(() => session.notePut.seen()).toBe(true)

    await expect(richBtn(page)).toHaveAttribute('aria-pressed', 'true')
    await rawBtn(page).click()
    await expect(rawBtn(page)).toHaveAttribute('aria-pressed', 'true')

    // Raw mode shows the STORED text — that is the honest channel for what
    // serialization did, so nothing has to be announced in the UI.
    await expect(note(page)).toHaveValue('Hold **the high ground** first.')
    expect(session.notePut.get().text).toBe('Hold **the high ground** first.')
  })

  test('formatted is where you land every time, even after choosing raw', async ({ page }) => {
    await openRoomOnAMatch(page)
    await rawBtn(page).click()
    await expect(rawBtn(page)).toHaveAttribute('aria-pressed', 'true')

    // Move to another match and back: the choice is a peek at the source for
    // the note you are on, not a setting that follows you around.
    await frames(page).first().click()
    await frames(page).filter({ hasText: KINGS_ROW_DISPLAY }).click()
    await expect(richBtn(page)).toHaveAttribute('aria-pressed', 'true')
  })

  test('Tab leaves the editor rather than being eaten by it', async ({ page }) => {
    await openRoomOnAMatch(page)
    await note(page).click()
    await page.keyboard.press('Tab')

    // A contenteditable that swallows Tab is a WCAG 2.1.2 keyboard trap, and
    // axe cannot see it. The list extension binds Tab by default; we unbind it.
    await expect(note(page)).not.toBeFocused()
  })

  test('opening a note and leaving does not rewrite it', async ({ page }) => {
    const session = await openRoomOnAMatch(page, {
      notes: [{
        note_id: '30000000-0000-4000-8000-000000000001',
        match_key: KINGS_ROW_MATCH.match_key, kind: 'note',
        text: '* angle\n* ult', focus_tags: [], extra_tags: [],
        match_clock: '', updated_at: '2026-08-19T18:00:00Z',
      }],
    })
    await expect(note(page).getByRole('listitem')).toHaveCount(2)

    await frames(page).first().click()
    await frames(page).filter({ hasText: KINGS_ROW_DISPLAY }).click()

    // setContent runs with emitUpdate false, so a note nobody typed into is
    // never re-serialized — normalization lands on a real edit or not at all.
    expect(session.notePut.seen()).toBe(false)
  })
})
