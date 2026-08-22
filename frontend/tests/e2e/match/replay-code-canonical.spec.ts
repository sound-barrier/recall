/**
 * Replay-code canonicalization E2E.
 *
 * A replay code stopped being a display string and became an identity: a
 * match key is minted from it, and a coach and a player have to type the same
 * six characters and land on the same match. So the Match Journal's replay
 * cell now refuses to produce anything but the canonical form.
 *
 * Round-trip proven here:
 *   1. The field caps at six characters — a longer paste is truncated rather
 *      than sent and rejected.
 *   2. Typing in lowercase shows the code uppercased, as it will be stored.
 *   3. The PUT carries the canonical uppercase code.
 *
 * Only the e2e proves 3: the transport chain from input → draft → api.ts →
 * PUT body is exactly where an "it uppercases on the server anyway" fix would
 * leave the field showing one thing and the database holding another.
 */
import type { Route } from '@playwright/test'

import { test, expect } from '../_fixtures'

const KEY = 'match-2026-05-10T22-10-00'
const ANNOTATION_PATH_GLOB = `**/api/v1/matches/${encodeURIComponent(KEY)}/annotation`

const record = () => ({
  match_key: KEY,
  source_files: [`${KEY}.png`],
  data: {
    map: 'numbani',
    playlist: 'competitive',
    hero: 'lucio',
    result: 'defeat',
    date: '2026-05-10',
    finished_at: '22:10',
  },
  parsed_at: '2026-05-10T22:30:00Z',
})

test.describe('the replay code is stored the way it is shown', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([record()]),
      })
    })
  })

  test('caps at six characters, uppercases as typed, and PUTs the canonical form', async ({ page }) => {
    let putBody: Record<string, unknown> | null = null
    await page.route(ANNOTATION_PATH_GLOB, async (route: Route) => {
      putBody = JSON.parse(route.request().postData() ?? '{}')
      await route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/')
    await page.locator('.leaf-row', { hasText: /numbani/i }).first().click()
    await expect(page.locator('.match-journal')).toBeVisible()

    const replay = page.locator(`#replay-${KEY}`)

    // A code longer than six characters cannot be entered at all.
    await replay.fill('')
    await replay.pressSequentially('a1b2c3d4e5')
    await expect(replay).toHaveValue('A1B2C3')

    await replay.blur()
    await expect.poll(() => putBody?.replay_code).toBe('A1B2C3')
  })
})
