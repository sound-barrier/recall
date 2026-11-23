/**
 * Match detail — the source crop beside each read value.
 *
 * Every read stat gets a "Show source" disclosure. Its first opening asks
 * GET /matches/{key}/field-regions where on the match's own screenshots each
 * field was read — not the panel opening, since paging through matches would
 * ask once per match for crops nobody looked at. The crop is the screenshot
 * from the same /_screenshot/ URL the match already uses, clipped to that
 * rectangle, captioned with the screen it was cut from: a field read on two
 * screens shows two crops, and each says which.
 *
 * A stat the cross-check flagged is left out of every stat until the player
 * reviews it, but the detail still shows what was READ, marked "Left out of
 * stats — needs review", with a way to the Unknown tab's review. A flagged
 * E/A/D leaves its whole line out, so the siblings are marked too.
 *
 * A coaching session loans records, never files: the regions name the
 * player's screenshots, which are not on the coach's disk, so the detail
 * offers no source and never asks for one.
 */
import type { Page, Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

import { test, expect } from '../_fixtures'
import {
  enterFilmRoom,
  loanSlip,
  mockCoachSession,
  openSessionViaReviewsTab,
  seedCoachOwnMatches,
} from '../_coach'
import { seedProfiles, silenceParseEvents } from '../_theme-matrix'

const KEY = 'match-2026-06-07T23-00-04'
const FILE = 'ScreenShot_26-06-07_23-00-04-000.jpg'
const TEAMS_FILE = 'ScreenShot_26-06-07_23-00-09-000.jpg'

const STUB_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const RECORD = {
  match_key: KEY,
  source_files: [FILE, TEAMS_FILE],
  source_types: { [FILE]: 'summary', [TEAMS_FILE]: 'teams' },
  source_dir_ids: {},
  data: {
    map: 'rialto', playlist: 'competitive', game_mode: 'control', role: 'support', hero: 'lucio',
    result: 'victory', date: '2026-06-07', finished_at: '23:00',
    eliminations: 74, assists: 9, deaths: 6, damage: 7200, healing: 9100,
    heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '06:56' }],
  },
  edited_fields: [],
  field_flags: [{
    field: 'data.eliminations',
    value: '74',
    checks: ['perf_total_vs_rate', 'source_disagreement'],
    state: 'open',
    readings: [
      { source_file: FILE, origin: 'ocr', value: '74' },
      { source_file: FILE, origin: 'derived', value: '9' },
      { source_file: TEAMS_FILE, origin: 'ocr', value: '9' },
    ],
  }],
  parsed_at: '2026-06-07T23:05:00Z',
}

const region = (field: string, x: number, file = FILE) => ({
  source_file: file, dir_id: 0, field,
  x, y: 318, width: 64, height: 36, image_width: 1920, image_height: 1080,
})

/** Serves the one flagged match, its regions and its screenshot; returns the regions request count. */
async function serve(page: Page): Promise<() => number> {
  let regionRequests = 0
  await page.route('**/api/v1/matches', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([RECORD]) })
  })
  await page.route(`**/api/v1/matches/${KEY}/field-regions`, async (route: Route) => {
    regionRequests++
    const body = {
      regions: [region('data.eliminations', 412), region('data.damage', 980), region('data.eliminations', 1210, TEAMS_FILE)],
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.route('**/_screenshot/**', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'image/png', body: STUB_PNG })
  })
  return () => regionRequests
}

async function openMatch(page: Page) {
  await page.goto('/')
  await page.getByRole('tab', { name: /^Matches/ }).click()
  await page.locator('.leaf-row').first().click()
  const panel = page.locator('aside.detail-panel')
  await expect(panel).toBeVisible()
  return panel
}

test.describe('match detail — the source crop beside each read value', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
  })

  test('"Show source" asks where the value was read and reveals the crop', async ({ page }) => {
    const regionRequests = await serve(page)
    const panel = await openMatch(page)

    const toggle = panel.getByRole('button', { name: 'Show source of Damage' })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(regionRequests(), 'field-regions requests before any source is opened').toBe(0)
    await expect(panel.getByRole('img', { name: `Source crop of Damage from ${FILE}` })).toHaveCount(0)

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(panel.getByRole('img', { name: `Source crop of Damage from ${FILE}` })).toBeVisible()
    await expect(panel.getByRole('figure', { name: 'SUMMARY' })).toBeVisible()
    expect(regionRequests()).toBe(1)

    // A stat that was never read has no source to show; one read without a
    // recorded region says so.
    await expect(panel.getByRole('button', { name: 'Show source of Mitigation' })).toHaveCount(0)
    await panel.getByRole('button', { name: 'Show source of Healing' }).click()
    await expect(panel.getByText(/^No crop recorded for this value/)).toBeVisible()

    const results = await new AxeBuilder({ page })
      .include('aside.detail-panel')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    expect(results.violations).toEqual([])
  })

  test('a flagged stat shows what was read, marked as left out, with a way to its review', async ({ page }) => {
    await serve(page)
    const panel = await openMatch(page)

    // The stats leave the 74 out; the detail still shows what was read.
    await expect(panel.getByRole('button', { name: /^Elims: 74\. Click to edit\./ })).toBeVisible()
    await expect(panel.getByText('Left out of stats — needs review')).toBeVisible()
    await expect(panel.getByText('Left out of stats — needs review')).toHaveCount(1)
    // Its line is left out with it, and the siblings say whose review that waits on.
    await expect(panel.getByRole('button', { name: /^Assists: 9\./ }))
      .toHaveAccessibleDescription('Left out of stats — Eliminations needs review')
    await expect(panel.getByRole('button', { name: /^Deaths: 6\./ }))
      .toHaveAccessibleDescription('Left out of stats — Eliminations needs review')
    await expect(panel.getByRole('button', { name: /^Review / })).toHaveCount(1)

    // Read on two screens, it shows two crops — each saying which screen, and what it read there.
    await panel.getByRole('button', { name: 'Show source of Elims' }).click()
    await expect(panel.getByRole('figure', { name: 'SUMMARY · read 74' })
      .getByRole('img', { name: `Source crop of Elims from ${FILE}` })).toBeVisible()
    await expect(panel.getByRole('figure', { name: 'TEAMS · read 9' })
      .getByRole('img', { name: `Source crop of Elims from ${TEAMS_FILE}` })).toBeVisible()

    await panel.getByRole('button', { name: 'Review Elims in Unknown' }).click()
    await expect(page.getByRole('tab', { name: /^Unknown/ })).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('#section-field-flags')).toBeVisible()
  })

  test('a coaching session offers no source and never asks for regions', async ({ page }) => {
    let regionRequests = 0
    await silenceParseEvents(page)
    await seedProfiles(page)
    await seedCoachOwnMatches(page)
    await mockCoachSession(page)
    // Answers with a region for any key, so a gate that let a request or a
    // cached copy through would put a "Show source" on the loaned stat.
    await page.route('**/api/v1/matches/*/field-regions', async (route: Route) => {
      regionRequests++
      const body = { regions: [region('data.healing', 980)] }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    })
    await page.goto('/')
    await openSessionViaReviewsTab(page)
    await expect(loanSlip(page)).toBeVisible()
    await enterFilmRoom(page)

    await page.getByRole('tab', { name: /^Matches/ }).click()
    await page.locator('.leaf-row', { hasText: /king's row/i }).click()
    const panel = page.locator('aside.detail-panel')
    await expect(panel).toBeVisible()
    await expect(panel.getByRole('button', { name: /^Healing: .*Click to edit/ })).toBeVisible()

    // Every read stat offers a source outside a session; here none may.
    await expect(panel.getByRole('button', { name: /^Show source of/ })).toHaveCount(0)
    // Nothing can ask without the disclosure, so this only backs the line above.
    expect(regionRequests, 'field-regions requests during the session').toBe(0)
  })
})
