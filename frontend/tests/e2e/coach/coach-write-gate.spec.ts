/**
 * Coaching session — the write gate.
 *
 * While a session is open the six tabs run on the PLAYER's loaned records,
 * and nothing the coach does there may write to the coach's own database:
 * every mutating affordance is disabled with a reason, and — the real
 * guarantee — a catch-all route fails the test the moment ANY mutating
 * request leaves the page. The server 409s these too; this spec proves the
 * UI never even asks.
 */
import type { Page, Route } from '@playwright/test'

import { test, expect } from '../_fixtures'
import {
  KINGS_ROW_MATCH,
  SESSION_FIXTURE,
  backToFilmRoom,
  enterFilmRoom,
  filmRoom,
  loanSlip,
  mockCoachSession,
  openSessionViaReviewsTab,
  seedCoachOwnMatches,
  type SessionFixture,
} from '../_coach'
import { seedProfiles, silenceParseEvents } from '../_theme-matrix'

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])
const LOCK_REASON = /end the session/i

/**
 * Sable's bundle with a coach layer already accepted on the King's Row
 * match — the shape that exposed "Remove this note" as the one journal
 * control with no gate. Its DELETE goes to the coach's own database, so
 * the tripwire below would catch it too.
 */
const WITH_COACH_LAYER: SessionFixture = {
  ...SESSION_FIXTURE,
  matches: SESSION_FIXTURE.matches.map((m) =>
    m.match_key === KINGS_ROW_MATCH.match_key
      ? {
          ...m,
          coach_notes: [{
            id: 1,
            note_id: 'f1e2d3c4-5b6a-4790-8c1d-2e3f4a5b6c7d',
            coach_name: 'Vex',
            session_date: '2026-08-10',
            text: 'Held the high ground — keep doing that.',
            match_clock: '04:12',
            focus_tags: ['positioning'],
            extra_tags: [],
            accepted_at: '2026-08-11T09:15:00Z',
          }],
        }
      : m),
}

/**
 * Registered LAST so it is consulted FIRST: reads fall through to the
 * seeds beneath; any write is recorded and answered with a 500 so a
 * hypothetical optimistic UI cannot mistake it for success.
 */
async function armWriteTripwire(page: Page): Promise<string[]> {
  const tripped: string[] = []
  const trip = async (route: Route) => {
    const req = route.request()
    if (!MUTATING.has(req.method())) {
      await route.fallback()
      return
    }
    tripped.push(`${req.method()} ${new URL(req.url()).pathname}`)
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
  }
  const globs = [
    '**/api/v1/matches',
    '**/api/v1/matches/**',
    '**/api/v1/parses*',
    '**/api/v1/imports',
    '**/api/v1/database',
    '**/api/v1/database/*',
    '**/api/v1/screenshots/**',
  ]
  for (const glob of globs) await page.route(glob, trip)
  return tripped
}

async function openSession(page: Page, session: SessionFixture = SESSION_FIXTURE): Promise<string[]> {
  await silenceParseEvents(page)
  await seedProfiles(page)
  await seedCoachOwnMatches(page)
  await mockCoachSession(page, { session })
  // The CI runner has no Tesseract; a found binary keeps the Parse
  // affordances in their normal (enabled) state so only the gate disables them.
  await page.route('**/api/v1/settings/tesseract', async (route: Route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ path: '/opt/homebrew/bin/tesseract', found: true, version: '5.3.4', supported: true, error: '', platform: 'darwin' }),
    })
  })
  const tripped = await armWriteTripwire(page)
  await page.goto('/')
  await openSessionViaReviewsTab(page)
  await expect(loanSlip(page)).toBeVisible()
  await enterFilmRoom(page)
  return tripped
}

test.describe('coaching session — write gate', () => {
  test('Matches, Parse and Settings disable every write with the session reason', async ({ page }) => {
    const tripped = await openSession(page)

    // Matches toolbar.
    await page.getByRole('tab', { name: /^Matches/ }).click()
    await expect(page.locator('[data-add-match]')).toBeDisabled()
    await expect(page.locator('[data-add-match]')).toHaveAttribute('title', LOCK_REASON)
    await expect(page.locator('[data-import-matches]')).toBeDisabled()
    await expect(page.locator('[data-import-matches]')).toHaveAttribute('title', LOCK_REASON)

    // Parse: the lock note replaces the read-only one; Run + Watch are off.
    await page.getByRole('tab', { name: 'Parse' }).click()
    await expect(page.locator('[data-readonly-note]')).toBeVisible()
    await expect(page.locator('[data-readonly-note]')).toContainText(/coaching session/i)
    await expect(page.getByTestId('run-parse-btn')).toBeDisabled()
    await expect(page.locator('.big-switch input[type="checkbox"]')).toBeDisabled()

    // Settings → Backup & Restore + Advanced.
    await page.getByRole('tab', { name: 'Settings' }).click()
    await expect(page.getByRole('button', { name: /import matches/i })).toBeDisabled()
    await expect(page.getByRole('button', { name: /import matches/i })).toHaveAttribute('title', LOCK_REASON)
    await expect(page.getByRole('button', { name: /^Restore \(\.db\)/ })).toBeDisabled()
    await page.locator('#sec-advanced').evaluate((el) => { (el as HTMLDetailsElement).open = true })
    await expect(page.locator('[data-reparse-all-arm]')).toBeDisabled()
    await expect(page.getByRole('button', { name: /^Clear Database/ })).toBeDisabled()
    await expect(page.locator('[data-replay-tour]')).toBeDisabled()

    // The whole tour left no write behind.
    await expect(backToFilmRoom(page)).toBeVisible()
    expect(tripped, 'mutating requests during the session').toEqual([])
  })

  test("a loaned match's detail panel is read-only and points back to the room", async ({ page }) => {
    const tripped = await openSession(page)
    await page.getByRole('tab', { name: /^Matches/ }).click()

    // Right-click: the destructive items are dead.
    const row = page.locator('.leaf-row', { hasText: /king's row/i })
    await row.click({ button: 'right' })
    await expect(page.getByRole('menuitem', { name: 'Hide match' })).toBeDisabled()
    await page.keyboard.press('Escape')

    // Open the panel: journal, status radios and pin are all off; the way
    // to write about this match is the Film Room.
    await row.click()
    await expect(page.locator('aside.detail-panel')).toBeVisible()
    await expect(page.locator(`#note-${KINGS_ROW_MATCH.match_key}`)).toBeDisabled()
    const reviewRadios = page.getByRole('radiogroup', { name: 'Match review status' }).getByRole('radio')
    await expect(reviewRadios).toHaveCount(3)
    for (let i = 0; i < 3; i++) await expect(reviewRadios.nth(i)).toBeDisabled()
    const queueRadios = page.getByRole('radiogroup', { name: 'Match queue type' }).getByRole('radio')
    await expect(queueRadios).toHaveCount(3)
    for (let i = 0; i < 3; i++) await expect(queueRadios.nth(i)).toBeDisabled()
    await expect(page.locator('[data-pin-toggle]')).toBeDisabled()
    await expect(page.getByRole('button', { name: /Open in the film room/ })).toBeVisible()

    // Trying anyway must not send anything. dispatchEvent rather than a
    // forced click: it fires the handler even though the control is
    // disabled and off-screen, so this proves the GUARD refuses the write
    // rather than the disabled attribute merely suppressing the click.
    await page.locator('[data-pin-toggle]').dispatchEvent('click')
    await reviewRadios.nth(1).dispatchEvent('click')
    await page.getByRole('button', { name: /Open in the film room/ }).click()
    await expect(filmRoom(page)).toBeVisible()
    expect(tripped, 'mutating requests during the session').toEqual([])
  })

  test('"Remove this note" on an accepted coach block is locked like every sibling', async ({ page }) => {
    const tripped = await openSession(page, WITH_COACH_LAYER)
    await page.getByRole('tab', { name: /^Matches/ }).click()
    await page.locator('.leaf-row', { hasText: /king's row/i }).click()

    const block = page.getByRole('region', { name: /Coach.s note from Vex/ })
    await expect(block).toBeVisible()
    const remove = block.getByRole('button', { name: 'Remove this note' })
    await expect(remove).toBeDisabled()
    await expect(remove).toHaveAttribute('title', LOCK_REASON)

    // Same proof as the pin above: dispatch fires the handler past the
    // disabled attribute, so this shows the GUARD refusing the write.
    await remove.dispatchEvent('click')
    expect(tripped, 'mutating requests during the session').toEqual([])
  })
})
