/**
 * Two consistency contracts pinned by this spec:
 *
 *   1. Sync bug — when the leaf row shows "Competitive" (via the
 *      data.mode OCR fallback) but the play_mode override is empty,
 *      opening the detail panel auto-writes the override so the
 *      chooser, the leaf chip, and every downstream slice (filters,
 *      bulk-set, widgets) all agree. Fires once per match.
 *
 *   2. Unknown filter chips — the narrow popover's Queue and Play
 *      mode sections gain an "Unknown mode (type)" chip that filters
 *      to matches whose leaf chip reads "Unknown mode (type)"; the
 *      Quickplay / Competitive chips now match the same OCR-fallback
 *      buckets the leaf shows, so what you see is what you filter.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

type Match = {
  match_key: string
  source_files: string[]
  source_types: Record<string, string>
  play_mode?: 'quickplay' | 'competitive'
  queue_type?: 'role' | 'open'
  data: Record<string, unknown>
  parsed_at: string
}

function rec(
  matchKey: string,
  opts: { playMode?: 'quickplay' | 'competitive'; queueType?: 'role' | 'open'; dataMode?: string },
): Match {
  const m: Match = {
    match_key:    matchKey,
    source_files: [`${matchKey}.png`],
    source_types: { [`${matchKey}.png`]: 'summary' },
    data: {
      map:           'rialto',
      type:          'control',
      hero:          'lucio',
      result:        'victory',
      date:          '2026-05-10',
      finished_at:   '22:00',
      eliminations:  10,
      assists:       5,
      deaths:        3,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '5:00' }],
    },
    parsed_at: '2026-05-10T22:30:00Z',
  }
  if (opts.dataMode) (m.data as Record<string, unknown>).mode = opts.dataMode
  if (opts.playMode) m.play_mode = opts.playMode
  if (opts.queueType) m.queue_type = opts.queueType
  return m
}

test.describe('Matches — auto-sync + Unknown filter chips', () => {
  test('opening the detail panel auto-writes play_mode from data.mode', async ({ page }) => {
    // Match shows "Competitive" on the leaf via the OCR fallback;
    // play_mode override is empty. Opening the detail panel should
    // PUT the override so the chooser shows Competitive picked AND
    // the persisted state matches the displayed value.
    const matches = [rec('k1', { dataMode: 'competitive' })]
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(matches),
      })
    })

    // Capture the PUT the detail panel should fire on open.
    let put: { body: unknown } | null = null
    await page.route('**/api/v1/matches/*/play-mode', async (route: Route) => {
      put = { body: await route.request().postDataJSON() }
      await route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/')
    await expect(page.locator('#panel-matches')).toBeVisible()
    await expect(page.locator('.leaf-mode-chip').first()).toHaveText('Competitive')

    // Open the detail panel by clicking the row.
    await page.locator('[data-match-key="k1"]').click()
    await expect(page.locator('[role="dialog"]').first()).toBeVisible()

    // The auto-write fires on mount.
    await expect.poll(() => put).not.toBeNull()
    expect(put!.body).toEqual({ play_mode: 'competitive' })
  })

  test('Unknown filter chip narrows to matches with truly-unset play mode', async ({ page }) => {
    // Three rows: one Competitive via OCR fallback, one Quickplay via
    // override, one truly Unknown (no override, no OCR). Picking the
    // Unknown chip should leave only the truly-unset row.
    const matches = [
      rec('a-comp',  { dataMode: 'competitive' }),
      rec('b-quick', { playMode: 'quickplay' }),
      rec('c-none',  {}),
    ]
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(matches),
      })
    })

    await page.goto('/')
    await expect(page.locator('#panel-matches')).toBeVisible()
    await expect(page.locator('[data-match-key]')).toHaveCount(3)

    // Open the narrow popover and pick the new Unknown chip.
    await page.locator('[data-narrow-trigger]').click()
    await page.locator('button[data-play-mode="unknown"]').click()
    await page.keyboard.press('Escape')

    // Only the truly-unset match survives.
    await expect(page.locator('[data-match-key]')).toHaveCount(1)
    await expect(page.locator('[data-match-key="c-none"]')).toBeVisible()
  })

  test('Competitive filter chip matches OCR-fallback rows (leaf <-> filter agree)', async ({ page }) => {
    // The leaf shows "Competitive" for an OCR-derived row even when
    // play_mode is empty; the filter must match the same row when
    // picking "Competitive". Pre-fix, the predicate read play_mode
    // directly and silently dropped OCR-fallback rows.
    const matches = [
      rec('comp-ocr',      { dataMode: 'competitive' }),
      rec('comp-override', { playMode: 'competitive' }),
      rec('quick-override',{ playMode: 'quickplay' }),
    ]
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(matches),
      })
    })
    // Swallow the auto-write that fires when the dossier code paths
    // resolve the OCR-fallback row.
    await page.route('**/api/v1/matches/*/play-mode', (route: Route) => route.fulfill({ status: 204, body: '' }))

    await page.goto('/')
    await expect(page.locator('#panel-matches')).toBeVisible()

    await page.locator('[data-narrow-trigger]').click()
    await page.locator('button[data-play-mode="competitive"]').click()
    await page.keyboard.press('Escape')

    await expect(page.locator('[data-match-key]')).toHaveCount(2)
    await expect(page.locator('[data-match-key="comp-ocr"]')).toBeVisible()
    await expect(page.locator('[data-match-key="comp-override"]')).toBeVisible()
  })

  test('Unknown mode type filter chip narrows to truly-unset queue rows', async ({ page }) => {
    const matches = [
      rec('role-q',    { queueType: 'role' }),
      rec('open-q',    { queueType: 'open' }),
      rec('no-queue',  {}),
    ]
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(matches),
      })
    })

    await page.goto('/')
    await expect(page.locator('#panel-matches')).toBeVisible()

    await page.locator('[data-narrow-trigger]').click()
    await page.locator('button[data-queue-type="unknown"]').click()
    await page.keyboard.press('Escape')

    await expect(page.locator('[data-match-key]')).toHaveCount(1)
    await expect(page.locator('[data-match-key="no-queue"]')).toBeVisible()
  })
})
