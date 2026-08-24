/**
 * Sending matches to a coach — the dialog, end to end.
 *
 * It used to be a checkbox inside a dialog labeled "Export bundle", which
 * is why nobody found it. What these specs pin is the part no unit test
 * can: the four front doors all reach the same dialog over the right set,
 * the replay-code requirement reads as a manifest rather than a count, and
 * a successful send both POSTs the share block AND shows up in the sent
 * ledger without a reload.
 *
 * A coach reviews by WATCHING the replay, so a match with no replay code is
 * a match they cannot act on — the server refuses the whole share for one
 * (409, ErrShareNeedsReplayCode). The dialog says which.
 */
import type { Page, Route } from '@playwright/test'

import { routeCapture } from '../_capture'
import { test, expect } from '../_fixtures'
import { seedCoachOwnMatches } from '../_coach'
import { seedProfiles, silenceParseEvents } from '../_theme-matrix'

const reviewsTab = (page: Page) => page.getByRole('tab', { name: /^Reviews/ })
const matchesTab = (page: Page) => page.getByRole('tab', { name: /^Matches/ })
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Send to a coach' })
const rows = (page: Page) =>
  dialog(page).getByRole('list', { name: 'Matches going to your coach' }).getByRole('listitem')

/**
 * Two matches, one carrying a replay code and one not — the mixed case the
 * manifest exists for. Registered AFTER seedCoachOwnMatches so it wins
 * (Playwright matches the most recently added handler first).
 */
function record(key: string, map: string, code?: string) {
  return {
    match_key: key,
    source_files: [`${key}.png`],
    data: {
      map, playlist: 'competitive', hero: 'ana', result: 'victory',
      date: '2026-08-18', finished_at: '20:10', eliminations: 20, assists: 4, deaths: 5,
    },
    parsed_at: '2026-08-18T20:15:00Z',
    ...(code === undefined ? {} : { annotation: { replay_code: code } }),
  }
}

async function seedWithOneCode(page: Page): Promise<void> {
  await page.route('**/api/v1/matches', async (route: Route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback()
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        record('match-2026-08-18T20-10-00', 'dorado', 'A1B2C3'),
        record('match-2026-08-18T21-44-00', 'ilios'),
      ]),
    })
  })
}

test.describe('sending matches to a coach', () => {
  test.beforeEach(async ({ page }) => {
    await silenceParseEvents(page)
    await seedProfiles(page)
    await seedCoachOwnMatches(page)
  })

  test('names every match going out, and which of them blocks the send', async ({ page }) => {
    await page.goto('/')
    await reviewsTab(page).click()
    await page.getByRole('button', { name: /Send to a coach…/ }).click()

    await expect(dialog(page)).toBeVisible()
    await expect(rows(page)).toHaveCount(2)
    // Named, not counted — that is the whole difference from the old red box.
    await expect(rows(page).nth(0)).toContainText('dorado')
    await expect(rows(page).nth(0)).toContainText('no replay code')
    await expect(dialog(page).getByText('2 matches · 2 need a replay code')).toBeVisible()
  })

  test('the gap has a door, not just an instruction', async ({ page }) => {
    await page.goto('/')
    await reviewsTab(page).click()
    await page.getByRole('button', { name: /Send to a coach…/ }).click()
    await dialog(page).getByRole('button', { name: /Show the 2 on Matches/ }).click()

    // It lands on the rows that need fixing, and gets out of the way.
    await expect(matchesTab(page)).toHaveAttribute('aria-selected', 'true')
    await expect(dialog(page)).toHaveCount(0)
  })

  // The fix box is the sanctioned remediation path, and the message field
  // sits above it — so the natural order is: type, discover the block, take
  // the door, fix, come back. The words must still be there.
  test('the typed message and handle survive the fix round-trip', async ({ page }) => {
    await page.goto('/')
    await reviewsTab(page).click()
    await page.getByRole('button', { name: /Send to a coach…/ }).click()

    await dialog(page).getByRole('textbox', { name: /Your handle/ }).fill('Sable#1234')
    await dialog(page).getByRole('textbox', { name: /Message for your coach/ })
      .fill('Look at my ult timing on the Dorado loss.')
    await dialog(page).getByRole('button', { name: /Show the 2 on Matches/ }).click()
    await expect(matchesTab(page)).toHaveAttribute('aria-selected', 'true')

    await reviewsTab(page).click()
    await page.getByRole('button', { name: /Send to a coach…/ }).click()
    await expect(dialog(page).getByRole('textbox', { name: /Your handle/ })).toHaveValue('Sable#1234')
    await expect(dialog(page).getByRole('textbox', { name: /Message for your coach/ }))
      .toHaveValue('Look at my ult timing on the Dorado loss.')

    // An explicit Cancel is a decision — the draft goes with it.
    await dialog(page).getByRole('button', { name: 'Cancel' }).click()
    await page.getByRole('button', { name: /Send to a coach…/ }).click()
    await expect(dialog(page).getByRole('textbox', { name: /Your handle/ })).not.toHaveValue('Sable#1234')
  })

  // The manifest exists so the player sees exactly what is going to another
  // human BEFORE pressing Send; the pinned-actions design guarantees a cut
  // at some height, so the cut must be visible.
  test('a cut-off manifest says there is more below the fold', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 560 })
    await page.goto('/')
    await reviewsTab(page).click()
    await page.getByRole('button', { name: /Send to a coach…/ }).click()

    const cue = dialog(page).locator('.send-to-coach-scroll-cue')
    await expect(cue).toBeVisible()

    // Scrolled to the end, nothing is hidden and the cue stands down.
    await dialog(page).locator('.sheet-body').evaluate((el) => {
      el.scrollTop = el.scrollHeight
    })
    await expect(cue).toBeHidden()
  })

  test('a match with a code reads as ready', async ({ page }) => {
    await seedWithOneCode(page)
    await page.goto('/')
    await reviewsTab(page).click()
    await page.getByRole('button', { name: /Send to a coach…/ }).click()

    await expect(dialog(page).getByText('2 matches · 1 needs a replay code')).toBeVisible()
    await expect(rows(page).filter({ hasText: 'A1B2C3' })).toHaveCount(1)
  })

  // The bulk bar and the row menu are the two doors on Matches itself.
  test('the bulk bar sends the ticked rows', async ({ page }) => {
    await page.goto('/')
    await matchesTab(page).click()
    await expect(page.locator('.leaf-row')).toHaveCount(2)
    await page.locator('.leaf-row').nth(0).locator('.leaf-checkbox').click()
    await page.getByTestId('bulk-send-to-coach').click()

    await expect(dialog(page)).toBeVisible()
    await expect(dialog(page).getByText('1 match you ticked')).toBeVisible()
    await expect(rows(page)).toHaveCount(1)
  })

  test('the row menu sends just that match', async ({ page }) => {
    await page.goto('/')
    await matchesTab(page).click()
    await expect(page.locator('.leaf-row')).toHaveCount(2)
    await page.locator('.leaf-row').nth(1).click({ button: 'right' })
    await page.locator('[data-row-ctx-send-coach]').click()

    await expect(dialog(page)).toBeVisible()
    await expect(dialog(page).getByText('This match')).toBeVisible()
    await expect(rows(page)).toHaveCount(1)
  })

  test('the toolbar sends everything showing, and says so before the click', async ({ page }) => {
    await page.goto('/')
    await matchesTab(page).click()
    const toolbarBtn = page.locator('[data-send-to-coach]')
    await expect(toolbarBtn).toContainText('Send 2 to a coach…')
    await toolbarBtn.click()

    await expect(dialog(page).getByText('2 matches — everything showing on Matches')).toBeVisible()
  })

  test('sends the share block, and the sent ledger updates without a reload', async ({ page }) => {
    const posted = routeCapture<{
      match_keys?: string[]
      include_hidden?: boolean
      include_unknown?: boolean
      share?: { handle?: string; message?: string }
    }>('send-to-coach POST body')

    await seedWithOneCode(page)
    let shares: unknown[] = []
    await page.route('**/api/v1/shares', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(shares),
      })
    })
    await page.route('**/api/v1/exports/bundle', async (route: Route) => {
      posted.set(JSON.parse(route.request().postData() ?? '{}'))
      shares = [{
        id: 1, handle: 'Sable', message: 'ult timing',
        exported_at: new Date().toISOString(), match_keys: ['k'],
      }]
      await route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': 'attachment; filename="recall-share-test.zip"',
        },
        body: Buffer.from([0x50, 0x4b, 0x05, 0x06, ...Array<number>(18).fill(0)]),
      })
    })

    await page.goto('/')
    await matchesTab(page).click()
    await expect(page.locator('.leaf-row')).toHaveCount(2)
    // Only the one carrying a code, so the send is not refused.
    await page.locator('.leaf-row').nth(0).locator('.leaf-checkbox').click()
    await page.getByTestId('bulk-send-to-coach').click()

    await dialog(page).getByLabel('Your handle (required)').fill('Sable')
    await dialog(page).getByLabel(/Message for your coach/).fill('ult timing')
    await dialog(page).getByTestId('send-to-coach-submit').click()

    await expect.poll(() => posted.seen()).toBe(true)
    const body = posted.get()
    expect(body.share).toEqual({ handle: 'Sable', message: 'ult timing' })
    // Never a toggled-in extra: the server's replay gate only validates the
    // explicit keys, so a hidden match swept in would bypass it entirely.
    expect(body.include_hidden).toBe(false)
    expect(body.include_unknown).toBe(false)

    // The sent ledger is Reviews-tab-gated with staleTime Infinity, so
    // without an invalidation this row would not appear until a restart.
    await reviewsTab(page).click()
    await expect(page.locator('#panel-reviews').getByText(/Sent 1 match/)).toBeVisible()
  })
})
