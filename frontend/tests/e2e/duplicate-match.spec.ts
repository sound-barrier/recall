/**
 * Duplicate-match detection E2E.
 *
 * When the end-of-parse duplicate sweep finds a freshly-created match
 * whose full TEAMS stat line (eliminations, assists, deaths, damage,
 * healing, mitigation) exactly equals an existing match's within 7
 * days — but beyond the 30-minute EAD-bridge window — the new capture
 * is demoted to an `ambiguous-<filename>` sentinel with the existing
 * match as a candidate carrying `reason: "duplicate_stats"`. The
 * Unknown tab surfaces it under "Needs your review" with an explicit
 * "Possible duplicate" badge and duplicate-specific wording.
 *
 * This spec drives the full round-trip:
 *   1. GET /api/v1/matches returns the original match + a
 *      duplicate-flagged ambiguous record (3 h apart, same stat line).
 *   2. Tab into Unknown; assert the "Possible duplicate" badge and the
 *      "identical combat stat line" candidate label.
 *   3. Distance renders in hours ("3 h apart"), not raw minutes.
 *   4. "Same match — merge screenshots" PUTs
 *      { resolved_to: <original> } to /resolution; the card disappears
 *      after the refetch.
 *   5. "Different match — keep separate" PUTs the re-minted
 *      match-<ts> key from the duplicate capture's own filename.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const ORIGINAL_KEY = 'match-2026-05-10T18-05-22'
const ORIGINAL_FILE = 'Overwatch 2 Screenshot 2026.05.10 - 18.05.22.11.png'

const DUPLICATE_FILE = 'Overwatch 2 Screenshot 2026.05.10 - 21.14.03.02.png'
const AMBIG_KEY = 'ambiguous-T3ZlcndhdGNoIDIgU2NyZWVuc2hvdA'
const AMBIG_KEY_ENCODED = encodeURIComponent(AMBIG_KEY)
const RESOLUTION_PATH_GLOB = `**/api/v1/matches/${AMBIG_KEY_ENCODED}/resolution`

// 18:05:22 → 21:14:03 = 3 h 8 min 41 s.
const DISTANCE_SECONDS = 11321
const KEEP_SEPARATE_KEY = 'match-2026-05-10T21-14-03'

const statLine = {
  eliminations: 17,
  assists: 16,
  deaths: 11,
  damage: 12843,
  healing: 9021,
  mitigation: 3310,
}

const originalRecord = (absorbed?: string) => ({
  match_key: ORIGINAL_KEY,
  source_files: absorbed ? [ORIGINAL_FILE, absorbed] : [ORIGINAL_FILE],
  source_types: {
    [ORIGINAL_FILE]: 'teams',
    ...(absorbed ? { [absorbed]: 'teams' } : {}),
  },
  data: {
    map: 'rialto',
    playlist: 'competitive',
    hero: 'lucio',
    date: '2026-05-10',
    ...statLine,
  },
  parsed_at: '2026-05-10T18:06:00Z',
})

const duplicateRecord = () => ({
  match_key: AMBIG_KEY,
  source_files: [DUPLICATE_FILE],
  source_types: { [DUPLICATE_FILE]: 'teams' },
  data: {
    playlist: 'competitive',
    hero: 'lucio',
    ...statLine,
  },
  parsed_at: '2026-05-10T21:15:00Z',
  ambiguous: true,
  candidates: [
    {
      match_key: ORIGINAL_KEY,
      distance_seconds: DISTANCE_SECONDS,
      reason: 'duplicate_stats',
      representative_source_file: ORIGINAL_FILE,
      representative_dir_id: 0,
    },
  ],
})

test.describe('duplicate capture — flagged for triage via Unknown tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
  })

  test('duplicate-flagged record shows the badge and duplicate wording', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([originalRecord(), duplicateRecord()]),
      })
    })

    await page.goto('/')
    await page.locator('#tab-unknown').click()

    // Lands in "Needs your review" with an explicit duplicate badge.
    await expect(page.locator('.needs-review-heading')).toContainText('1')
    const card = page.locator('.ambiguous-card').first()
    await expect(card.locator('.duplicate-badge')).toBeVisible()
    await expect(card.locator('.duplicate-badge')).toContainText(/Possible duplicate/i)

    // Expanded card explains WHY it was flagged, with hour-scale distance.
    await card.locator('.unknown-card-head').click()
    const row = page.locator('.candidate-row').first()
    await expect(row.locator('.candidate-duplicate-label')).toContainText(/identical combat stat line/i)
    await expect(row.locator('.candidate-distance')).toContainText(/3 h apart/)

    // Duplicate-specific button wording replaces the generic pair.
    await expect(row.locator('button.candidate-attach')).toHaveText(/Same match — merge screenshots/)
    await expect(page.locator('button.candidate-fresh')).toHaveText(/Different match — keep separate/)
  })

  test('merge PUTs the original key to /resolution and the card disappears', async ({ page }) => {
    let putBody: Record<string, unknown> | null = null
    let putCount = 0
    let resolved = false

    await page.route('**/api/v1/matches', async (route: Route) => {
      const list = resolved
        ? [originalRecord(DUPLICATE_FILE)]
        : [originalRecord(), duplicateRecord()]
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(list),
      })
    })
    await page.route(RESOLUTION_PATH_GLOB, async (route: Route) => {
      putCount++
      putBody = JSON.parse(route.request().postData() ?? '{}')
      resolved = true
      await route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/')
    await page.locator('#tab-unknown').click()
    await page.locator('.ambiguous-card').first().locator('.unknown-card-head').click()

    await page.locator('.candidate-row button.candidate-attach').first().evaluate((b) => (b as HTMLButtonElement).click())

    await expect.poll(() => putCount).toBeGreaterThanOrEqual(1)
    expect(putBody).toEqual({ resolved_to: ORIGINAL_KEY })

    await expect(page.locator('.ambiguous-card')).toHaveCount(0)
    await expect(page.locator('.needs-review-heading')).toHaveCount(0)
  })

  test('keep-separate PUTs the re-minted match key from the duplicate filename', async ({ page }) => {
    let putBody: Record<string, unknown> | null = null
    let putCount = 0

    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([originalRecord(), duplicateRecord()]),
      })
    })
    await page.route(RESOLUTION_PATH_GLOB, async (route: Route) => {
      putCount++
      putBody = JSON.parse(route.request().postData() ?? '{}')
      await route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/')
    await page.locator('#tab-unknown').click()
    await page.locator('.ambiguous-card').first().locator('.unknown-card-head').click()

    await page.locator('button.candidate-fresh').evaluate((b) => (b as HTMLButtonElement).click())

    await expect.poll(() => putCount).toBeGreaterThanOrEqual(1)
    expect(putBody).toEqual({ resolved_to: KEEP_SEPARATE_KEY })
  })

  test('non-duplicate ambiguous candidates keep the generic wording', async ({ page }) => {
    // A near-window candidate (12 min, no reason) must NOT pick up the
    // duplicate badge or the merge/keep-separate wording — pins the
    // wording swap to reason === 'duplicate_stats'.
    const nearWindow = {
      ...duplicateRecord(),
      candidates: [
        {
          match_key: ORIGINAL_KEY,
          distance_seconds: 720,
          representative_source_file: ORIGINAL_FILE,
          representative_dir_id: 0,
        },
      ],
    }
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([originalRecord(), nearWindow]),
      })
    })

    await page.goto('/')
    await page.locator('#tab-unknown').click()

    const card = page.locator('.ambiguous-card').first()
    await expect(card).toBeVisible()
    await expect(card.locator('.duplicate-badge')).toHaveCount(0)

    await card.locator('.unknown-card-head').click()
    const row = page.locator('.candidate-row').first()
    await expect(row.locator('.candidate-duplicate-label')).toHaveCount(0)
    await expect(row.locator('.candidate-distance')).toContainText(/12 min apart/)
    await expect(row.locator('button.candidate-attach')).toHaveText(/Attach to this match/)
    await expect(page.locator('button.candidate-fresh')).toHaveText(/Treat as new match/)
  })
})
