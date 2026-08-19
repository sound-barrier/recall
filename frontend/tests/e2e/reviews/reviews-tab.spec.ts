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
    // Sections are numbered because they are an arc: you → a coach → someone
    // else. Each carries its action whether or not it is empty.
    await expect(panel(page).getByRole('heading', { name: 'From a coach' })).toBeVisible()
    await expect(panel(page).getByRole('button', { name: /send matches out/i })).toBeVisible()
    await expect(panel(page).getByRole('heading', { name: 'For someone else' })).toBeVisible()
    await expect(panel(page).getByRole('button', { name: /open a player.s bundle/i })).toBeVisible()
  })

  // "Send matches out" means share. It lands on Matches (the narrow the
  // dialog counts is only visible there) and the dialog opens ALREADY in
  // share mode — the same one action the palette runs, so neither can drift.
  test('Send matches out lands on Matches with the share dialog open in share mode', async ({ page }) => {
    await page.goto('/')
    await tab(page).click()
    await panel(page).getByRole('button', { name: /send matches out/i }).click()

    await expect(page.getByRole('tab', { name: /^Matches/ })).toHaveAttribute('aria-selected', 'true')
    const dialog = page.getByRole('dialog', { name: 'Share with a coach' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('checkbox', { name: /Share with a coach/ })).toBeChecked()
    await expect(dialog.getByLabel('Your handle')).toBeVisible()
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
    await rows.first().getByRole('button', { name: 'Review' }).click()
    await expect(page.getByRole('dialog', { name: new RegExp(`Notes from ${COACH_NAME}`) })).toBeVisible()
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
