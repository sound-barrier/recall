/**
 * Coaching session — open + end lifecycle.
 *
 * A coach opens a player's bundle from the Reviews tab and the whole app
 * turns into that player's: the loan slip replaces the profile chip, the
 * other six tabs run on the loaned records, every tab shows the way back
 * to the Film Room (which is what Reviews shows while the session is
 * open), and End restores the coach's own history untouched.
 *
 * Two persistence hunts ride along:
 *   - a mid-session reload must RESUME (the server still holds the
 *     session; the room shows the notes it hydrated), and
 *   - opening a DIFFERENT player right after ending must not leak the
 *     first player's draft into the second player's editor.
 */
import type { Route } from '@playwright/test'

import { must } from '../_capture'
import { test, expect } from '../_fixtures'
import {
  ANONYMOUS_BUNDLE_FIXTURE,
  COACH_OWN_MATCHES,
  NOTED_MATCH,
  OTHER_PLAYER_FIXTURE,
  RESURFACED_NOTES,
  SESSION_FIXTURE,
  backToFilmRoom,
  confirmPlayer,
  endSession,
  enterFilmRoom,
  filmRoom,
  identityPrompt,
  loanSlip,
  mockCoachSession,
  openSessionViaReviewsTab,
  pinSessionResume,
  seedCoachOwnMatches,
} from '../_coach'
import { seedProfiles, silenceParseEvents } from '../_theme-matrix'

test.describe('coaching session — open and end', () => {
  test.beforeEach(async ({ page }) => {
    await silenceParseEvents(page)
    await seedProfiles(page)
    await seedCoachOwnMatches(page)
  })

  test('opening a bundle loans the app to the player; End gives it back', async ({ page }) => {
    const session = await mockCoachSession(page)
    let sessionReads = 0
    await page.route('**/api/v1/coach/session', async (route: Route) => {
      if (route.request().method() === 'GET') sessionReads += 1
      await route.fallback()
    })
    await page.goto('/')
    await expect(page.locator('.leaf-row')).toHaveCount(COACH_OWN_MATCHES.length)
    // No resume flag → no boot-time GET (the no-network-on-mount rule).
    expect(sessionReads).toBe(0)
    await expect(loanSlip(page)).toHaveCount(0)

    await openSessionViaReviewsTab(page)
    await expect.poll(() => session.openCount()).toBe(1)

    // The slip names the player and takes the profile chip's place.
    await expect(loanSlip(page)).toBeVisible()
    await expect(page.locator('.profile-chip')).toHaveCount(0)
    await expect(filmRoom(page)).toBeVisible()

    // Matches runs on the PLAYER's six, not the coach's two — and keeps
    // the way back to the room in view.
    await page.getByRole('tab', { name: /^Matches/ }).click()
    await expect(page.locator('.leaf-row')).toHaveCount(SESSION_FIXTURE.matches.length)
    await expect(backToFilmRoom(page)).toBeVisible()

    // Settings carries the session rule too — every tab does.
    await page.getByRole('tab', { name: 'Settings' }).click()
    await expect(page.locator('[data-coach-session-rule]')).toBeVisible()
    await expect(backToFilmRoom(page)).toBeVisible()

    await endSession(page)
    await expect.poll(() => session.isActive()).toBe(false)
    // Ending says so, and lands on Reviews — the tab the session lived in —
    // wherever it was ended from (this End came from the Settings tab).
    await expect(page.getByText(/Session with Sable ended/)).toBeVisible()
    await expect(page.getByRole('tab', { name: /^Reviews/ })).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.profile-chip')).toBeVisible()
    await page.getByRole('tab', { name: /^Matches/ }).click()
    await expect(page.locator('.leaf-row')).toHaveCount(COACH_OWN_MATCHES.length)
  })

  test('a mid-session reload resumes the session and the room shows the marks', async ({ page }) => {
    const session = await mockCoachSession(page, { notes: RESURFACED_NOTES })
    await page.goto('/')
    await openSessionViaReviewsTab(page)
    await expect(loanSlip(page)).toBeVisible()
    await expect.poll(() => session.openCount()).toBe(1)

    await page.reload()

    // Resumed, not re-opened: the slip is back without another POST.
    await expect(loanSlip(page)).toBeVisible()
    expect(session.openCount()).toBe(1)
    await enterFilmRoom(page)
    await expect(page.getByRole('button', { name: /— note written$/ })).toHaveCount(1)
    await expect(page.getByRole('button', { name: /— reviewed$/ })).toHaveCount(1)
  })

  test('opening a different player after End starts with an empty editor', async ({ page }) => {
    const session = await mockCoachSession(page, { notes: RESURFACED_NOTES })
    await page.goto('/')
    await openSessionViaReviewsTab(page)
    await enterFilmRoom(page)

    // Sable's noted frame hydrates the editor with the resurfaced text…
    await page.getByRole('button', { name: /— note written$/ }).click()
    const editor = page.getByRole('textbox', { name: 'Note' })
    await expect(editor).toHaveValue(must(RESURFACED_NOTES[0], 'the resurfaced note').text)
    await expect(page.getByRole('button', { name: 'positioning', pressed: true })).toBeVisible()
    await endSession(page)

    // …and Wren's must NOT inherit it. Wren has no notes anywhere.
    session.swapPlayer(OTHER_PLAYER_FIXTURE)
    await openSessionViaReviewsTab(page)
    await expect(loanSlip(page, 'Wren')).toBeVisible()
    await enterFilmRoom(page)
    await page.getByRole('list', { name: /Wren.s matches/ }).getByRole('button').first().click()
    await expect(page.getByRole('textbox', { name: 'Note' })).toHaveValue('')
    await expect(page.getByRole('button', { name: 'positioning', pressed: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /— note written$/ })).toHaveCount(0)
    await expect(page.getByText(must(NOTED_MATCH.annotation?.note, "Sable's own note"))).toHaveCount(0)
  })

  // A plain export names nobody. Before this, the room opened on a blank
  // name where every keystroke failed with "Not saved" in 10 px mono and
  // there was no way to fix it — SessionView.handle_from_bundle existed
  // precisely so the client could prompt, and nothing read it.
  test('a bundle that named nobody asks who this is, then takes notes', async ({ page }) => {
    const session = await mockCoachSession(page, { session: ANONYMOUS_BUNDLE_FIXTURE })
    await page.goto('/')
    await openSessionViaReviewsTab(page)
    await enterFilmRoom(page)

    // The room asks, and refuses typing it could not save.
    await expect(identityPrompt(page)).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Note' })).toBeDisabled()

    await confirmPlayer(page, 'Wren')

    await expect(identityPrompt(page)).toHaveCount(0)
    await expect(loanSlip(page, 'Wren')).toBeVisible()
    const editor = page.getByRole('textbox', { name: 'Note' })
    await expect(editor).toBeEnabled()
    await editor.fill('Ult held too long on the second point.')
    await expect.poll(() => session.notes().map((n) => n.text))
      .toContain('Ult held too long on the second point.')
  })

  // A handle the bundle suggested is a suggestion — the locked decision is
  // "bundle suggests, coach confirms", so the room has to let it be fixed.
  test('a suggested handle can be corrected from the session sheet', async ({ page }) => {
    const session = await mockCoachSession(page)
    await page.goto('/')
    await openSessionViaReviewsTab(page)
    await enterFilmRoom(page)
    await expect(identityPrompt(page)).toHaveCount(0)

    await page.getByRole('button', { name: 'Change player' }).click()
    await confirmPlayer(page, 'Sable-alt')

    await expect(loanSlip(page, 'Sable-alt')).toBeVisible()
    expect(session.openCount()).toBe(1)
  })

  // Design rule 12. The coach's date range and picked map describe THEIR
  // corpus; left in place over the player's they show an arbitrary subset
  // (often zero rows), which reads as "the export is broken".
  test("opening a session clears the coach's own narrow, and End restores it", async ({ page }) => {
    await mockCoachSession(page)
    // Wide enough that the narrow rail (with #np-search) is always visible.
    await page.setViewportSize({ width: 1500, height: 1000 })
    await page.goto('/')
    await page.getByRole('tab', { name: /^Matches/ }).click()

    const search = page.locator('#np-search')
    await search.fill('dorado')
    await expect(page.locator('.leaf-row')).toHaveCount(1)

    await openSessionViaReviewsTab(page)
    await page.getByRole('tab', { name: /^Matches/ }).click()

    // Every one of the player's matches, not the handful their data happens
    // to share with the coach's filter.
    await expect(page.locator('.leaf-row')).toHaveCount(SESSION_FIXTURE.matches.length)
    await expect(search).toHaveValue('')

    await endSession(page)
    await page.getByRole('tab', { name: /^Matches/ }).click()

    await expect(search).toHaveValue('dorado')
    await expect(page.locator('.leaf-row')).toHaveCount(1)
  })

  // A resumed session lands IN the room. The session survived the reload; the
  // view did not, so a coach was returned to Matches — their own history
  // read-only, no explanation on the tab they were looking at, and the way
  // back to be found again on every reload.
  //
  // Asserted WITHOUT enterFilmRoom(): that helper clicks the way in when the
  // room is not already up, which is exactly the difference under test.
  test('a reload lands back in the film room, not on Matches', async ({ page }) => {
    await seedProfiles(page)
    await seedCoachOwnMatches(page)
    await mockCoachSession(page, { notes: RESURFACED_NOTES, active: true })
    await pinSessionResume(page)

    await page.goto('/')

    await expect(filmRoom(page)).toBeVisible()
    await expect(backToFilmRoom(page)).toHaveCount(0)
  })
})
