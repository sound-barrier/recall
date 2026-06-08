/**
 * Re-parse "matches updated" progress line (item 12).
 *
 * While Re-parse all is running, parse-progress SSE events carry
 * cumulative matches_updated / hero_corrections / map_corrections
 * counters. The Settings → Advanced surface renders them as a
 * "X of Y matches updated · N hero / M map corrected" line under
 * the Re-parse button.
 *
 * Mock the SSE stream so the test doesn't need a real OCR run.
 */
import { test, expect } from './_fixtures'

test.describe('re-parse progress line', () => {
  test('cumulative parse-progress counters surface as "X of Y matches updated"', async ({ page }) => {
    // Mock /api/v1/events with an SSE stream that emits one
    // parse-progress event carrying the counters, then never
    // closes (the e2e finishes before the stream times out).
    await page.route('**/api/v1/events', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: [
          'event: parse-progress',
          'data: {"done":47,"total":47,"filename":"x.png","matches_updated":12,"hero_corrections":3,"map_corrections":1}',
          '',
          '',
        ].join('\n'),
      })
    })

    await page.goto('/')
    await page.locator('#tab-settings').click()

    // Wait for the SSE event to land + the line to render.
    await expect(page.locator('[data-reparse-progress-line]'))
      .toContainText('12 of 47 matches updated', { timeout: 5000 })
    await expect(page.locator('[data-reparse-progress-line]'))
      .toContainText('3 hero / 1 map corrected')
  })
})
