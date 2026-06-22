/**
 * Undo-on-hide toast (TECHNICAL_DEBT #9b).
 *
 * Hiding a match moves it to the archive drawer — recovery is only via that
 * drawer, which is easy to miss. This proves the inline recovery loop: hide a
 * match → a bottom-right toast appears → its "Undo" un-hides the match
 * (PUT /visibility {hidden:false}). Only an e2e exercises the full chain
 * (context menu → useMatchActions → ui store → AppOverlays toast → api).
 */
import type { Page, Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const KEY = 'match-2026-05-10T22-30-00'

function record() {
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
      finished_at: '22:30',
      eliminations: 17,
      assists: 16,
      deaths: 11,
      damage: 7200,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '11:25' }],
    },
    parsed_at: '2026-05-10T22:35:00Z',
  }
}

async function mock(page: Page, state: { hidden: boolean }, visibilityCalls: boolean[]) {
  await page.route('**/api/v1/matches', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state.hidden ? [] : [record()]) }))
  await page.route('**/api/v1/matches/*/visibility', (route: Route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { hidden?: boolean }
    visibilityCalls.push(!!body.hidden)
    state.hidden = !!body.hidden
    return route.fulfill({ status: 204, body: '' })
  })
}

test.describe('undo-hide toast', () => {
  test('hiding a match shows an Undo toast that un-hides it', async ({ page }) => {
    const state = { hidden: false }
    const visibilityCalls: boolean[] = []
    await mock(page, state, visibilityCalls)

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('.leaf-row').first().click({ button: 'right' })
    await page.locator('[data-row-ctx-hide]').click()

    const toast = page.locator('[data-undo-toast]')
    await expect(toast).toBeVisible()
    await expect(toast).toContainText('rialto')

    await toast.locator('[data-undo-toast-undo]').click()
    // First the hide (true), then the undo un-hide (false).
    await expect.poll(() => visibilityCalls).toEqual([true, false])
    await expect(toast).toHaveCount(0)
  })
})
