import { expect } from '@playwright/test'

import { test } from '../_fixtures'

// Loss-quality classification (audit product gap #4): a competitive
// player wants "was that loss close or a stomp?" at a glance —
// uniquely actionable (a stomp streak means stop queuing; close
// losses mean keep going). Derived read-side from the already-
// captured final_score; surfaced as the opt-in Loss quality
// breakdown widget.

function rec(key: string, result: 'victory' | 'defeat', finalScore: string) {
  return {
    match_key: key,
    source_files: [`${key}.png`],
    data: {
      map: 'rialto', hero: 'lucio', role: 'support',
      result, final_score: finalScore,
      date: '2026-05-10', finished_at: '22:00',
    },
  }
}

const CORPUS = [
  rec('m1', 'defeat', '2-3'),  // margin 1 → close
  rec('m2', 'defeat', '1-2'),  // margin 1 → close
  rec('m3', 'defeat', '0-2'),  // shutout → stomp
  rec('m4', 'defeat', '1-4'),  // margin 3 → stomp
  rec('m5', 'defeat', '1-3'),  // margin 2 → normal
  rec('m6', 'victory', '3-0'), // victories never classify
]

test.describe('loss quality widget', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('recall.dashboard.layout', JSON.stringify({ 1: ['loss-quality'] }))
    })
    await page.route('**/api/v1/matches', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CORPUS) }))
    await page.goto('/')
    await page.getByRole('tab', { name: /^Matches/ }).click()
  })

  test('buckets the narrowed losses into close / normal / stomp', async ({ page }) => {
    const widget = page.locator('[data-widget-id="loss-quality"]')
    await expect(widget).toBeVisible()

    await expect(widget).toContainText(/close/i)
    await expect(widget).toContainText(/stomp/i)
    // 2 close, 1 normal, 2 stomps out of 5 losses; the victory and
    // its 3-0 score never enter the buckets.
    await expect(widget.locator('[data-loss-quality-row="close"]')).toContainText('2x')
    await expect(widget.locator('[data-loss-quality-row="normal"]')).toContainText('1x')
    await expect(widget.locator('[data-loss-quality-row="stomp"]')).toContainText('2x')
  })
})
