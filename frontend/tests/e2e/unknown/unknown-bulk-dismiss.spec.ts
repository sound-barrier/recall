/**
 * Unknown tab — bulk dismiss.
 *
 * The post-import cleanup spree: a folder of desktop screenshots landed in
 * the queue and every one of them needs the same verdict. Dismissing them
 * one card at a time is two clicks each, and the per-card confirm makes it
 * four.
 *
 * The affordance is the checkbox on each row (the Gmail / Linear shape the
 * matches list already uses) — no bulk-mode toggle. A contextual bar appears
 * while a section has anything ticked, and its Dismiss carries the same
 * two-click confirm the per-card button does, because it is the same
 * irreversible verdict applied wider.
 *
 * Selection is PER SECTION. The three dismissable sections key differently —
 * unmatched and ambiguous cards on match_key, failed rows on filename — and
 * a card is dismissed whole, so the bar counts both the rows ticked and the
 * screenshots that will actually be suppressed.
 */
import type { Route } from '@playwright/test'

import { test, expect } from '../_fixtures'

const card = (key: string, files: string[]) => ({
  match_key: key,
  source_files: files,
  source_types: Object.fromEntries(files.map((f) => [f, 'unknown'])),
  source_dir_ids: Object.fromEntries(files.map((f) => [f, 0])),
  data: {},
  parsed_at: '2026-05-10T21:00:00Z',
})

test.describe('Unknown tab — bulk dismiss', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
  })

  test('ticking rows raises a bar that dismisses every file behind them', async ({ page }) => {
    const ignored: string[] = []
    // Three cards, the middle one carrying two screenshots — so "2 cards"
    // and "3 screenshots" are different numbers and the bar has to say both.
    const cards = [
      card('unmatched-a.png', ['a.png']),
      card('match-2026-05-10T21-30-00', ['b1.png', 'b2.png']),
      card('unmatched-c.png', ['c.png']),
    ]

    await page.route('**/api/v1/matches', async (route: Route) => {
      const live = cards.filter((c) => !c.source_files.every((f) => ignored.includes(f)))
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(live) })
    })
    await page.route('**/api/v1/screenshots/*/ignore', async (route: Route) => {
      const m = /screenshots\/([^/]+)\/ignore/.exec(route.request().url())
      if (m?.[1]) ignored.push(decodeURIComponent(m[1]))
      await route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/')
    await page.getByRole('tab', { name: /^Unknown/ }).click()
    await expect(page.locator('.unknown-card')).toHaveCount(3)

    // Nothing ticked — no bar.
    await expect(page.getByRole('button', { name: /^Dismiss \d+ card/ })).toHaveCount(0)

    await page.getByRole('checkbox', { name: 'Select a.png' }).click()
    await page.getByRole('checkbox', { name: /^Select match-2026-05-10T21-30-00/ }).click()

    // The bar names BOTH counts: what was ticked, and what actually goes.
    const bulk = page.getByRole('button', { name: /^Dismiss 2 cards \(3 screenshots\)$/ })
    await expect(bulk).toBeVisible()

    // First click arms, and fires nothing.
    await bulk.click()
    await expect(page.getByRole('button', { name: /^Confirm dismissing 2 cards \(3 screenshots\)\?$/ })).toBeVisible()
    expect(ignored).toEqual([])

    // Second click commits every file behind every ticked card.
    await page.getByRole('button', { name: /^Confirm dismissing 2 cards \(3 screenshots\)\?$/ }).click()
    await expect.poll(() => ignored.length).toBe(3)
    expect([...ignored].sort()).toEqual(['a.png', 'b1.png', 'b2.png'])

    // The untouched card survives, and the bar is gone with the selection.
    await expect(page.locator('.unknown-card')).toHaveCount(1)
    await expect(page.getByRole('button', { name: /^Dismiss \d+ card/ })).toHaveCount(0)
  })

  test('changing the selection disarms a pending confirm', async ({ page }) => {
    // The armed confirm was for a different set of files. Carrying it across
    // a selection change would dismiss something the user never confirmed.
    const cards = [card('unmatched-a.png', ['a.png']), card('unmatched-c.png', ['c.png'])]
    const ignored: string[] = []

    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cards) })
    })
    await page.route('**/api/v1/screenshots/*/ignore', async (route: Route) => {
      ignored.push(route.request().url())
      await route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/')
    await page.getByRole('tab', { name: /^Unknown/ }).click()
    await page.getByRole('checkbox', { name: 'Select a.png' }).click()
    await page.getByRole('button', { name: /^Dismiss 1 card/ }).click()
    await expect(page.getByRole('button', { name: /^Confirm dismissing 1 card/ })).toBeVisible()

    // Tick another row — the confirm must fall back to an unarmed Dismiss.
    await page.getByRole('checkbox', { name: 'Select c.png' }).click()
    await expect(page.getByRole('button', { name: /^Dismiss 2 cards \(2 screenshots\)$/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Confirm dismissing/ })).toHaveCount(0)
    expect(ignored).toEqual([])
  })

  test('failed rows select and dismiss on their own, keyed by filename', async ({ page }) => {
    // Failed rows have no match_key at all; the section keys on filename.
    // Its selection is separate from the card sections' — ticking here must
    // not raise a bar over there.
    const ignored: string[] = []
    let ignoredOnce = false

    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([card('unmatched-a.png', ['a.png'])]),
      })
    })
    await page.route('**/api/v1/screenshots/failed', async (route: Route) => {
      const rows = ignoredOnce ? [] : [
        { filename: 'junk1.png', error: 'no text found', attempts: 3, parked: true },
        { filename: 'junk2.png', error: 'no text found', attempts: 3, parked: true },
      ]
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) })
    })
    await page.route('**/api/v1/screenshots/*/ignore', async (route: Route) => {
      const m = /screenshots\/([^/]+)\/ignore/.exec(route.request().url())
      if (m?.[1]) ignored.push(decodeURIComponent(m[1]))
      if (ignored.length === 2) ignoredOnce = true
      await route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/')
    await page.getByRole('tab', { name: /^Unknown/ }).click()

    await page.getByRole('checkbox', { name: 'Select junk1.png' }).click()
    await page.getByRole('checkbox', { name: 'Select junk2.png' }).click()

    // A failed row is one file, so rows and screenshots agree — the bar says
    // it once rather than repeating the same number twice.
    const bulk = page.getByRole('button', { name: /^Dismiss 2 screenshots$/ })
    await expect(bulk).toBeVisible()
    await bulk.click()
    await page.getByRole('button', { name: /^Confirm dismissing 2 screenshots\?$/ }).click()

    await expect.poll(() => ignored.length).toBe(2)
    expect([...ignored].sort()).toEqual(['junk1.png', 'junk2.png'])
  })

  test('select-all ticks only the rows in that section', async ({ page }) => {
    const ignored: string[] = []
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([card('unmatched-a.png', ['a.png']), card('unmatched-c.png', ['c.png'])]),
      })
    })
    await page.route('**/api/v1/screenshots/failed', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([{ filename: 'junk1.png', error: 'x', attempts: 3, parked: true }]),
      })
    })
    await page.route('**/api/v1/screenshots/*/ignore', async (route: Route) => {
      ignored.push(route.request().url())
      await route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/')
    await page.getByRole('tab', { name: /^Unknown/ }).click()

    // Tick one unmatched card so the section's bar (and its Select all) appears.
    await page.getByRole('checkbox', { name: 'Select a.png' }).click()
    await page.getByRole('button', { name: 'Select all unmatched' }).click()

    await expect(page.getByRole('button', { name: /^Dismiss 2 cards \(2 screenshots\)$/ })).toBeVisible()
    // The failed row was not swept in.
    await expect(page.getByRole('checkbox', { name: 'Select junk1.png' })).not.toBeChecked()
  })

  // NOTE: there is deliberately no write-gate case here. While a coaching
  // session is open the Unknown tab renders nothing at all — the records on
  // screen are the coach's loaned corpus, so there is no card, no checkbox,
  // and no per-card Dismiss either. The checkbox still disables on the gate as
  // defense in depth; that is asserted in UnknownBulkBar.test.ts, where the
  // locked state can actually be reached.
})

test.describe('Unknown tab — bulk dismiss on the ambiguous section', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
  })

  // The three dismissable sections carry the same verb, so they carry the
  // same bulk affordance — a tab where two of three sections can be swept
  // reads as a bug, not as a decision.
  test('ambiguous cards tick and dismiss as their own section', async ({ page }) => {
    const ignored: string[] = []
    let ignoredOnce = false
    const ambiguous = (file: string) => ({
      match_key: `ambiguous-${file}`,
      source_files: [file],
      source_types: { [file]: 'unknown' },
      source_dir_ids: { [file]: 0 },
      data: {},
      ambiguous: true,
      candidates: [{ match_key: 'match-2026-05-10T21-00-00', distance_seconds: 90, reason: 'close in time' }],
      parsed_at: '2026-05-10T21:02:00Z',
    })

    await page.route('**/api/v1/matches', async (route: Route) => {
      const body = ignoredOnce ? [] : [ambiguous('p1.png'), ambiguous('p2.png')]
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    })
    await page.route('**/api/v1/screenshots/*/ignore', async (route: Route) => {
      const m = /screenshots\/([^/]+)\/ignore/.exec(route.request().url())
      if (m?.[1]) ignored.push(decodeURIComponent(m[1]))
      if (ignored.length === 2) ignoredOnce = true
      await route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/')
    await page.getByRole('tab', { name: /^Unknown/ }).click()
    await expect(page.locator('.ambiguous-card')).toHaveCount(2)

    await page.getByRole('checkbox', { name: 'Select p1.png' }).click()
    await page.getByRole('button', { name: 'Select all needing review' }).click()

    const bulk = page.getByRole('button', { name: /^Dismiss 2 cards \(2 screenshots\)$/ })
    await bulk.click()
    await page.getByRole('button', { name: /^Confirm dismissing 2 cards \(2 screenshots\)\?$/ }).click()

    await expect.poll(() => ignored.length).toBe(2)
    expect([...ignored].sort()).toEqual(['p1.png', 'p2.png'])
    await expect(page.locator('.ambiguous-card')).toHaveCount(0)
  })
})
