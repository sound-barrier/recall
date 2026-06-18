/**
 * Unknown → resolve an ambiguous screenshot against a NEWLY-ADDED hero/map.
 *
 * After a game-data update adds a hero ("Testra") + map ("Proving Grounds")
 * to the roster, a candidate match featuring them should be attachable from
 * the Unknown tab's "Needs your review" candidate picker. This proves an
 * unknown screenshot can be matched against the new hero/map.
 *
 * The roster is mocked (no GitHub). Mirrors ambiguous-attribution.spec.ts.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

// Roster already carrying the fake hero/map (post-update state).
const ROSTER = {
  heroes_by_role: { tank: ['Reinhardt'], damage: ['Tracer'], support: ['Ana', 'Testra'] },
  maps_by_game_mode: { control: ['Ilios', 'Proving Grounds'], hybrid: ["King's Row"] },
}

const AMBIG_KEY = 'ambiguous-scoreboard-2.png'
const RESOLUTION_GLOB = `**/api/v1/matches/${encodeURIComponent(AMBIG_KEY)}/resolution`
const CANDIDATE_KEY = 'match-2026-05-10T21-29-28'

// Candidate match featuring the newly-added hero + map.
const candidate = (extraSource?: string) => ({
  match_key: CANDIDATE_KEY,
  source_files: extraSource ? ['scoreboard-1.png', extraSource] : ['scoreboard-1.png'],
  source_types: { 'scoreboard-1.png': 'teams', ...(extraSource ? { [extraSource]: 'teams' } : {}) },
  data: {
    // Match payloads are intentionally lowercased (API-normalized); roster/display names remain title-cased.
    map: 'proving grounds', playlist: 'competitive', hero: 'testra',
    eliminations: 17, assists: 16, deaths: 11, date: '2026-05-10', finished_at: '21:29',
  },
  parsed_at: '2026-05-10T21:30:00Z',
})

const ambiguous = () => ({
  match_key: AMBIG_KEY,
  source_files: ['scoreboard-2.png'],
  source_types: { 'scoreboard-2.png': 'teams' },
  // Match payloads are intentionally lowercased (API-normalized); roster/display names remain title-cased.
  data: { playlist: 'competitive', hero: 'testra', eliminations: 17, assists: 16, deaths: 11 },
  parsed_at: '2026-05-10T21:42:00Z',
  ambiguous: true,
  candidates: [
    { match_key: CANDIDATE_KEY, distance_seconds: 720, representative_source_file: 'scoreboard-1.png', representative_dir_id: 0 },
  ],
})

test('an ambiguous screenshot can be attached to a candidate featuring a newly-added hero/map', async ({ page }) => {
  // Full opacity for the candidate-picker buttons by click time.
  await page.emulateMedia({ reducedMotion: 'reduce' })

  let putBody: Record<string, unknown> | null = null
  let putCount = 0
  let resolved = false

  await page.route('**/api/v1/system/reference-data', (r: Route) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ROSTER) }))
  await page.route('**/api/v1/matches', (r: Route) =>
    r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(resolved ? [candidate('scoreboard-2.png')] : [candidate(), ambiguous()]),
    }))
  await page.route(RESOLUTION_GLOB, (r: Route) => {
    putCount++
    putBody = JSON.parse(r.request().postData() ?? '{}')
    resolved = true
    return r.fulfill({ status: 204, body: '' })
  })

  await page.goto('/')
  await page.locator('#tab-unknown').click()

  // Expand the ambiguous card → its candidate shows the new map/hero.
  await page.locator('.ambiguous-card').first().locator('.unknown-card-head').click()
  const candidateRow = page.locator('.candidate-row').first()
  await expect(candidateRow).toBeVisible()
  await expect(candidateRow).toContainText(/proving grounds/i)

  // Attach → the unknown is matched to that candidate.
  await page.locator('.candidate-row button.candidate-attach').first().evaluate((b) => (b as HTMLButtonElement).click())
  await expect.poll(() => putCount).toBeGreaterThanOrEqual(1)
  expect(putBody).toEqual({ resolved_to: CANDIDATE_KEY })

  // The resolved screenshot leaves the "Needs your review" list.
  await expect(page.locator('.ambiguous-card')).toHaveCount(0)
})
