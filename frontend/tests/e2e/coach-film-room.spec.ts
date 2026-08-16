/**
 * The Film Room — reel · desk · session sheet.
 *
 * Everything the coach does with a player's bundle happens here: walk the
 * reel (grouped by the PLAYER's days, clocked in the PLAYER's zone), read
 * a match on the desk, write a structured note (focus chips + text +
 * in-match clock) or mark it reviewed, watch the sheet tally the session,
 * write the summary, and export the notes.
 *
 * Every time shown in the room is the player's naive clock. The fixture's
 * `played_at_utc` is 9 h off the naive fields, so the app's default
 * render-the-instant-in-the-viewer's-zone helpers show a DIFFERENT HH:MM
 * — the clock assertions below only pass when the room reads the naive
 * fields.
 */
import type { Page } from '@playwright/test'

import { must } from './_capture'
import { test, expect } from './_fixtures'
import {
  COACH_NAME,
  KINGS_ROW_MATCH,
  NOTED_MATCH,
  SESSION_FIXTURE,
  enterFilmRoom,
  filmRoom,
  loanSlip,
  mockCoachSession,
  openSessionViaMasthead,
  seedCoachOwnMatches,
  type CoachSessionMock,
  type CoachSessionMockOptions,
} from './_coach'
import { seedProfiles, silenceParseEvents } from './_theme-matrix'

const KINGS_ROW_DISPLAY = "King's Row"

const reel = (page: Page) => page.getByRole('list', { name: /Sable.s matches/ })
const frames = (page: Page) => reel(page).getByRole('button')
const desk = (page: Page) => filmRoom(page).getByRole('article')
const noteEditor = (page: Page) => page.getByRole('textbox', { name: 'Note' })
const clockInput = (page: Page) => page.getByRole('textbox', { name: /clock/i })
const reviewedSwitch = (page: Page) => page.getByRole('switch', { name: 'Reviewed' })
const focusChip = (page: Page, tag: string, pressed?: boolean) =>
  page.getByRole('button', { name: tag, exact: true, ...(pressed === undefined ? {} : { pressed }) })

async function openRoom(page: Page, opts: CoachSessionMockOptions = {}): Promise<CoachSessionMock> {
  await silenceParseEvents(page)
  await seedProfiles(page)
  await seedCoachOwnMatches(page)
  const session = await mockCoachSession(page, opts)
  await page.goto('/')
  await openSessionViaMasthead(page)
  await expect(loanSlip(page)).toBeVisible()
  await enterFilmRoom(page)
  return session
}

test.describe('film room — reel', () => {
  test("groups the reel by the player's day and clocks frames in the player's zone", async ({ page }) => {
    await openRoom(page)

    // Three of Sable's days, each header carrying its tally.
    await expect(filmRoom(page).getByRole('heading', { level: 3, name: /· \d+ played · \d+–\d+/ })).toHaveCount(3)
    await expect(frames(page)).toHaveCount(SESSION_FIXTURE.matches.length)

    // The King's Row frame says 21:14 — Sable's clock — even though its
    // played_at_utc renders as a different hour in the coach's zone.
    const naiveClock = KINGS_ROW_MATCH.data.finished_at
    await expect(frames(page).filter({ hasText: KINGS_ROW_DISPLAY })).toHaveAccessibleName(new RegExp(naiveClock))

    // "Sable's clock" is labeled once on the reel and once on the desk.
    await expect(page.getByText(/Sable.s clock/)).toHaveCount(2)
  })

  test('selecting a frame puts that match on the desk', async ({ page }) => {
    await openRoom(page)
    await frames(page).filter({ hasText: KINGS_ROW_DISPLAY }).click()

    await expect(desk(page).getByRole('heading', { name: KINGS_ROW_DISPLAY })).toBeVisible()
    await expect(frames(page).filter({ hasText: KINGS_ROW_DISPLAY })).toHaveAttribute('aria-current', 'true')
    // The desk shows the player's own words as hers, on the frame she wrote them.
    await frames(page).first().click()
    await expect(desk(page).getByRole('blockquote')).toContainText(must(NOTED_MATCH.annotation?.note, "Sable's note"))
  })

  test('[ and ] and the Prev/Next buttons move the selection', async ({ page }) => {
    await openRoom(page)
    await frames(page).first().click()
    await expect(frames(page).nth(0)).toHaveAttribute('aria-current', 'true')

    await page.keyboard.press(']')
    await expect(frames(page).nth(1)).toHaveAttribute('aria-current', 'true')
    await expect(frames(page).nth(0)).not.toHaveAttribute('aria-current', 'true')

    await page.getByRole('button', { name: /^Next/ }).click()
    await expect(frames(page).nth(2)).toHaveAttribute('aria-current', 'true')

    await page.getByRole('button', { name: /^Prev/ }).click()
    await expect(frames(page).nth(1)).toHaveAttribute('aria-current', 'true')

    await page.keyboard.press('[')
    await expect(frames(page).nth(0)).toHaveAttribute('aria-current', 'true')
  })
})

test.describe('film room — desk notes', () => {
  test('a note autosaves as a structured PUT and marks the frame', async ({ page }) => {
    const session = await openRoom(page)
    const target = frames(page).filter({ hasText: KINGS_ROW_DISPLAY })
    await target.click()

    await focusChip(page, 'positioning').click()
    await expect(focusChip(page, 'positioning', true)).toBeVisible()
    await noteEditor(page).fill('Held the high ground on A — do that on B too.')
    await clockInput(page).fill('04:12')

    await expect.poll(() => session.notePut.seen() && session.notePut.get().match_clock === '04:12').toBe(true)
    expect(session.notePutKey.get()).toBe(KINGS_ROW_MATCH.match_key)
    expect(session.notePut.get()).toEqual({
      kind: 'note',
      text: 'Held the high ground on A — do that on B too.',
      focus_tags: ['positioning'],
      extra_tags: [],
      match_clock: '04:12',
    })
    await expect(target).toHaveAccessibleName(/— note written$/)
  })

  test('"+ Add" grows a freeform chip that travels as an extra tag', async ({ page }) => {
    const session = await openRoom(page)
    await frames(page).filter({ hasText: KINGS_ROW_DISPLAY }).click()

    await page.getByRole('button', { name: /^\+ Add/ }).click()
    await page.getByRole('textbox', { name: /new focus/i }).fill('tempo')
    await page.keyboard.press('Enter')
    await expect(focusChip(page, 'tempo', true)).toBeVisible()
    await noteEditor(page).fill('Ult before the second cart checkpoint, not after.')

    await expect.poll(() => session.notePut.seen() && session.notePut.get().extra_tags.length > 0).toBe(true)
    expect(session.notePut.get().extra_tags).toEqual(['tempo'])
    expect(session.notePut.get().focus_tags).toEqual([])
  })

  test('an invalid in-match clock is explained through aria-describedby', async ({ page }) => {
    await openRoom(page)
    await frames(page).filter({ hasText: KINGS_ROW_DISPLAY }).click()

    const clock = clockInput(page)
    await clock.fill('9:99')
    await expect(clock).toHaveAttribute('aria-invalid', 'true')
    const hintId = must(await clock.getAttribute('aria-describedby'), 'aria-describedby on the clock input')
    await expect(page.locator(`#${hintId}`)).toContainText(/MM:SS/)

    await clock.fill('09:59')
    await expect(clock).not.toHaveAttribute('aria-invalid', 'true')
  })

  test('Reviewed is a switch: on → the frame reads "— reviewed", off → the mark goes', async ({ page }) => {
    const session = await openRoom(page)
    const target = frames(page).filter({ hasText: KINGS_ROW_DISPLAY })
    await target.click()

    const toggle = reviewedSwitch(page)
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await expect(target).toHaveAccessibleName(/— reviewed$/)
    await expect.poll(() => session.notePut.seen()).toBe(true)
    expect(session.notePut.get().kind).toBe('reviewed_only')

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await expect(target).not.toHaveAccessibleName(/— reviewed$/)
    await expect.poll(() => session.noteDeletes).toContain(KINGS_ROW_MATCH.match_key)
  })
})

test.describe('film room — session sheet', () => {
  test('the sheet tallies notes, reviewed-only marks, focus tags and the coach name', async ({ page }) => {
    await openRoom(page)

    await frames(page).filter({ hasText: KINGS_ROW_DISPLAY }).click()
    await focusChip(page, 'positioning').click()
    await noteEditor(page).fill('Peel earlier.')
    await frames(page).first().click()
    await reviewedSwitch(page).click()

    await expect(page.getByText(`2 notes · 1 reviewed only · ${COACH_NAME}`)).toBeVisible()
    const tally = page.getByRole('list', { name: /focus/i })
    await expect(tally.getByRole('listitem').filter({ hasText: 'positioning' })).toContainText('1')
  })

  test('the summary autosaves as PUT /coach/session/summary', async ({ page }) => {
    const session = await openRoom(page)
    await page.getByRole('textbox', { name: /What to work on/ }).fill('Ult economy first. Then positioning on control.')

    await expect.poll(() => session.summaryPut.seen()).toBe(true)
    expect(session.summaryPut.get()).toEqual({ text: 'Ult economy first. Then positioning on control.' })
  })

  test('Export downloads recall-coach-notes-*.zip', async ({ page }) => {
    const session = await openRoom(page)
    await frames(page).first().click()
    await noteEditor(page).fill('Something to export.')
    await expect.poll(() => session.notePut.seen()).toBe(true)

    const download = page.waitForEvent('download')
    await loanSlip(page).getByRole('button', { name: 'Export notes' }).click()
    expect((await download).suggestedFilename()).toMatch(/^recall-coach-notes-.*\.zip$/)
    await expect.poll(() => session.exportCount()).toBe(1)
  })

  test('Export is disabled, and says why, until the coach has a name', async ({ page }) => {
    await openRoom(page, { coachName: '' })
    const exportBtn = loanSlip(page).getByRole('button', { name: 'Export notes' })
    await expect(exportBtn).toBeDisabled()
    await expect(exportBtn).toHaveAttribute('title', /coach name/i)
  })
})
