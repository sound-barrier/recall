/**
 * Coaching session — open + end lifecycle.
 *
 * A coach opens a player's bundle from the masthead and the whole app
 * turns into that player's: the loan slip replaces the profile chip, the
 * six tabs run on the loaned records, every tab shows the way back to the
 * Film Room, and End restores the coach's own history untouched.
 *
 * Two persistence hunts ride along:
 *   - a mid-session reload must RESUME (the server still holds the
 *     session; the room shows the notes it hydrated), and
 *   - opening a DIFFERENT player right after ending must not leak the
 *     first player's draft into the second player's editor.
 */
import type { Route } from '@playwright/test'

import { must } from './_capture'
import { test, expect } from './_fixtures'
import {
  COACH_OWN_MATCHES,
  NOTED_MATCH,
  OTHER_PLAYER_FIXTURE,
  RESURFACED_NOTES,
  SESSION_FIXTURE,
  backToFilmRoom,
  endSession,
  enterFilmRoom,
  filmRoom,
  loanSlip,
  mockCoachSession,
  openSessionViaMasthead,
  seedCoachOwnMatches,
} from './_coach'
import { seedProfiles, silenceParseEvents } from './_theme-matrix'

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

    await openSessionViaMasthead(page)
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
    await expect(page.locator('.profile-chip')).toBeVisible()
    await page.getByRole('tab', { name: /^Matches/ }).click()
    await expect(page.locator('.leaf-row')).toHaveCount(COACH_OWN_MATCHES.length)
  })

  test('a mid-session reload resumes the session and the room shows the marks', async ({ page }) => {
    const session = await mockCoachSession(page, { notes: RESURFACED_NOTES })
    await page.goto('/')
    await openSessionViaMasthead(page)
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
    await openSessionViaMasthead(page)
    await enterFilmRoom(page)

    // Sable's noted frame hydrates the editor with the resurfaced text…
    await page.getByRole('button', { name: /— note written$/ }).click()
    const editor = page.getByRole('textbox', { name: 'Note' })
    await expect(editor).toHaveValue(must(RESURFACED_NOTES[0], 'the resurfaced note').text)
    await expect(page.getByRole('button', { name: 'positioning', pressed: true })).toBeVisible()
    await endSession(page)

    // …and Wren's must NOT inherit it. Wren has no notes anywhere.
    session.swapPlayer(OTHER_PLAYER_FIXTURE)
    await openSessionViaMasthead(page)
    await expect(loanSlip(page, 'Wren')).toBeVisible()
    await enterFilmRoom(page)
    await page.getByRole('list', { name: /Wren.s matches/ }).getByRole('button').first().click()
    await expect(page.getByRole('textbox', { name: 'Note' })).toHaveValue('')
    await expect(page.getByRole('button', { name: 'positioning', pressed: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /— note written$/ })).toHaveCount(0)
    await expect(page.getByText(must(NOTED_MATCH.annotation?.note, "Sable's own note"))).toHaveCount(0)
  })
})
