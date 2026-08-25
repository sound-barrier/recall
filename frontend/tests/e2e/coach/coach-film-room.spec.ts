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

import { must } from '../_capture'
import { test, expect } from '../_fixtures'
import {
  COACH_NAME,
  KINGS_ROW_MATCH,
  NOTED_MATCH,
  SESSION_FIXTURE,
  enterFilmRoom,
  filmRoom,
  loanSlip,
  mockCoachSession,
  openSessionViaReviewsTab,
  seedCoachOwnMatches,
  type CoachSessionMock,
  type CoachSessionMockOptions,
  RESURFACED_NOTES,
} from '../_coach'
import { seedProfiles, silenceParseEvents } from '../_theme-matrix'

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
  await openSessionViaReviewsTab(page)
  await expect(loanSlip(page)).toBeVisible()
  await enterFilmRoom(page)
  return session
}

test.describe('film room — earlier notes', () => {
  // The session already re-loads every note ever written about the player —
  // but a note about a match not in TODAY'S corpus had no frame on the
  // reel, so prior-session work was invisible exactly when it mattered.
  test('notes without a frame shelve in a drawer under the desk', async ({ page }) => {
    const ORPHANS = [
      {
        note_id: 'c1d2e3f4-0a1b-4c2d-9e3f-4a5b6c7d8e9f',
        match_key: 'match-2026-05-02T21-15-00',
        kind: 'note' as const,
        text: 'Same first-fight overreach as Dorado — this is the pattern.',
        focus_tags: ['positioning'], extra_tags: [], match_clock: '',
        updated_at: '2026-05-02T22:00:00Z',
      },
      {
        note_id: 'd2e3f4a5-1b2c-4d3e-8f4a-5b6c7d8e9f0a',
        match_key: 'replay-Z9Y8X7',
        kind: 'note' as const,
        text: 'Ult count was never spoken.',
        focus_tags: [], extra_tags: [], match_clock: '',
        updated_at: '2026-05-01T22:00:00Z',
      },
    ]
    await openRoom(page, { notes: [...RESURFACED_NOTES, ...ORPHANS] })

    const drawer = filmRoom(page).getByText(/Earlier notes about Sable/)
    await expect(drawer).toBeVisible()
    await expect(filmRoom(page).getByText('2 from before this corpus')).toBeVisible()

    await drawer.click()
    await expect(filmRoom(page).getByText(/Same first-fight overreach/)).toBeVisible()
    // A dated key reads as its day; a replay key reads as its code.
    await expect(filmRoom(page).getByText(/May 2/)).toBeVisible()
    await expect(filmRoom(page).getByText('Z9Y8X7')).toBeVisible()
    // Notes WITH frames stay on their frames, not in the drawer. Scoped to
    // the drawer: the note also lives in the desk's own editor, rightly.
    await expect(filmRoom(page).locator('.orphan-drawer').getByText(/Late peel on B/)).toHaveCount(0)
  })
})

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
    // The desk shows the player's own words as theirs, on the frame they wrote them.
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

test.describe('film room — stepping into the app', () => {
  test("the Matches list runs on the player's clock, and says so", async ({ page }) => {
    await openRoom(page)
    await page.getByRole('tab', { name: /^Matches/ }).click()

    // Same match, three clicks from the room: 21:14 is Sable's finish time.
    // Rendering the canonical instant instead would print the coach's zone —
    // a different hour, and with the fixture's 9 h offset a different DAY
    // than the one the row is grouped and filtered under.
    const row = page.locator('.leaf-row', { hasText: /king's row/i })
    await expect(row).toContainText(KINGS_ROW_MATCH.data.finished_at)
    const playerDay = await page.evaluate(
      (date) => new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      KINGS_ROW_MATCH.data.date,
    )
    await expect(row).toContainText(playerDay)

    // Labeled once on this surface — an unlabeled 21:14 is a lie to a coach
    // in another timezone.
    await expect(page.getByText(/Times in Sable's clock/)).toHaveCount(1)
  })

  test("the detail panel keeps the player's clock and names it", async ({ page }) => {
    await openRoom(page)
    await page.getByRole('tab', { name: /^Matches/ }).click()
    await page.locator('.leaf-row', { hasText: /king's row/i }).click()

    const panel = page.locator('aside.detail-panel')
    await expect(panel).toBeVisible()
    await expect(panel).toContainText('9:14pm')
    await expect(panel.getByText(/Times in Sable's clock/)).toBeVisible()
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
    // Digits only: the field is always MM:SS, so there is no colon to type.
    await clockInput(page).pressSequentially('0412')

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

    await page.getByRole('button', { name: '+ Add', exact: true }).click()
    await page.getByRole('textbox', { name: /new focus/i }).fill('tempo')
    await page.keyboard.press('Enter')
    await expect(focusChip(page, 'tempo', true)).toBeVisible()
    await noteEditor(page).fill('Ult before the second cart checkpoint, not after.')

    await expect.poll(() => session.notePut.seen() && session.notePut.get().extra_tags.length > 0).toBe(true)
    expect(session.notePut.get().extra_tags).toEqual(['tempo'])
    expect(session.notePut.get().focus_tags).toEqual([])
  })

  // 09:59 is typed as 0,9,5,9 and passes through 00:95 on the way, which is
  // not a clock. The field shows the half-typed value rather than correcting
  // it — a correction mid-keystroke would make the next digit land somewhere
  // the coach did not ask for — and says so while it stands.
  test('an in-progress clock is explained through aria-describedby', async ({ page }) => {
    await openRoom(page)
    await frames(page).filter({ hasText: KINGS_ROW_DISPLAY }).click()

    const clock = clockInput(page)
    await clock.pressSequentially('095')
    await expect(clock).toHaveValue('00:95')
    await expect(clock).toHaveAttribute('aria-invalid', 'true')
    const hintId = must(await clock.getAttribute('aria-describedby'), 'aria-describedby on the clock input')
    await expect(page.locator(`#${hintId}`)).toContainText(/when in the match/i)

    await clock.press('9')
    await expect(clock).toHaveValue('09:59')
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

  test('the focus list autosaves as PUT /coach/session/focus-items', async ({ page }) => {
    const session = await openRoom(page)
    await page.getByRole('button', { name: '+ Add an item' }).click()
    await page.getByRole('textbox', { name: 'What to work on, item 1' }).fill('Ult economy first')

    await expect.poll(() => session.focusPut.seen()).toBe(true)
    const sent = session.focusPut.get().items
    expect(sent).toHaveLength(1)
    expect(sent[0]?.text).toBe('Ult economy first')
  })

  test('a second item goes out beside the first, in the coach order', async ({ page }) => {
    const session = await openRoom(page)
    const sentTexts = (): string[] =>
      (session.focusPut.seen() ? session.focusPut.get().items : []).map((i) => i.text)

    await page.getByRole('button', { name: '+ Add an item' }).click()
    await page.getByRole('textbox', { name: 'What to work on, item 1' }).fill('Ult economy first')
    await expect.poll(sentTexts).toEqual(['Ult economy first'])

    await page.getByRole('button', { name: '+ Add an item' }).click()
    await page.getByRole('textbox', { name: 'What to work on, item 2' }).fill('Hold the high ground')

    await expect.poll(sentTexts).toEqual(['Ult economy first', 'Hold the high ground'])
  })

  test('Export downloads recall-coach-notes-*.zip', async ({ page }) => {
    const session = await openRoom(page)
    await frames(page).first().click()
    await noteEditor(page).fill('Something to export.')
    await expect.poll(() => session.notePut.seen()).toBe(true)

    const download = page.waitForEvent('download')
    await loanSlip(page).getByRole('button', { name: /Export notes file/ }).click()
    expect((await download).suggestedFilename()).toMatch(/^recall-coach-notes-.*\.zip$/)
    await expect.poll(() => session.exportCount()).toBe(1)
  })

  test('Export is disabled, and says why, until the coach has a name', async ({ page }) => {
    await openRoom(page, { coachName: '' })
    const exportBtn = loanSlip(page).getByRole('button', { name: /Export notes file/ })
    await expect(exportBtn).toBeDisabled()
    await expect(exportBtn).toHaveAttribute('title', /coach name/i)
  })
})
