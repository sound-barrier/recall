/**
 * The film-room stat rail.
 *
 * A coach watching a frame keeps wanting one thing the room could not tell
 * them: is this how this player usually plays this hero, on this map? The
 * corpus is already loaned and already on screen — but reading a tendency
 * off it meant leaving the room for the Matches tab, which is the one thing
 * a coach mid-frame will not do.
 *
 * So the rail answers that question twice, beside the sheet, and it says
 * out loud when the bucket is too small to be a tendency: a bundle is six
 * matches, so "100% on Ana" off two games is the rail's most likely output
 * and its least true one.
 */
import { test, expect } from '../_fixtures'
import {
  KINGS_ROW_MATCH, enterFilmRoom, filmRoom, loanSlip, mockCoachSession,
  openSessionViaReviewsTab, seedCoachOwnMatches,
} from '../_coach'
import { seedProfiles, silenceParseEvents } from '../_theme-matrix'

const rail = (page: import('@playwright/test').Page) =>
  page.getByRole('region', { name: 'Player tendencies' })

test.describe('film-room stat rail', () => {
  test.beforeEach(async ({ page }) => {
    await silenceParseEvents(page)
    await seedProfiles(page)
    await seedCoachOwnMatches(page)
    await mockCoachSession(page)
    await page.goto('/')
    await openSessionViaReviewsTab(page)
    await expect(loanSlip(page)).toBeVisible()
    await enterFilmRoom(page)
  })

  test('reads the frame’s own hero and map out of the loaned corpus', async ({ page }) => {
    await filmRoom(page).getByRole('button', { name: /king's row/i }).first().click()

    // KINGS_ROW_MATCH is Ana; the corpus carries one other Ana match
    // (Numbani), both wins — so the hero row is 2 decisive games at 100%,
    // and the map row is the single King's Row game.
    await expect(rail(page)).toContainText(/ana/i)
    await expect(rail(page)).toContainText(/king's row/i)
    await expect(rail(page).getByRole('progressbar', { name: /ana winrate/i }))
      .toHaveAttribute('aria-valuenow', '100')
  })

  test('says when a bucket is too small to be a tendency', async ({ page }) => {
    await filmRoom(page).getByRole('button', { name: /king's row/i }).first().click()
    // Two games is not a tendency, and the rail must not present it as one.
    await expect(rail(page)).toContainText(/too few/i)
  })

  test('follows the frame when the coach moves down the reel', async ({ page }) => {
    await filmRoom(page).getByRole('button', { name: /king's row/i }).first().click()
    await expect(rail(page)).toContainText(/ana/i)

    await filmRoom(page).getByRole('button', { name: /busan/i }).first().click()
    // Busan is Kiriko — a different hero and a different map.
    await expect(rail(page)).toContainText(/kiriko/i)
    await expect(rail(page)).not.toContainText(/ana/i)
  })
})

// KINGS_ROW_MATCH is imported for its identity in the assertions above; the
// harness seeds it as part of the default session corpus.
void KINGS_ROW_MATCH
