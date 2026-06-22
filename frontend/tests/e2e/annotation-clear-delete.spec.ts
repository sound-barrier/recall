/**
 * Annotation clear → DELETE E2E.
 *
 * Proves the #7 contract end to end in a real browser: PUT /annotation is
 * upsert-only, and clearing an annotation that has no other content fires an
 * explicit `DELETE /api/v1/matches/{matchKey}/annotation` (not an all-empty PUT,
 * which the server now rejects with 400). The full transport chain —
 * useMatchActions.writeAnnotation → api.ts DeleteMatchAnnotation → fetch DELETE —
 * is exactly the kind only an e2e exercises (a unit test mocks the api away).
 *
 * Same page.route() mocking pattern as match-tags.spec.ts; closure state tracks
 * whether a leaver is currently set so the reload after the clear drops it.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const KEY = 'match-2026-05-10T22-10-00'
const ANNOTATION_PATH_GLOB = `**/api/v1/matches/${encodeURIComponent(KEY)}/annotation`

function record(leaver: string) {
  return {
    match_key: KEY,
    source_files: [`${KEY}.png`],
    data: {
      map: 'rialto',
      playlist: 'competitive',
      game_mode: 'control',
      role: 'support',
      hero: 'lucio',
      result: 'victory',
      date: '2026-05-10',
      finished_at: '22:10',
      eliminations: 17,
      assists: 16,
      deaths: 11,
      damage: 7200,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '11:25' }],
    },
    parsed_at: '2026-05-10T22:30:00Z',
    ...(leaver ? { annotation: { leaver } } : {}),
  }
}

test.describe('annotation clear — DELETE verb', () => {
  test('clearing a leaver-only annotation fires DELETE, not an all-empty PUT', async ({ page }) => {
    let leaver = 'enemy'
    let deleteCalls = 0
    let putCalls = 0

    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([record(leaver)]),
      })
    })
    await page.route(ANNOTATION_PATH_GLOB, async (route: Route) => {
      if (route.request().method() === 'DELETE') {
        deleteCalls += 1
        leaver = ''
        await route.fulfill({ status: 204, body: '' })
        return
      }
      // The server would 400 an all-empty PUT; assert the client never sends one.
      putCalls += 1
      await route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('.leaf-row').first().click()
    await expect(page.locator('aside.detail-panel')).toBeVisible()

    // Clear the leaver — the only content on this annotation — so the row goes
    // empty and the UI must route to DELETE.
    await page.locator('.leaver-chip.leaver-clear').click()

    await expect.poll(() => deleteCalls).toBe(1)
    expect(putCalls).toBe(0)
  })
})
