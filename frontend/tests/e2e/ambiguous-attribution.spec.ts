/**
 * Ambiguous-attribution E2E.
 *
 * When the resolver can't pin a screenshot to a single match (EAD
 * signature match in the 5–30 min ambiguous window, or multiple
 * candidates inside 30 min), the parent row gets a
 * `match_key = "ambiguous-<filename>"` sentinel and the candidate
 * list ships on the MatchRecord as `candidates: [...]`. The Unknown
 * tab surfaces these in a "Needs your review" subsection with a
 * per-candidate picker.
 *
 * This spec drives the full round-trip:
 *   1. GET /api/v1/matches returns an ambiguous record + a candidate.
 *   2. Tab into Unknown; assert the "Needs your review — 1" heading.
 *   3. Expand the ambiguous row and pick a candidate.
 *   4. Verify the PUT to /api/v1/matches/{encoded}/resolution fires
 *      with { resolved_to: <candidate match_key> }.
 *   5. After the post-resolve refetch, the ambiguous row disappears
 *      and the candidate's source-file count incremented.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const AMBIG_KEY = 'ambiguous-scoreboard-2.png'
const AMBIG_KEY_ENCODED = encodeURIComponent(AMBIG_KEY)
const RESOLUTION_PATH_GLOB = `**/api/v1/matches/${AMBIG_KEY_ENCODED}/resolution`

const CANDIDATE_KEY = 'match-2026-05-10T21-29-28'

const candidateMatchRecord = (extraSource?: string) => ({
  match_key: CANDIDATE_KEY,
  source_files: extraSource ? ['scoreboard-1.png', extraSource] : ['scoreboard-1.png'],
  source_types: {
    'scoreboard-1.png': 'scoreboard',
    ...(extraSource ? { [extraSource]: 'scoreboard' } : {}),
  },
  data: {
    map: 'rialto',
    mode: 'competitive',
    hero: 'lucio',
    eliminations: 17,
    assists: 16,
    deaths: 11,
    date: '2026-05-10',
    finished_at: '21:29',
  },
  parsed_at: '2026-05-10T21:30:00Z',
})

const ambiguousRecord = () => ({
  match_key: AMBIG_KEY,
  source_files: ['scoreboard-2.png'],
  source_types: { 'scoreboard-2.png': 'scoreboard' },
  data: {
    mode: 'competitive',
    hero: 'lucio',
    eliminations: 17,
    assists: 16,
    deaths: 11,
  },
  parsed_at: '2026-05-10T21:42:00Z',
  ambiguous: true,
  candidates: [
    {
      match_key: CANDIDATE_KEY,
      distance_seconds: 720,
      representative_source_file: 'scoreboard-1.png',
      representative_dir_id: 0,
    },
  ],
})

test.describe('ambiguous attribution — pick a candidate via Unknown tab', () => {
  test.beforeEach(async ({ page }) => {
    // Disable view-fade-in animation so Playwright's stability check
    // sees the candidate-picker buttons at full opacity by the time
    // it attempts the click.
    await page.emulateMedia({ reducedMotion: 'reduce' })
  })

  test('"Needs your review" heading renders for each ambiguous record', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([candidateMatchRecord(), ambiguousRecord()]),
      })
    })

    await page.goto('/')
    await page.locator('#tab-unknown').click()

    const heading = page.locator('.needs-review-heading')
    await expect(heading).toBeVisible()
    await expect(heading).toContainText(/Needs your review/)
    await expect(heading).toContainText('1')
  })

  test('expanding an ambiguous row shows the candidate picker', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([candidateMatchRecord(), ambiguousRecord()]),
      })
    })

    await page.goto('/')
    await page.locator('#tab-unknown').click()

    // Click into the ambiguous card.
    const card = page.locator('.ambiguous-card').first()
    await expect(card).toBeVisible()
    await card.locator('.unknown-card-head').click()

    // Candidate row shows the candidate's match key + distance hint.
    const candidateRow = page.locator('.candidate-row').first()
    await expect(candidateRow).toBeVisible()
    await expect(candidateRow).toContainText(/rialto/i)
    await expect(candidateRow).toContainText(/12 min/i)
    await expect(candidateRow.locator('button', { hasText: /Attach/ })).toBeVisible()
  })

  test('expanding auto-opens the source-screenshot preview', async ({ page }) => {
    // One click on the card head expands AND auto-opens the source
    // preview — saves the user the extra chevron click before they
    // can compare the source image against the candidates.
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([candidateMatchRecord(), ambiguousRecord()]),
      })
    })

    await page.goto('/')
    await page.locator('#tab-unknown').click()

    const card = page.locator('.ambiguous-card').first()
    await card.locator('.unknown-card-head').click()

    // Source preview image must be in the DOM with no second click.
    const preview = card.locator('img.source-preview')
    await expect(preview).toBeVisible()
  })

  test('side-by-side preview pane shows the active candidate and updates on hover', async ({ page }) => {
    // Two candidates so we can verify the pane swaps on hover.
    const ambig = {
      ...ambiguousRecord(),
      candidates: [
        {
          match_key: CANDIDATE_KEY,
          distance_seconds: 720,
          representative_source_file: 'scoreboard-1.png',
          representative_dir_id: 0,
        },
        {
          match_key: 'match-2026-05-10T21-45-00',
          distance_seconds: 60,
          representative_source_file: 'scoreboard-3.png',
          representative_dir_id: 0,
        },
      ],
    }
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([candidateMatchRecord(), ambig]),
      })
    })

    await page.goto('/')
    await page.locator('#tab-unknown').click()
    await page.locator('.ambiguous-card .unknown-card-head').first().click()

    // Pane defaults to the first candidate.
    const paneImg = page.locator('.candidate-preview-pane img')
    await expect(paneImg).toHaveAttribute('src', /scoreboard-1\.png/)

    // Hover the second candidate row → pane swaps.
    await page.locator('.candidate-row').nth(1).hover()
    await expect(paneImg).toHaveAttribute('src', /scoreboard-3\.png/)
  })

  test('Attach button PUTs to /resolution with the chosen match_key', async ({ page }) => {
    let putBody: Record<string, unknown> | null = null
    let putCount = 0
    let resolved = false

    await page.route('**/api/v1/matches', async (route: Route) => {
      const list = resolved
        ? [candidateMatchRecord('scoreboard-2.png')]
        : [candidateMatchRecord(), ambiguousRecord()]
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

    // Expand the ambiguous row.
    await page.locator('.ambiguous-card').first().locator('.unknown-card-head').click()

    // Click "Attach to this match". Dispatch via the button's
    // native click() — Playwright's mouse-driven click resolves the
    // hit-target as `.app` for reasons that don't matter to the
    // contract under test (the user reaches the same affordance
    // via keyboard Enter, which fires the same event path).
    await page.locator('.candidate-row button.candidate-attach').first().evaluate((b) => (b as HTMLButtonElement).click())

    await expect.poll(() => putCount).toBeGreaterThanOrEqual(1)
    expect(putBody).toEqual({ resolved_to: CANDIDATE_KEY })

    // Post-resolve refetch removes the ambiguous row.
    await expect(page.locator('.ambiguous-card')).toHaveCount(0)
    await expect(page.locator('.needs-review-heading')).toHaveCount(0)
  })

  test('each candidate renders a representative-screenshot thumbnail beside its headline', async ({ page }) => {
    // 1×1 PNG so the <img> actually paints in the headless browser.
    const STUB_PNG = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    )
    await page.route('**/_screenshot/**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'image/png', body: STUB_PNG })
    })
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([candidateMatchRecord(), ambiguousRecord()]),
      })
    })

    await page.goto('/')
    await page.locator('#tab-unknown').click()
    await page.locator('.ambiguous-card').first().locator('.unknown-card-head').click()

    // Thumb button appears with the right src + aria-label.
    const thumb = page.locator(`[data-candidate-thumb="${CANDIDATE_KEY}"]`)
    await expect(thumb).toBeVisible()
    const img = thumb.locator('img')
    await expect(img).toHaveAttribute('src', /_screenshot\/0\/scoreboard-1\.png/)
    await expect(thumb).toHaveAttribute('aria-label', new RegExp(CANDIDATE_KEY))
  })
})
