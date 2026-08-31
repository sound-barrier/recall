/**
 * Unknown tab — Dismiss on every card.
 *
 * Two-click confirm pattern (mirrors DashboardEditBanner's Reset):
 *   - first click arms the button to "Confirm dismiss?" + red fill
 *   - second click within 3 s fires PUT /api/v1/screenshots/{file}/ignore
 *     for EVERY file the card carries → 204s + records reload
 *   - first-click-only (no second) auto-disarms after 3 s
 *
 * Backend semantics: each file joins the suppress-list and only its own
 * rows are wiped — a match this card's files were the last backing of
 * disappears; the on-disk files stay put. The ambiguous "Needs your
 * review" cards carry the same affordance (dismissing junk the resolver
 * keeps asking about), not just the unmatched ones.
 */
import type { Route } from '@playwright/test'

import { test, expect } from '../_fixtures'

const FILENAME = 'broken.png'
const MATCH_KEY = `unmatched-${FILENAME}`

const unknownRecord = () => ({
  match_key: MATCH_KEY,
  source_files: [FILENAME],
  source_types: { [FILENAME]: 'unknown' },
  source_dir_ids: { [FILENAME]: 0 },
  data: {},
  parsed_at: '2026-05-10T21:00:00Z',
})

test.describe('Unknown tab — Dismiss', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
  })

  test('two-click confirm PUTs to /screenshots/{file}/ignore and the card disappears', async ({ page }) => {
    let ignoreHits = 0
    let ignored = false

    await page.route('**/api/v1/matches', async (route: Route) => {
      // After the ignore lands the backend wipes the row; surface
      // an empty list on the subsequent refetch so the card
      // disappears.
      const body = ignored ? [] : [unknownRecord()]
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      })
    })
    await page.route(`**/api/v1/screenshots/${FILENAME}/ignore`, async (route: Route) => {
      ignoreHits++
      ignored = true
      await route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/')
    await page.getByRole('tab', { name: /^Unknown/ }).click()

    const card = page.locator('.unknown-card').first()
    await expect(card).toBeVisible()
    // Expand the card so the destructive zone is reachable.
    await card.locator('.unknown-card-head').click()

    const btn = page.locator(`[data-ignore-btn="${MATCH_KEY}"]`)
    await expect(btn).toHaveText(/Dismiss/i)

    // First click arms.
    await btn.click()
    await expect(btn).toHaveText(/Confirm dismiss\?/i)
    await expect(btn).toHaveClass(/armed/)
    // No PUT yet.
    expect(ignoreHits).toBe(0)

    // Second click commits.
    await btn.click()
    await expect.poll(() => ignoreHits).toBe(1)

    // Records refetch → empty list → card gone.
    await expect(page.locator('.unknown-card')).toHaveCount(0)
  })

  // A card is dismissed whole: every source file it carries joins the
  // suppress-list, not just the first. Pre-fix, a two-screenshot card
  // ignored only file[0] — the second file still backed the match, so
  // the user confirmed a dismiss and the card came straight back.
  test('a multi-file card dismisses every source file', async ({ page }) => {
    const FILES = ['first.png', 'second.png']
    const KEY = 'match-2026-05-10T22-21-11'
    const hits: string[] = []
    let ignored = false

    await page.route('**/api/v1/matches', async (route: Route) => {
      const body = ignored ? [] : [{
        match_key: KEY,
        source_files: FILES,
        source_types: { [FILES[0] ?? '']: 'summary', [FILES[1] ?? '']: 'teams' },
        source_dir_ids: {},
        data: { playlist: 'competitive' },
        parsed_at: '2026-05-10T22:21:11Z',
      }]
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    })
    for (const f of FILES) {
      await page.route(`**/api/v1/screenshots/${f}/ignore`, async (route: Route) => {
        hits.push(f)
        if (hits.length === FILES.length) ignored = true
        await route.fulfill({ status: 204, body: '' })
      })
    }

    await page.goto('/')
    await page.getByRole('tab', { name: /^Unknown/ }).click()
    await page.locator('.unknown-card .unknown-card-head').first().click()

    const btn = page.locator(`[data-ignore-btn="${KEY}"]`)
    await btn.click()
    await expect(btn).toHaveText(/Confirm dismiss\?/i)
    await btn.click()

    await expect.poll(() => hits.length).toBe(2)
    expect(hits).toEqual(FILES)
    await expect(page.locator('.unknown-card')).toHaveCount(0)
  })

  // The ambiguous "Needs your review" section carries Dismiss too — a
  // junk screenshot the resolver keeps offering candidates for should be
  // dismissible right there, not by resolving it into a match first.
  test('an ambiguous card can be dismissed from its expanded zone', async ({ page }) => {
    const FILE = 'pending.png'
    const KEY = 'ambiguous-cGVuZGluZy5wbmc'
    let ignoreHits = 0
    let ignored = false

    await page.route('**/api/v1/matches', async (route: Route) => {
      const body = ignored ? [] : [{
        match_key: KEY,
        source_files: [FILE],
        source_types: { [FILE]: 'unknown' },
        source_dir_ids: { [FILE]: 0 },
        data: {},
        ambiguous: true,
        candidates: [{
          match_key: 'match-2026-05-10T21-00-00',
          distance_seconds: 90,
          reason: 'close in time',
        }],
        parsed_at: '2026-05-10T21:02:00Z',
      }]
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    })
    await page.route(`**/api/v1/screenshots/${FILE}/ignore`, async (route: Route) => {
      ignoreHits++
      ignored = true
      await route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/')
    await page.getByRole('tab', { name: /^Unknown/ }).click()

    const card = page.locator('.ambiguous-card').first()
    await expect(card).toBeVisible()
    await card.locator('.unknown-card-head').click()

    const btn = page.locator(`[data-ignore-btn="${KEY}"]`)
    await expect(btn).toHaveText(/Dismiss/i)
    await btn.click()
    await expect(btn).toHaveText(/Confirm dismiss\?/i)
    await btn.click()

    await expect.poll(() => ignoreHits).toBe(1)
    await expect(page.locator('.ambiguous-card')).toHaveCount(0)
  })

  // A partial failure mid-loop surfaces the error banner AND still
  // refetches — the card shrinks to its surviving files, and clicking
  // Dismiss again is a clean retry (already-ignored files are no-ops).
  test('a mid-loop failure shows the error banner and still refetches', async ({ page }) => {
    const FILES = ['ok.png', 'boom.png']
    const KEY = 'match-2026-05-11T10-00-00'
    let matchesFetches = 0

    await page.route('**/api/v1/matches', async (route: Route) => {
      matchesFetches++
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([{
          match_key: KEY,
          source_files: FILES,
          source_types: {},
          source_dir_ids: {},
          data: {},
          parsed_at: '2026-05-11T10:00:00Z',
        }]),
      })
    })
    await page.route('**/api/v1/screenshots/ok.png/ignore', async (route: Route) => {
      await route.fulfill({ status: 204, body: '' })
    })
    await page.route('**/api/v1/screenshots/boom.png/ignore', async (route: Route) => {
      await route.fulfill({
        status: 500, contentType: 'application/problem+json',
        body: JSON.stringify({ title: 'store exploded' }),
      })
    })

    await page.goto('/')
    await page.getByRole('tab', { name: /^Unknown/ }).click()
    const fetchesBeforeDismiss = matchesFetches
    await page.locator('.unknown-card .unknown-card-head').first().click()

    const btn = page.locator(`[data-ignore-btn="${KEY}"]`)
    await btn.click()
    await btn.click()

    // The failure surfaces in the app's error banner…
    await expect(page.getByRole('alert')).toBeVisible()
    // …and the reload still happened (self-healing refetch).
    await expect.poll(() => matchesFetches).toBeGreaterThan(fetchesBeforeDismiss)
  })

  test('auto-disarms after 3 s without a second click', async ({ page }) => {
    let ignoreHits = 0

    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([unknownRecord()]),
      })
    })
    await page.route(`**/api/v1/screenshots/${FILENAME}/ignore`, async (route: Route) => {
      ignoreHits++
      await route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/')
    await page.getByRole('tab', { name: /^Unknown/ }).click()

    await page.locator('.unknown-card .unknown-card-head').first().click()
    const btn = page.locator(`[data-ignore-btn="${MATCH_KEY}"]`)

    await btn.click()
    await expect(btn).toHaveText(/Confirm dismiss\?/i)

    // Wait past the 3 s auto-disarm window.
    await page.waitForTimeout(3200)
    await expect(btn).toHaveText(/^Dismiss$/i)
    // No PUT fired during the wait.
    expect(ignoreHits).toBe(0)
  })
})
